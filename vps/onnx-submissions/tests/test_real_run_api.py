from __future__ import annotations

import hashlib
import importlib
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


ORIGIN = "https://fairino-robot-simulator.vercel.app"
SOURCE = '''from techcamp_api import TechCamp

def main():
    with TechCamp() as bot:
        bot.move_to("HOME")

if __name__ == "__main__":
    main()
'''


def verifier(token: str) -> dict:
    if token != "student-token":
        raise ValueError("invalid token")
    return {
        "uid": token,
        "sub": token,
        "aud": "frteachxcamp",
        "firebase": {"sign_in_provider": "anonymous"},
    }


@pytest.fixture
def app(tmp_path: Path):
    sys.modules.pop("main", None)
    module = importlib.import_module("main")
    return module.create_app(
        config={
            "data_root": tmp_path / "data",
            "allowed_origins": [ORIGIN],
            "teacher_password": "0909",
            "agent_token": "agent-secret",
        },
        token_verifier=verifier,
    )


@pytest.fixture
def client(app):
    with TestClient(app) as value:
        yield value


def login(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/v1/teacher/session", json={"password": "0909"}, headers={"Origin": ORIGIN}
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['token']}", "Origin": ORIGIN}


def agent_headers() -> dict[str, str]:
    return {"X-TechCamp-Agent-Token": "agent-secret", "Origin": ORIGIN}


def heartbeat(client: TestClient) -> None:
    response = client.post(
        "/v1/agent/heartbeat",
        json={"runtimeVersion": "techcamp-local-v1"},
        headers=agent_headers(),
    )
    assert response.status_code == 200, response.text


def create_payload():
    return {
        "submissionId": "firebase_submission_001",
        "source": SOURCE,
        "robotModel": "FR5",
        "siteId": "hcm",
        "robotId": "FR5:hcm",
        "pointsTable": "points_HCM.json",
        "action": "real_run",
    }


def seed_model(data_root: Path, submission_id: str, body: bytes = b"onnx-model"):
    target = data_root / "submissions" / submission_id
    target.mkdir(parents=True, exist_ok=True)
    (target / "model.onnx").write_bytes(body)
    (target / "metadata.json").write_text(
        json.dumps({
            "submissionId": submission_id,
            "groupName": "Robot X",
            "filename": "model.onnx",
            "size": len(body),
            "sha256": hashlib.sha256(body).hexdigest(),
            "uploadedAt": "2026-09-15T00:00:00Z",
        }),
        encoding="utf-8",
    )


def test_job_requires_teacher_and_agent_auth(client):
    assert client.post("/v1/teacher/jobs", json=create_payload()).status_code == 401
    assert client.get("/v1/agent/jobs/next").status_code == 401
    teacher = login(client)
    response = client.post("/v1/teacher/jobs", json=create_payload(), headers=teacher)
    assert response.status_code == 201, response.text
    assert "source" not in response.json()


def test_job_requires_explicit_confirmation_then_agent_claims_and_reports_terminal(client):
    teacher = login(client)
    created = client.post("/v1/teacher/jobs", json=create_payload(), headers=teacher)
    assert created.status_code == 201
    job_id = created.json()["jobId"]

    before = client.get(f"/v1/teacher/jobs/{job_id}", headers=teacher).json()
    assert before["status"] == "queued"
    assert client.get("/v1/agent/jobs/next", headers=agent_headers()).json()["job"] is None
    heartbeat(client)

    confirmed = client.post(
        f"/v1/teacher/jobs/{job_id}/confirm",
        json={"confirmation": "physical_run"},
        headers=teacher,
    )
    assert confirmed.status_code == 200
    claimed = client.get("/v1/agent/jobs/next", headers=agent_headers())
    assert claimed.status_code == 200
    job = claimed.json()["job"]
    assert job["jobId"] == job_id
    assert job["source"] == SOURCE
    assert job["robotModel"] == "FR5"

    running = client.post(
        f"/v1/agent/jobs/{job_id}/events",
        json={"status": "running", "message": "started", "heartbeat": True},
        headers=agent_headers(),
    )
    assert running.status_code == 200
    stopped = client.post(f"/v1/teacher/jobs/{job_id}/stop", headers=teacher)
    assert stopped.status_code == 200
    assert stopped.json()["stopRequested"] is True
    terminal = client.post(
        f"/v1/agent/jobs/{job_id}/events",
        json={
            "status": "cleanup",
            "cleanup": {"ok": True, "do0": "off", "do1": "off"},
        },
        headers=agent_headers(),
    )
    assert terminal.status_code == 200
    terminal = client.post(
        f"/v1/agent/jobs/{job_id}/events",
        json={"status": "cancelled", "result": {"outcome": "cancelled"}},
        headers=agent_headers(),
    )
    assert terminal.status_code == 200
    body = client.get(f"/v1/teacher/jobs/{job_id}", headers=teacher).json()
    assert body["status"] == "cancelled"
    assert body["cleanup"]["do0"] == "off"
    assert all("agent-secret" not in str(value) for value in body.values())


def test_active_robot_rejects_second_job(client):
    teacher = login(client)
    first = client.post("/v1/teacher/jobs", json=create_payload(), headers=teacher)
    assert first.status_code == 201
    first_id = first.json()["jobId"]
    heartbeat(client)
    assert client.post(
        f"/v1/teacher/jobs/{first_id}/confirm",
        json={"confirmation": "physical_run"},
        headers=teacher,
    ).status_code == 200
    assert client.get("/v1/agent/jobs/next", headers=agent_headers()).status_code == 200
    second = client.post("/v1/teacher/jobs", json=create_payload(), headers=teacher)
    assert second.status_code == 409


def test_claimed_agent_can_download_only_the_submission_model(client, app):
    seed_model(app.state.config.data_root, "firebase_submission_001")
    teacher = login(client)
    payload = {**create_payload(), "modelAvailable": True}
    created = client.post("/v1/teacher/jobs", json=payload, headers=teacher)
    job_id = created.json()["jobId"]
    heartbeat(client)
    assert client.post(
        f"/v1/teacher/jobs/{job_id}/confirm",
        json={"confirmation": "physical_run"},
        headers=teacher,
    ).status_code == 200
    assert client.get("/v1/agent/jobs/next", headers=agent_headers()).json()["job"]
    download = client.get(f"/v1/agent/jobs/{job_id}/model", headers=agent_headers())
    assert download.status_code == 200
    assert download.content == b"onnx-model"
    assert download.headers["content-disposition"].lower().startswith("attachment")


def test_invalid_profile_source_and_model_fail_at_api_boundary(client):
    teacher = login(client)
    bad_model = {**create_payload(), "robotModel": "FR9"}
    assert client.post("/v1/teacher/jobs", json=bad_model, headers=teacher).status_code == 422
    bad_source = {**create_payload(), "source": ""}
    assert client.post("/v1/teacher/jobs", json=bad_source, headers=teacher).status_code == 422


def test_confirmation_is_blocked_when_local_agent_is_offline(client):
    teacher = login(client)
    created = client.post("/v1/teacher/jobs", json=create_payload(), headers=teacher)
    assert created.status_code == 201
    job_id = created.json()["jobId"]
    denied = client.post(
        f"/v1/teacher/jobs/{job_id}/confirm",
        json={"confirmation": "physical_run"},
        headers=teacher,
    )
    assert denied.status_code == 503
    assert client.get("/v1/agent/jobs/next", headers=agent_headers()).json()["job"] is None
