from __future__ import annotations

import hashlib
import importlib
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TECHCAMP_ROOT = Path(__file__).resolve().parents[4] / "TechCamp-colgnaoh"
if str(TECHCAMP_ROOT) not in sys.path:
    sys.path.insert(0, str(TECHCAMP_ROOT))

from techcamp_agent import LocalAgent, RobotProfile  # noqa: E402


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
    return {"uid": token, "sub": token, "aud": "frteachxcamp", "firebase": {"sign_in_provider": "anonymous"}}


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


class InProcessAgentClient:
    """HTTP-shaped adapter used to connect the real LocalAgent to TestClient."""

    def __init__(self, client: TestClient):
        self.client = client
        self.headers = {"X-TechCamp-Agent-Token": "agent-secret", "Origin": ORIGIN}

    def heartbeat(self):
        response = self.client.post(
            "/v1/agent/heartbeat",
            json={"runtimeVersion": "techcamp-local-v1"},
            headers=self.headers,
        )
        assert response.status_code == 200, response.text
        return response.json()

    def claim_next(self):
        response = self.client.get("/v1/agent/jobs/next", headers=self.headers)
        assert response.status_code == 200, response.text
        return response.json().get("job")

    def snapshot(self, job_id):
        response = self.client.get(f"/v1/agent/jobs/{job_id}", headers=self.headers)
        assert response.status_code == 200, response.text
        return response.json()

    def event(self, job_id, **payload):
        response = self.client.post(
            f"/v1/agent/jobs/{job_id}/events",
            json=payload,
            headers=self.headers,
        )
        assert response.status_code == 200, response.text
        return response.json()


def teacher_headers(client: TestClient) -> dict[str, str]:
    response = client.post(
        "/v1/teacher/session", json={"password": "0909"}, headers={"Origin": ORIGIN}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}", "Origin": ORIGIN}


def test_teacher_to_local_agent_dry_run_is_end_to_end(client, tmp_path: Path):
    teacher = teacher_headers(client)
    payload = {
        "submissionId": "firebase_submission_001",
        "source": SOURCE,
        "sourceSha256": hashlib.sha256(SOURCE.encode()).hexdigest(),
        "robotModel": "FR5",
        "siteId": "hcm",
        "robotId": "FR5:hcm",
        "pointsTable": "points_HCM.json",
        "action": "real_run",
    }
    created = client.post("/v1/teacher/jobs", json=payload, headers=teacher)
    assert created.status_code == 201, created.text
    job_id = created.json()["jobId"]

    agent_client = InProcessAgentClient(client)
    agent_client.heartbeat()
    confirmed = client.post(
        f"/v1/teacher/jobs/{job_id}/confirm",
        json={"confirmation": "physical_run"},
        headers=teacher,
    )
    assert confirmed.status_code == 200, confirmed.text

    points = tmp_path / "points_HCM.json"
    points.write_text('{"points": []}', encoding="utf-8")
    agent = LocalAgent(
        agent_client,
        profiles={"FR5": RobotProfile("FR5", "192.168.58.2", points, "FR5", "hcm")},
        runtime_root=TECHCAMP_ROOT,
        dry_run=True,
        heartbeat_seconds=10,
        stop_poll_seconds=10,
    )
    assert agent.run_once() is True

    final = client.get(f"/v1/teacher/jobs/{job_id}", headers=teacher)
    assert final.status_code == 200, final.text
    body = final.json()
    assert body["submissionId"] == "firebase_submission_001"
    assert body["robotModel"] == "FR5"
    assert body["status"] == "succeeded"
    assert body["cleanup"]["dryRun"] is True
