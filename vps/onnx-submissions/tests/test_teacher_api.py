"""RED contract tests for the Phase 03 teacher gate and model download API.

The implementation is intentionally absent when these tests are first added.
Keep these tests focused on externally visible behavior so the eventual API
can choose its internal session/ticket data structures freely.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


ORIGIN = "https://fairino-robot-simulator.vercel.app"


def claims(token: str) -> dict:
    return {
        "uid": token,
        "sub": token,
        "aud": "frteachxcamp",
        "iss": "https://securetoken.google.com/frteachxcamp",
        "firebase": {"sign_in_provider": "anonymous"},
    }


def firebase_verifier(token: str) -> dict:
    if token != "student-token":
        raise ValueError("invalid token")
    return claims(token)


@pytest.fixture
def api_module():
    sys.modules.pop("main", None)
    return importlib.import_module("main")


@pytest.fixture
def config(tmp_path: Path) -> dict:
    return {
        "data_root": tmp_path / "data",
        "allowed_origins": [ORIGIN],
        "firebase_project_id": "frteachxcamp",
        "teacher_password": "090909",
        # Short TTL makes expiry deterministic without monkeypatching internals.
        "teacher_session_ttl_seconds": 0.05,
        "teacher_download_ticket_ttl_seconds": 0.05,
    }


@pytest.fixture
def app(api_module, config):
    return api_module.create_app(config=config, token_verifier=firebase_verifier)


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


def teacher_auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Origin": ORIGIN}


def login(client: TestClient) -> str:
    response = client.post(
        "/v1/teacher/session",
        json={"password": "090909"},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    token = body.get("token") or body.get("sessionToken")
    assert isinstance(token, str) and token
    assert "090909" not in response.text
    return token


def seed_model(data_root: Path, submission_id: str, *, group_name: str, body: bytes) -> None:
    target = data_root / "submissions" / submission_id
    target.mkdir(parents=True, exist_ok=True)
    (target / "model.onnx").write_bytes(body)
    (target / "metadata.json").write_text(
        json.dumps(
            {
                "submissionId": submission_id,
                "groupKey": submission_id.lower(),
                "groupName": group_name,
                "filename": "model.onnx",
                "size": len(body),
                "sha256": hashlib.sha256(body).hexdigest(),
                "uploadedAt": "2026-08-12T12:00:00Z",
            }
        ),
        encoding="utf-8",
    )


def models_payload(response):
    body = response.json()
    if isinstance(body, dict) and isinstance(body.get("models"), list):
        return body["models"]
    assert isinstance(body, list), body
    return body


def test_teacher_password_gate_accepts_only_fixed_password_and_does_not_echo_it(client):
    for password in ("", "09090", "0909090", "stemtechx", "wrong"):
        response = client.post(
            "/v1/teacher/session", json={"password": password}, headers={"Origin": ORIGIN}
        )
        assert response.status_code in (401, 403), response.text
        assert "090909" not in response.text

    token = login(client)
    assert token
    # A valid token remains useful for more than one authorized request.
    assert client.get("/v1/teacher/models", headers=teacher_auth(token)).status_code == 200


def test_teacher_session_expiry_revokes_list_access(client):
    token = login(client)
    time.sleep(0.08)
    response = client.get("/v1/teacher/models", headers=teacher_auth(token))
    assert response.status_code in (401, 403)


def test_teacher_models_require_bearer_and_missing_model_is_distinct(client):
    assert client.get("/v1/teacher/models", headers={"Origin": ORIGIN}).status_code == 401
    assert client.get(
        "/v1/teacher/models", headers=teacher_auth("not-a-session")
    ).status_code in (401, 403)

    token = login(client)
    response = client.get("/v1/teacher/models/missing_submission_00001", headers=teacher_auth(token))
    assert response.status_code == 404


def test_teacher_list_and_detail_expose_authoritative_metadata(client, app):
    root = app.state.config.data_root
    seed_model(root, "teacher_submission_00001", group_name="Nhóm trùng", body=b"model-a")
    seed_model(root, "teacher_submission_00002", group_name="Nhóm trùng", body=b"model-b")
    token = login(client)

    response = client.get("/v1/teacher/models", headers=teacher_auth(token))
    assert response.status_code == 200, response.text
    models = models_payload(response)
    assert {item["submissionId"] for item in models} == {
        "teacher_submission_00001",
        "teacher_submission_00002",
    }
    row = next(item for item in models if item["submissionId"] == "teacher_submission_00001")
    assert row["filename"] == "model.onnx"
    assert row["size"] == len(b"model-a")
    assert row["sha256"] == hashlib.sha256(b"model-a").hexdigest()
    assert row["uploadedAt"] == "2026-08-12T12:00:00Z"

    detail = client.get(
        "/v1/teacher/models/teacher_submission_00002", headers=teacher_auth(token)
    )
    assert detail.status_code == 200
    assert detail.json()["submissionId"] == "teacher_submission_00002"


def test_download_ticket_is_bound_to_model_single_use_and_streams_attachment(client, app):
    seed_model(app.state.config.data_root, "teacher_submission_00001", group_name="Nhóm 1", body=b"model-a")
    seed_model(app.state.config.data_root, "teacher_submission_00002", group_name="Nhóm 2", body=b"model-b")
    token = login(client)
    auth = teacher_auth(token)

    ticket_response = client.post(
        "/v1/teacher/models/teacher_submission_00001/download-ticket", headers=auth
    )
    assert ticket_response.status_code == 200, ticket_response.text
    ticket = ticket_response.json().get("ticket")
    assert isinstance(ticket, str) and ticket

    wrong_model = client.get(
        "/v1/teacher/models/teacher_submission_00002/download",
        params={"ticket": ticket},
        headers={"Origin": ORIGIN},
    )
    assert wrong_model.status_code in (403, 404)

    download = client.get(
        "/v1/teacher/models/teacher_submission_00001/download",
        params={"ticket": ticket},
        headers={"Origin": ORIGIN},
    )
    assert download.status_code == 200
    assert download.content == b"model-a"
    assert download.headers["content-disposition"].lower().startswith("attachment")
    assert "model.onnx" in download.headers["content-disposition"]
    assert download.headers["content-type"].split(";", 1)[0] == "application/octet-stream"
    assert download.headers["content-length"] == str(len(b"model-a"))
    assert download.headers["x-content-type-options"] == "nosniff"

    replay = client.get(
        "/v1/teacher/models/teacher_submission_00001/download",
        params={"ticket": ticket},
        headers={"Origin": ORIGIN},
    )
    assert replay.status_code in (401, 403, 404)


def test_download_ticket_expiry_and_missing_ticket_are_rejected(client, app):
    seed_model(app.state.config.data_root, "teacher_submission_00001", group_name="Nhóm 1", body=b"model-a")
    token = login(client)
    auth = teacher_auth(token)
    assert client.get(
        "/v1/teacher/models/teacher_submission_00001/download",
        headers={"Origin": ORIGIN},
    ).status_code in (401, 403)
    ticket_response = client.post(
        "/v1/teacher/models/teacher_submission_00001/download-ticket", headers=auth
    )
    ticket = ticket_response.json()["ticket"]
    time.sleep(0.08)
    expired = client.get(
        "/v1/teacher/models/teacher_submission_00001/download",
        params={"ticket": ticket},
        headers={"Origin": ORIGIN},
    )
    assert expired.status_code in (401, 403, 404)

