"""Phase 01 contract tests for the resumable ONNX submission API.

These tests intentionally describe the public protocol before ``main.py`` exists.
They use small byte limits so the production 1 GiB/8 MiB invariants can be tested
without allocating large files.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import pytest
from fastapi.testclient import TestClient


ALLOWED_ORIGIN = "https://fairino-robot-simulator.vercel.app"
OTHER_ORIGIN = "https://attacker.example"
CHUNK_SIZE = 8
MAX_FILE_SIZE = 32


@dataclass
class DiskFree:
    bytes: int = 1_000_000

    def __call__(self, _path: Path) -> int:
        return self.bytes


def _claims(uid: str, *, provider: str = "anonymous") -> dict:
    return {
        "uid": uid,
        "sub": uid,
        "aud": "frteachxcamp",
        "iss": "https://securetoken.google.com/frteachxcamp",
        "firebase": {"sign_in_provider": provider},
    }


def fake_token_verifier(token: str) -> dict:
    claims = {
        "owner-a": _claims("firebase-owner-a"),
        "owner-b": _claims("firebase-owner-b"),
        "non-anonymous": _claims("password-user", provider="password"),
    }.get(token)
    if claims is None:
        raise ValueError("invalid Firebase token")
    return claims


@pytest.fixture
def api_module():
    """Import only after collection so the initial TDD run is a clean RED."""
    sys.modules.pop("main", None)
    return importlib.import_module("main")


@pytest.fixture
def disk_free() -> DiskFree:
    return DiskFree()


@pytest.fixture
def config(tmp_path: Path) -> dict:
    return {
        "data_root": tmp_path / "data",
        "allowed_origins": [ALLOWED_ORIGIN, "http://localhost:3000"],
        "firebase_project_id": "frteachxcamp",
        "max_file_size": MAX_FILE_SIZE,
        "chunk_size": CHUNK_SIZE,
        "active_upload_cap": 10,
        "writer_cap": 5,
        "temp_quota_bytes": 80,
        "completed_quota_bytes": 80,
        "free_space_margin_bytes": 16,
        "incomplete_ttl_seconds": 3600,
        "teacher_password": "090909",
    }


@pytest.fixture
def app(api_module, config: dict, disk_free: DiskFree):
    return api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )


@pytest.fixture
def client(app):
    with TestClient(app) as test_client:
        yield test_client


def auth(token: str = "owner-a") -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Origin": ALLOWED_ORIGIN}


def metadata(
    submission_id: str = "submission_00001",
    *,
    size: int = 16,
    group_key: str = "group-1",
    group_name: str = "Nhóm 1",
    filename: str = "model.onnx",
) -> dict:
    return {
        "submissionId": submission_id,
        "groupKey": group_key,
        "groupName": group_name,
        "size": size,
        "filename": filename,
    }


def init_upload(client: TestClient, body: dict | None = None, token: str = "owner-a") -> dict:
    response = client.post("/v1/uploads", json=body or metadata(), headers=auth(token))
    assert response.status_code in (200, 201), response.text
    payload = response.json()
    assert set(("uploadId", "offset", "chunkSize")) <= payload.keys()
    assert payload["chunkSize"] == CHUNK_SIZE
    return payload


def put_chunk(
    client: TestClient,
    upload_id: str,
    offset: int,
    body: bytes,
    token: str = "owner-a",
):
    headers = auth(token) | {
        "Content-Type": "application/octet-stream",
        "Content-Length": str(len(body)),
    }
    return client.put(
        f"/v1/uploads/{upload_id}/chunks?offset={offset}",
        content=body,
        headers=headers,
    )


def complete_upload(client: TestClient, upload_id: str, token: str = "owner-a"):
    return client.post(f"/v1/uploads/{upload_id}/complete", headers=auth(token))


def test_health_is_public_and_minimal(client: TestClient):
    response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize(
    "method,path,kwargs",
    [
        ("post", "/v1/uploads", {"json": metadata()}),
        ("get", "/v1/uploads/not-a-real-upload", {}),
        (
            "put",
            "/v1/uploads/not-a-real-upload/chunks?offset=0",
            {"content": b"1234", "headers": {"Content-Type": "application/octet-stream"}},
        ),
        ("post", "/v1/uploads/not-a-real-upload/complete", {}),
    ],
)
def test_every_student_route_requires_bearer_auth(client, method, path, kwargs):
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 401


@pytest.mark.parametrize("token", ["invalid", "non-anonymous"])
def test_init_rejects_invalid_or_non_anonymous_firebase_identity(client, token):
    response = client.post("/v1/uploads", json=metadata(), headers=auth(token))
    assert response.status_code == 401


def test_owner_uid_is_bound_across_status_chunk_and_complete(client):
    upload = init_upload(client)
    upload_id = upload["uploadId"]

    assert client.get(f"/v1/uploads/{upload_id}", headers=auth("owner-b")).status_code == 403
    assert put_chunk(client, upload_id, 0, b"12345678", "owner-b").status_code == 403
    assert complete_upload(client, upload_id, "owner-b").status_code == 403

    status = client.get(f"/v1/uploads/{upload_id}", headers=auth("owner-a"))
    assert status.status_code == 200
    assert status.json()["offset"] == 0


@pytest.mark.parametrize(
    "change",
    [
        {"submissionId": "../etc/passwd____"},
        {"submissionId": "short"},
        {"submissionId": "submission.00001"},
        {"filename": "weights.pt"},
        {"filename": "../model.onnx"},
        {"size": 0},
        {"size": MAX_FILE_SIZE + 1},
    ],
)
def test_init_rejects_bad_ids_paths_extension_and_size(client, change):
    body = metadata()
    body.update(change)
    response = client.post("/v1/uploads", json=body, headers=auth())
    assert response.status_code in (400, 413, 422)
    assert not list(client.app.state.config.data_root.rglob("model.onnx"))


def test_init_normalizes_any_safe_onnx_basename_to_model_onnx(client):
    upload = init_upload(client, metadata(filename="student-best.onnx"))
    assert upload["offset"] == 0


def test_matching_unfinished_init_resumes_but_fingerprint_conflict_is_409(client):
    first = init_upload(client)
    assert put_chunk(client, first["uploadId"], 0, b"12345678").status_code == 200

    resumed = init_upload(client)
    assert resumed["uploadId"] == first["uploadId"]
    assert resumed["offset"] == 8

    conflict = metadata(group_name="A different group label")
    response = client.post("/v1/uploads", json=conflict, headers=auth())
    assert response.status_code == 409


def test_one_uid_cannot_open_two_different_active_submissions(client):
    init_upload(client, metadata("submission_00001"))
    response = client.post(
        "/v1/uploads", json=metadata("submission_00002"), headers=auth("owner-a")
    )
    assert response.status_code in (409, 429)


def test_chunk_requires_binary_content_type_and_valid_content_length(client):
    upload_id = init_upload(client)["uploadId"]

    wrong_type = client.put(
        f"/v1/uploads/{upload_id}/chunks?offset=0",
        content=b"1234",
        headers=auth() | {"Content-Type": "text/plain", "Content-Length": "4"},
    )
    assert wrong_type.status_code == 415

    mismatched = client.put(
        f"/v1/uploads/{upload_id}/chunks?offset=0",
        content=b"1234",
        headers=auth() | {
            "Content-Type": "application/octet-stream",
            "Content-Length": "5",
        },
    )
    assert mismatched.status_code in (400, 411)


def test_chunk_enforces_size_sequential_offset_and_expected_total(client):
    upload_id = init_upload(client, metadata(size=10))["uploadId"]

    assert put_chunk(client, upload_id, 1, b"1234").status_code == 409
    assert put_chunk(client, upload_id, 0, b"123456789").status_code == 413
    first = put_chunk(client, upload_id, 0, b"12345678")
    assert first.status_code == 200
    assert first.json()["offset"] == 8
    assert put_chunk(client, upload_id, 8, b"345").status_code in (400, 413)
    assert put_chunk(client, upload_id, 8, b"90").status_code == 200


def test_status_and_resume_survive_app_restart_and_reconcile_extra_part_bytes(
    api_module, config, disk_free
):
    app1 = api_module.create_app(
        config=config, token_verifier=fake_token_verifier, disk_free_provider=disk_free
    )
    with TestClient(app1) as client1:
        upload_id = init_upload(client1)["uploadId"]
        assert put_chunk(client1, upload_id, 0, b"12345678").status_code == 200

    part_files = list(config["data_root"].rglob("*.part"))
    assert len(part_files) == 1
    with part_files[0].open("ab") as handle:
        handle.write(b"crash-garbage")

    app2 = api_module.create_app(
        config=config, token_verifier=fake_token_verifier, disk_free_provider=disk_free
    )
    with TestClient(app2) as client2:
        status = client2.get(f"/v1/uploads/{upload_id}", headers=auth())
        assert status.status_code == 200
        assert status.json()["offset"] == 8
        assert part_files[0].stat().st_size == 8
        assert put_chunk(client2, upload_id, 8, b"90abcdef").status_code == 200


def test_incomplete_upload_is_never_published_or_downloadable(client):
    upload_id = init_upload(client)["uploadId"]
    assert put_chunk(client, upload_id, 0, b"12345678").status_code == 200
    assert complete_upload(client, upload_id).status_code == 409
    assert not list(client.app.state.config.data_root.rglob("model.onnx"))


def test_completion_returns_integrity_metadata_publishes_last_and_is_idempotent(client):
    content = b"12345678abcdefgh"
    upload_id = init_upload(client, metadata(size=len(content)))["uploadId"]
    assert put_chunk(client, upload_id, 0, content[:8]).status_code == 200
    assert put_chunk(client, upload_id, 8, content[8:]).status_code == 200

    first = complete_upload(client, upload_id)
    assert first.status_code == 200
    result = first.json()
    assert result["submissionId"] == "submission_00001"
    assert result["groupKey"] == "group-1"
    assert result["groupName"] == "Nhóm 1"
    assert result["filename"] == "model.onnx"
    assert result["size"] == len(content)
    assert result["sha256"] == hashlib.sha256(content).hexdigest()
    assert result["uploadedAt"].endswith("Z")

    models = list(client.app.state.config.data_root.rglob("model.onnx"))
    assert len(models) == 1
    assert models[0].read_bytes() == content
    marker_files = [
        path
        for path in client.app.state.config.data_root.rglob("*.json")
        if json.loads(path.read_text(encoding="utf-8")).get("sha256") == result["sha256"]
    ]
    assert len(marker_files) == 1

    retry = complete_upload(client, upload_id)
    assert retry.status_code == 200
    assert retry.json() == result

    duplicate = client.post("/v1/uploads", json=metadata(), headers=auth())
    assert duplicate.status_code == 409


def test_global_active_session_cap_is_enforced(api_module, config, disk_free):
    config |= {"active_upload_cap": 2}
    app = api_module.create_app(
        config=config, token_verifier=fake_token_verifier, disk_free_provider=disk_free
    )

    def verifier(token: str):
        if token.startswith("user-"):
            return _claims(token)
        return fake_token_verifier(token)

    app = api_module.create_app(config=config, token_verifier=verifier, disk_free_provider=disk_free)
    with TestClient(app) as test_client:
        for index in range(2):
            response = test_client.post(
                "/v1/uploads",
                json=metadata(f"submission_{index:05d}"),
                headers=auth(f"user-{index}"),
            )
            assert response.status_code in (200, 201)
        blocked = test_client.post(
            "/v1/uploads",
            json=metadata("submission_00002"),
            headers=auth("user-2"),
        )
        assert blocked.status_code == 429


def test_temp_quota_reserves_expected_bytes_at_init(api_module, config, disk_free):
    config |= {"temp_quota_bytes": 20, "active_upload_cap": 10}

    def verifier(token: str):
        return _claims(token)

    app = api_module.create_app(config=config, token_verifier=verifier, disk_free_provider=disk_free)
    with TestClient(app) as test_client:
        assert test_client.post(
            "/v1/uploads", json=metadata("submission_00001", size=16), headers=auth("u1")
        ).status_code in (200, 201)
        response = test_client.post(
            "/v1/uploads", json=metadata("submission_00002", size=8), headers=auth("u2")
        )
        assert response.status_code == 507


def test_free_space_is_checked_before_init_and_every_chunk(
    api_module, config, disk_free: DiskFree
):
    disk_free.bytes = config["free_space_margin_bytes"] + 15
    app = api_module.create_app(
        config=config, token_verifier=fake_token_verifier, disk_free_provider=disk_free
    )
    with TestClient(app) as test_client:
        response = test_client.post("/v1/uploads", json=metadata(size=16), headers=auth())
        assert response.status_code == 507

    disk_free.bytes = 1_000_000
    app = api_module.create_app(
        config=config, token_verifier=fake_token_verifier, disk_free_provider=disk_free
    )
    with TestClient(app) as test_client:
        upload_id = init_upload(test_client)["uploadId"]
        disk_free.bytes = config["free_space_margin_bytes"] + 7
        response = put_chunk(test_client, upload_id, 0, b"12345678")
        assert response.status_code == 507
        status = test_client.get(f"/v1/uploads/{upload_id}", headers=auth())
        assert status.json()["offset"] == 0


def test_five_uploads_can_write_concurrently_without_offset_corruption(
    api_module, config, disk_free
):
    config |= {"temp_quota_bytes": 200, "completed_quota_bytes": 200}

    def verifier(token: str):
        return _claims(token)

    app = api_module.create_app(config=config, token_verifier=verifier, disk_free_provider=disk_free)
    with TestClient(app) as test_client:
        uploads = []
        for index in range(5):
            token = f"concurrent-{index}"
            body = metadata(f"submission_{index:05d}", size=8)
            uploads.append((init_upload(test_client, body, token)["uploadId"], token))

        with ThreadPoolExecutor(max_workers=5) as pool:
            responses = list(
                pool.map(lambda item: put_chunk(test_client, item[0], 0, b"12345678", item[1]), uploads)
            )

        assert [response.status_code for response in responses] == [200] * 5
        for upload_id, token in uploads:
            response = test_client.get(f"/v1/uploads/{upload_id}", headers=auth(token))
            assert response.json()["offset"] == 8


def test_concurrent_same_upload_same_offset_has_single_commit(client):
    upload_id = init_upload(client, metadata(size=8))["uploadId"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(
                lambda body: put_chunk(client, upload_id, 0, body),
                (b"AAAAAAAA", b"BBBBBBBB"),
            )
        )
    assert sorted(response.status_code for response in responses) == [200, 409]
    status = client.get(f"/v1/uploads/{upload_id}", headers=auth())
    assert status.json()["offset"] == 8


def test_cors_allows_only_configured_origins(client):
    allowed = client.options(
        "/v1/uploads",
        headers={
            "Origin": ALLOWED_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert allowed.status_code in (200, 204)
    assert allowed.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert "authorization" in allowed.headers["access-control-allow-headers"].lower()

    denied = client.options(
        "/v1/uploads",
        headers={"Origin": OTHER_ORIGIN, "Access-Control-Request-Method": "POST"},
    )
    assert denied.status_code == 400
    assert "access-control-allow-origin" not in denied.headers


def test_no_wildcard_cors_on_actual_responses(client):
    response = client.get("/healthz", headers={"Origin": ALLOWED_ORIGIN})
    assert response.headers["access-control-allow-origin"] == ALLOWED_ORIGIN
    assert response.headers["access-control-allow-origin"] != "*"


def test_simultaneous_matching_init_for_one_uid_creates_only_one_reservation(
    api_module, config
):
    rendezvous = threading.Barrier(2)

    def synchronized_free(_path: Path) -> int:
        rendezvous.wait(timeout=3)
        return 1_000_000

    app = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=synchronized_free,
    )
    def initialize(_index: int):
        # Separate portals let both requests enter the sync reservation boundary.
        with TestClient(app) as test_client:
            return test_client.post(
                "/v1/uploads", json=metadata(), headers=auth("owner-a")
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(initialize, range(2))
        )

    assert all(response.status_code in (200, 201) for response in responses)
    assert len({response.json()["uploadId"] for response in responses}) == 1
    assert len(list(config["data_root"].glob(".uploads/*.json"))) == 1
    assert len(list(config["data_root"].glob(".uploads/*.part"))) == 1


def test_simultaneous_init_cannot_overbook_global_active_cap(api_module, config):
    config |= {"active_upload_cap": 1}
    rendezvous = threading.Barrier(2)

    def synchronized_free(_path: Path) -> int:
        rendezvous.wait(timeout=3)
        return 1_000_000

    app = api_module.create_app(
        config=config,
        token_verifier=lambda token: _claims(token),
        disk_free_provider=synchronized_free,
    )
    requests = [
        ("race-user-a", metadata("submission_00001")),
        ("race-user-b", metadata("submission_00002")),
    ]

    def initialize(item):
        with TestClient(app) as test_client:
            return test_client.post(
                "/v1/uploads", json=item[1], headers=auth(item[0])
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(
            pool.map(initialize, requests)
        )

    assert sorted(response.status_code for response in responses) in ([201, 429], [200, 429])
    assert len(list(config["data_root"].glob(".uploads/*.json"))) == 1


def test_complete_while_chunk_commit_is_in_progress_returns_conflict_without_waiting(
    api_module, config, disk_free, monkeypatch
):
    app = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app) as test_client:
        upload_id = init_upload(test_client, metadata(size=8))["uploadId"]
        original_atomic_json = api_module._atomic_json
        commit_entered = threading.Event()
        allow_commit = threading.Event()

        def slow_atomic_json(path: Path, payload: dict) -> None:
            if payload.get("uploadId") == upload_id and payload.get("offset") == 8:
                commit_entered.set()
                assert allow_commit.wait(timeout=3), "test did not release chunk commit"
            original_atomic_json(path, payload)

        monkeypatch.setattr(api_module, "_atomic_json", slow_atomic_json)
        with ThreadPoolExecutor(max_workers=2) as pool:
            chunk_future = pool.submit(put_chunk, test_client, upload_id, 0, b"12345678")
            assert commit_entered.wait(timeout=2), "chunk never entered its persisted commit"
            complete_future = pool.submit(complete_upload, test_client, upload_id)
            timed_out = False
            try:
                completion = complete_future.result(timeout=0.5)
            except FutureTimeout:
                timed_out = True
                completion = None
            finally:
                allow_commit.set()

            assert not timed_out, "complete blocked on an in-progress async chunk"
            assert completion is not None and completion.status_code == 409
            assert chunk_future.result(timeout=2).status_code == 200


def test_restart_repairs_final_model_without_commit_marker_back_to_resumable_upload(
    api_module, config, disk_free
):
    content = b"12345678abcdefgh"
    app1 = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app1) as client1:
        upload_id = init_upload(client1, metadata(size=len(content)))["uploadId"]
        assert put_chunk(client1, upload_id, 0, content[:8]).status_code == 200
        assert put_chunk(client1, upload_id, 8, content[8:]).status_code == 200

    part = next(config["data_root"].glob(".uploads/*.part"))
    target_dir = config["data_root"] / "submissions" / "submission_00001"
    target_dir.mkdir(parents=True)
    part.replace(target_dir / "model.onnx")
    assert not (target_dir / "metadata.json").exists()

    app2 = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app2) as client2:
        status = client2.get(f"/v1/uploads/{upload_id}", headers=auth())
        assert status.status_code == 200
        assert status.json()["offset"] == len(content)
        completed = complete_upload(client2, upload_id)
        assert completed.status_code == 200
        assert completed.json()["sha256"] == hashlib.sha256(content).hexdigest()


def test_restart_promotes_valid_marker_and_model_when_upload_state_was_not_updated(
    api_module, config, disk_free
):
    content = b"12345678abcdefgh"
    app1 = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app1) as client1:
        upload_id = init_upload(client1, metadata(size=len(content)))["uploadId"]
        assert put_chunk(client1, upload_id, 0, content[:8]).status_code == 200
        assert put_chunk(client1, upload_id, 8, content[8:]).status_code == 200

    part = next(config["data_root"].glob(".uploads/*.part"))
    target_dir = config["data_root"] / "submissions" / "submission_00001"
    target_dir.mkdir(parents=True)
    part.replace(target_dir / "model.onnx")
    marker = {
        "submissionId": "submission_00001",
        "groupKey": "group-1",
        "groupName": "Nhóm 1",
        "filename": "model.onnx",
        "size": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
        "uploadedAt": "2026-08-12T12:00:00Z",
    }
    (target_dir / "metadata.json").write_text(
        json.dumps(marker, ensure_ascii=False), encoding="utf-8"
    )

    app2 = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app2) as client2:
        status = client2.get(f"/v1/uploads/{upload_id}", headers=auth())
        assert status.status_code == 200
        assert status.json()["completed"] is True
        completed = complete_upload(client2, upload_id)
        assert completed.status_code == 200
        assert completed.json() == marker


def test_startup_ttl_cleanup_removes_stale_incomplete_upload_and_frees_slot(
    api_module, config, disk_free
):
    config |= {"active_upload_cap": 1, "incomplete_ttl_seconds": 1}
    app1 = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app1) as client1:
        stale_id = init_upload(client1)["uploadId"]

    state_path = next(config["data_root"].glob(".uploads/*.json"))
    part_path = next(config["data_root"].glob(".uploads/*.part"))
    state = json.loads(state_path.read_text(encoding="utf-8"))
    state["createdAt"] = "2000-01-01T00:00:00Z"
    state["updatedAt"] = "2000-01-01T00:00:00Z"
    state_path.write_text(json.dumps(state), encoding="utf-8")
    os.utime(state_path, (1, 1))
    os.utime(part_path, (1, 1))

    app2 = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app2) as client2:
        assert client2.get(f"/v1/uploads/{stale_id}", headers=auth()).status_code == 404
        replacement = client2.post(
            "/v1/uploads",
            json=metadata("submission_00002"),
            headers=auth(),
        )
        assert replacement.status_code in (200, 201)

    assert not state_path.exists()
    assert not part_path.exists()


def test_repeated_matching_init_is_bounded_to_one_persisted_session(client):
    upload_ids = {
        init_upload(client, metadata())["uploadId"]
        for _attempt in range(25)
    }
    assert len(upload_ids) == 1
    root = client.app.state.config.data_root
    assert len(list(root.glob(".uploads/*.json"))) == 1
    assert len(list(root.glob(".uploads/*.part"))) == 1


def test_runtime_cleanup_does_not_truncate_chunk_written_before_state_commit(
    api_module, config, disk_free, monkeypatch
):
    app = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app) as setup_client:
        upload_id = init_upload(setup_client, metadata(size=8), "owner-a")["uploadId"]

    original_atomic_json = api_module._atomic_json
    chunk_written = threading.Event()
    allow_state_commit = threading.Event()

    def pause_chunk_state_commit(path: Path, payload: dict) -> None:
        if payload.get("uploadId") == upload_id and payload.get("offset") == 8:
            chunk_written.set()
            assert allow_state_commit.wait(timeout=3), "test did not release state commit"
        original_atomic_json(path, payload)

    monkeypatch.setattr(api_module, "_atomic_json", pause_chunk_state_commit)

    def upload_chunk():
        with TestClient(app) as chunk_client:
            return put_chunk(chunk_client, upload_id, 0, b"12345678", "owner-a")

    def initialize_other_upload():
        with TestClient(app) as init_client:
            return init_client.post(
                "/v1/uploads",
                json=metadata("submission_00002", size=8),
                headers=auth("owner-b"),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        chunk_future = pool.submit(upload_chunk)
        assert chunk_written.wait(timeout=2), "chunk never reached its state commit boundary"
        init_response = pool.submit(initialize_other_upload).result(timeout=2)
        allow_state_commit.set()
        chunk_response = chunk_future.result(timeout=2)

    assert init_response.status_code in (200, 201)
    assert chunk_response.status_code == 200
    part = config["data_root"] / ".uploads" / f"{upload_id}.part"
    assert part.read_bytes() == b"12345678"
    with TestClient(app) as verify_client:
        completed = complete_upload(verify_client, upload_id, "owner-a")
        assert completed.status_code == 200
        assert completed.json()["sha256"] == hashlib.sha256(b"12345678").hexdigest()


def test_runtime_cleanup_does_not_reconcile_model_while_completion_is_committing_marker(
    api_module, config, disk_free, monkeypatch
):
    app = api_module.create_app(
        config=config,
        token_verifier=fake_token_verifier,
        disk_free_provider=disk_free,
    )
    with TestClient(app) as setup_client:
        upload_id = init_upload(setup_client, metadata(size=8), "owner-a")["uploadId"]
        assert put_chunk(setup_client, upload_id, 0, b"12345678", "owner-a").status_code == 200

    target_dir = config["data_root"] / "submissions" / "submission_00001"
    model_path = target_dir / "model.onnx"
    marker_path = target_dir / "metadata.json"
    original_fsync_directory = api_module._fsync_directory
    model_renamed = threading.Event()
    allow_marker_commit = threading.Event()

    def pause_after_model_rename(path: Path) -> None:
        if path == target_dir and model_path.is_file() and not marker_path.exists():
            model_renamed.set()
            assert allow_marker_commit.wait(timeout=3), "test did not release marker commit"
        original_fsync_directory(path)

    monkeypatch.setattr(api_module, "_fsync_directory", pause_after_model_rename)

    def finish_upload():
        with TestClient(app) as complete_client:
            return complete_upload(complete_client, upload_id, "owner-a")

    def initialize_other_upload():
        with TestClient(app) as init_client:
            return init_client.post(
                "/v1/uploads",
                json=metadata("submission_00002", size=8),
                headers=auth("owner-b"),
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        complete_future = pool.submit(finish_upload)
        assert model_renamed.wait(timeout=2), "complete never reached the rename boundary"
        init_response = pool.submit(initialize_other_upload).result(timeout=2)
        assert model_path.is_file(), "runtime cleanup moved the in-flight final model"
        assert not marker_path.exists()
        allow_marker_commit.set()
        complete_response = complete_future.result(timeout=2)

    assert init_response.status_code in (200, 201)
    assert complete_response.status_code == 200
    assert model_path.read_bytes() == b"12345678"
    marker = json.loads(marker_path.read_text(encoding="utf-8"))
    assert marker["sha256"] == hashlib.sha256(b"12345678").hexdigest()
    with TestClient(app) as verify_client:
        status = verify_client.get(f"/v1/uploads/{upload_id}", headers=auth("owner-a"))
        assert status.status_code == 200
        assert status.json()["completed"] is True
