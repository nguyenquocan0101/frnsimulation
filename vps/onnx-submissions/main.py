"""Resumable ONNX upload API used by the TechX Camp workshop."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse


ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


def _default_config() -> dict[str, Any]:
    return {
        "data_root": Path(os.environ.get("ONNX_DATA_ROOT", "/srv/techcamp-onnx")),
        "allowed_origins": [
            item.strip()
            for item in os.environ.get(
                "ONNX_ALLOWED_ORIGINS",
                "https://fairino-robot-simulator.vercel.app,http://localhost:8080,http://127.0.0.1:8080",
            ).split(",")
            if item.strip()
        ],
        "firebase_project_id": os.environ.get("FIREBASE_PROJECT_ID", "frteachxcamp"),
        "max_file_size": 1024**3,
        "chunk_size": 8 * 1024**2,
        "active_upload_cap": 10,
        "writer_cap": 5,
        "temp_quota_bytes": 5 * 1024**3,
        "completed_quota_bytes": 20 * 1024**3,
        "free_space_margin_bytes": 5 * 1024**3,
        "incomplete_ttl_seconds": 24 * 3600,
        "teacher_password": "090909",
        "teacher_session_ttl_seconds": 3600,
        "teacher_download_ticket_ttl_seconds": 60,
    }


def _production_token_verifier(project_id: str) -> Callable[[str], dict[str, Any]]:
    def verify(token: str) -> dict[str, Any]:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token

        return id_token.verify_firebase_token(
            token,
            google_requests.Request(),
            audience=project_id,
        )

    return verify


def _atomic_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    _fsync_directory(path.parent)


def _load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _fsync_directory(path: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def create_app(
    *,
    config: dict[str, Any] | None = None,
    token_verifier: Callable[[str], dict[str, Any]] | None = None,
    disk_free_provider: Callable[[Path], int] | None = None,
) -> FastAPI:
    values = _default_config()
    if config:
        values.update(config)
    values["data_root"] = Path(values["data_root"])
    cfg = SimpleNamespace(**values)
    verifier = token_verifier or _production_token_verifier(cfg.firebase_project_id)
    free_bytes = disk_free_provider or (lambda path: shutil.disk_usage(path).free)

    uploads_dir = cfg.data_root / ".uploads"
    submissions_dir = cfg.data_root / "submissions"
    uploads_dir.mkdir(parents=True, exist_ok=True)
    submissions_dir.mkdir(parents=True, exist_ok=True)

    locks_guard = threading.Lock()
    init_lock = threading.Lock()
    upload_locks: dict[str, threading.Lock] = {}
    writer_slots = threading.BoundedSemaphore(cfg.writer_cap)
    init_attempts: dict[str, deque[float]] = defaultdict(deque)
    teacher_sessions: dict[str, float] = {}
    download_tickets: dict[str, dict[str, Any]] = {}

    def state_path(upload_id: str) -> Path:
        return uploads_dir / f"{upload_id}.json"

    def part_path(upload_id: str) -> Path:
        return uploads_dir / f"{upload_id}.part"

    def get_lock(upload_id: str) -> threading.Lock:
        with locks_guard:
            return upload_locks.setdefault(upload_id, threading.Lock())

    def parse_time(value: Any) -> float | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None

    def cleanup_and_reconcile(*, runtime: bool = False) -> None:
        now = time.time()
        for path in uploads_dir.glob("*.json"):
            held_lock: threading.Lock | None = None
            try:
                state = _load_json(path)
                if state.get("completed"):
                    continue
                upload_id = state["uploadId"]
                if runtime:
                    held_lock = get_lock(upload_id)
                    if not held_lock.acquire(blocking=False):
                        held_lock = None
                        continue
                part = part_path(upload_id)
                target_dir = submissions_dir / state["submissionId"]
                model = target_dir / "model.onnx"
                marker = target_dir / "metadata.json"

                if model.is_file() and marker.is_file():
                    result = _load_json(marker)
                    expected_hash = result.get("sha256")
                    if model.stat().st_size == state["size"] and isinstance(expected_hash, str):
                        digest = hashlib.sha256()
                        with model.open("rb") as handle:
                            for block in iter(lambda: handle.read(1024 * 1024), b""):
                                digest.update(block)
                        if hmac.compare_digest(digest.hexdigest(), expected_hash):
                            state["completed"] = True
                            state["result"] = result
                            state["offset"] = state["size"]
                            state["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                            _atomic_json(path, state)
                            continue

                if model.is_file() and not marker.is_file():
                    part.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(model, part)
                    _fsync_directory(part.parent)
                elif marker.is_file() and not model.is_file():
                    marker.unlink(missing_ok=True)

                updated = parse_time(state.get("updatedAt"))
                if updated is None:
                    updated = path.stat().st_mtime
                if now - updated > cfg.incomplete_ttl_seconds:
                    part.unlink(missing_ok=True)
                    path.unlink(missing_ok=True)
                    if target_dir.is_dir() and not any(target_dir.iterdir()):
                        target_dir.rmdir()
                    continue

                part.touch(exist_ok=True)
                committed = int(state.get("offset", 0))
                actual = part.stat().st_size
                if actual != committed:
                    with part.open("r+b") as handle:
                        handle.truncate(min(actual, committed))
                    if actual < committed:
                        state["offset"] = actual
                        _atomic_json(path, state)
            except (OSError, ValueError, KeyError, json.JSONDecodeError):
                continue
            finally:
                if held_lock is not None:
                    held_lock.release()

    cleanup_and_reconcile()

    app = FastAPI(title="TechX Camp ONNX Submissions", docs_url=None, redoc_url=None)
    app.state.config = cfg
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(cfg.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "Content-Length", "Content-Range"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        origin = request.headers.get("origin")
        if (
            request.method != "OPTIONS"
            and request.url.path.startswith("/v1/")
            and origin
            and origin not in cfg.allowed_origins
        ):
            return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    def authenticate(request: Request) -> dict[str, Any]:
        authorization = request.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            raise HTTPException(401, "Firebase bearer token required")
        try:
            claims = verifier(authorization[7:].strip())
        except Exception as error:
            raise HTTPException(401, "Invalid Firebase token") from error
        uid = claims.get("uid") or claims.get("sub")
        firebase = claims.get("firebase") or {}
        if not uid or firebase.get("sign_in_provider") != "anonymous":
            raise HTTPException(401, "Anonymous Firebase identity required")
        return {**claims, "uid": uid}

    def read_owned_state(upload_id: str, uid: str) -> dict[str, Any]:
        if not ID_RE.fullmatch(upload_id):
            raise HTTPException(404, "Upload not found")
        path = state_path(upload_id)
        if not path.is_file():
            raise HTTPException(404, "Upload not found")
        state = _load_json(path)
        if not hmac.compare_digest(str(state.get("ownerUid", "")), uid):
            raise HTTPException(403, "Upload belongs to another user")
        return state

    def all_states() -> list[dict[str, Any]]:
        states = []
        for path in uploads_dir.glob("*.json"):
            try:
                states.append(_load_json(path))
            except (OSError, ValueError, json.JSONDecodeError):
                pass
        return states

    def teacher_token(request: Request) -> str:
        authorization = request.headers.get("authorization", "")
        if not authorization.startswith("Bearer "):
            raise HTTPException(401, "Teacher session required")
        token = authorization[7:].strip()
        expires = teacher_sessions.get(token)
        if not expires or expires <= time.time():
            teacher_sessions.pop(token, None)
            raise HTTPException(401, "Teacher session expired")
        return token

    def model_record(submission_id: str) -> dict[str, Any]:
        if not ID_RE.fullmatch(submission_id):
            raise HTTPException(404, "Model not found")
        marker = submissions_dir / submission_id / "metadata.json"
        model = submissions_dir / submission_id / "model.onnx"
        if not marker.is_file() or not model.is_file():
            raise HTTPException(404, "Model not found")
        try:
            record = _load_json(marker)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            raise HTTPException(404, "Model not found") from error
        if record.get("size") != model.stat().st_size or record.get("filename") != "model.onnx":
            raise HTTPException(404, "Model not found")
        return record

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok"}

    @app.post("/v1/teacher/session")
    async def create_teacher_session(request: Request):
        try:
            body = await request.json()
        except Exception as error:
            raise HTTPException(400, "Invalid JSON") from error
        password = body.get("password") if isinstance(body, dict) else None
        if not isinstance(password, str) or not hmac.compare_digest(password, str(cfg.teacher_password)):
            raise HTTPException(401, "Invalid teacher password")
        token = secrets.token_urlsafe(32)
        teacher_sessions[token] = time.time() + float(cfg.teacher_session_ttl_seconds)
        return {"token": token, "expiresIn": float(cfg.teacher_session_ttl_seconds)}

    @app.get("/v1/teacher/models")
    async def list_teacher_models(request: Request):
        teacher_token(request)
        records = []
        for directory in submissions_dir.iterdir():
            if not directory.is_dir():
                continue
            try:
                records.append(model_record(directory.name))
            except HTTPException:
                continue
        records.sort(key=lambda item: str(item.get("uploadedAt", "")), reverse=True)
        return {"models": records}

    @app.get("/v1/teacher/models/{submission_id}")
    async def get_teacher_model(submission_id: str, request: Request):
        teacher_token(request)
        return model_record(submission_id)

    @app.post("/v1/teacher/models/{submission_id}/download-ticket")
    async def create_download_ticket(submission_id: str, request: Request):
        session = teacher_token(request)
        model_record(submission_id)
        ticket = secrets.token_urlsafe(32)
        download_tickets[ticket] = {
            "session": session,
            "submissionId": submission_id,
            "expires": time.time() + float(cfg.teacher_download_ticket_ttl_seconds),
        }
        return {"ticket": ticket, "expiresIn": float(cfg.teacher_download_ticket_ttl_seconds)}

    @app.get("/v1/teacher/models/{submission_id}/download")
    async def download_teacher_model(submission_id: str, ticket: str | None = None, request: Request = None):
        if not ticket:
            raise HTTPException(401, "Download ticket required")
        entry = download_tickets.get(ticket)
        if (
            not entry
            or entry["submissionId"] != submission_id
            or entry["expires"] <= time.time()
            or teacher_sessions.get(entry["session"], 0) <= time.time()
        ):
            raise HTTPException(403, "Invalid or expired download ticket")
        record = model_record(submission_id)
        download_tickets.pop(ticket, None)
        model_path = submissions_dir / submission_id / "model.onnx"
        return FileResponse(
            model_path,
            media_type="application/octet-stream",
            filename="model.onnx",
            headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"},
        )

    @app.post("/v1/uploads")
    async def initialize_upload(request: Request):
        claims = authenticate(request)
        try:
            body = await request.json()
        except Exception as error:
            raise HTTPException(400, "Invalid JSON") from error

        submission_id = body.get("submissionId")
        filename = body.get("filename")
        group_key = body.get("groupKey")
        group_name = body.get("groupName")
        size = body.get("size")
        if not isinstance(submission_id, str) or not ID_RE.fullmatch(submission_id):
            raise HTTPException(422, "Invalid submissionId")
        if not isinstance(filename, str) or Path(filename).name != filename or not filename.lower().endswith(".onnx"):
            raise HTTPException(422, "A safe .onnx filename is required")
        if not isinstance(group_key, str) or not group_key or len(group_key) > 64:
            raise HTTPException(422, "Invalid groupKey")
        if not isinstance(group_name, str) or not group_name.strip() or len(group_name) > 100:
            raise HTTPException(422, "Invalid groupName")
        if not isinstance(size, int) or isinstance(size, bool) or size <= 0:
            raise HTTPException(422, "Invalid file size")
        if size > cfg.max_file_size:
            raise HTTPException(413, "Model exceeds the maximum size")

        normalized = {
            "submissionId": submission_id,
            "groupKey": group_key,
            "groupName": group_name,
            "size": size,
            "filename": "model.onnx",
        }
        fingerprint = hashlib.sha256(
            json.dumps(normalized, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

        # Do the potentially slow filesystem probe before serializing the
        # scan/check/reservation transaction, then re-check all shared quotas
        # while holding the lock.
        if free_bytes(cfg.data_root) < cfg.free_space_margin_bytes + size:
            raise HTTPException(507, "Insufficient free space")

        with init_lock:
            cleanup_and_reconcile(runtime=True)
            now_monotonic = time.monotonic()
            attempts = init_attempts[claims["uid"]]
            while attempts and now_monotonic - attempts[0] > 60:
                attempts.popleft()
            if len(attempts) >= 60:
                raise HTTPException(429, "Too many upload initialization attempts")
            attempts.append(now_monotonic)

            states = all_states()
            for existing in states:
                if existing.get("submissionId") == submission_id:
                    if existing.get("completed"):
                        raise HTTPException(409, "Submission model already exists")
                    if existing.get("ownerUid") != claims["uid"] or existing.get("fingerprint") != fingerprint:
                        raise HTTPException(409, "Upload metadata conflicts with existing session")
                    return {
                        "uploadId": existing["uploadId"],
                        "offset": existing["offset"],
                        "chunkSize": cfg.chunk_size,
                    }
            if any(item.get("ownerUid") == claims["uid"] and not item.get("completed") for item in states):
                raise HTTPException(409, "This user already has an active upload")
            active = [item for item in states if not item.get("completed")]
            if len(active) >= cfg.active_upload_cap:
                raise HTTPException(429, "Too many active uploads")
            if sum(int(item.get("size", 0)) for item in active) + size > cfg.temp_quota_bytes:
                raise HTTPException(507, "Temporary upload quota exceeded")
            completed_bytes = sum(
                int(item.get("size", 0)) for item in states if item.get("completed")
            )
            if completed_bytes + size > cfg.completed_quota_bytes:
                raise HTTPException(507, "Completed model quota exceeded")

            upload_id = secrets.token_urlsafe(24).replace("-", "_")
            timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            state = {
                **normalized,
                "uploadId": upload_id,
                "ownerUid": claims["uid"],
                "fingerprint": fingerprint,
                "offset": 0,
                "completed": False,
                "createdAt": timestamp,
                "updatedAt": timestamp,
            }
            part_path(upload_id).touch(exist_ok=False)
            _atomic_json(state_path(upload_id), state)
        return JSONResponse(
            {"uploadId": upload_id, "offset": 0, "chunkSize": cfg.chunk_size},
            status_code=201,
        )

    @app.get("/v1/uploads/{upload_id}")
    async def upload_status(upload_id: str, request: Request):
        claims = authenticate(request)
        state = read_owned_state(upload_id, claims["uid"])
        return {
            "uploadId": upload_id,
            "submissionId": state["submissionId"],
            "offset": state["offset"],
            "size": state["size"],
            "completed": bool(state.get("completed")),
        }

    @app.put("/v1/uploads/{upload_id}/chunks")
    async def append_chunk(upload_id: str, offset: int, request: Request):
        claims = authenticate(request)
        if request.headers.get("content-type", "").split(";", 1)[0].strip() != "application/octet-stream":
            raise HTTPException(415, "Chunks must be application/octet-stream")
        raw_length = request.headers.get("content-length")
        try:
            content_length = int(raw_length or "")
        except ValueError as error:
            raise HTTPException(411, "Valid Content-Length required") from error
        if content_length <= 0 or content_length > cfg.chunk_size:
            raise HTTPException(413, "Invalid chunk size")

        lock = get_lock(upload_id)
        if not lock.acquire(blocking=False):
            raise HTTPException(409, "Upload is busy")
        if not writer_slots.acquire(blocking=False):
            lock.release()
            raise HTTPException(429, "Too many concurrent writers")
        try:
            state = read_owned_state(upload_id, claims["uid"])
            if state.get("completed"):
                raise HTTPException(409, "Upload is already complete")
            committed = int(state["offset"])
            if offset != committed:
                raise HTTPException(409, "Offset conflict")
            remaining = int(state["size"]) - committed
            if content_length > remaining:
                raise HTTPException(413, "Chunk exceeds declared file size")
            if free_bytes(cfg.data_root) < cfg.free_space_margin_bytes + content_length:
                raise HTTPException(507, "Insufficient free space")

            part = part_path(upload_id)
            received = 0
            try:
                with part.open("r+b") as handle:
                    handle.truncate(committed)
                    handle.seek(committed)
                    async for chunk in request.stream():
                        if not chunk:
                            continue
                        received += len(chunk)
                        if received > content_length or received > cfg.chunk_size:
                            raise HTTPException(400, "Body exceeds Content-Length")
                        handle.write(chunk)
                    if received != content_length:
                        raise HTTPException(400, "Body does not match Content-Length")
                    handle.flush()
                    os.fsync(handle.fileno())
                state["offset"] = committed + received
                state["updatedAt"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                await asyncio.to_thread(_atomic_json, state_path(upload_id), state)
            except Exception:
                with part.open("r+b") as handle:
                    handle.truncate(committed)
                raise
            return {"offset": state["offset"]}
        finally:
            writer_slots.release()
            lock.release()

    @app.post("/v1/uploads/{upload_id}/complete")
    async def complete(upload_id: str, request: Request):
        claims = authenticate(request)
        lock = get_lock(upload_id)
        if not lock.acquire(blocking=False):
            raise HTTPException(409, "Upload is busy")
        try:
            state = read_owned_state(upload_id, claims["uid"])
            if state.get("completed"):
                return state["result"]
            part = part_path(upload_id)
            if int(state["offset"]) != int(state["size"]) or not part.is_file() or part.stat().st_size != state["size"]:
                raise HTTPException(409, "Upload is incomplete")

            digest = hashlib.sha256()
            with part.open("rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(block)
            target_dir = submissions_dir / state["submissionId"]
            target_dir.mkdir(parents=True, exist_ok=True)
            model_path = target_dir / "model.onnx"
            os.replace(part, model_path)
            _fsync_directory(target_dir)
            result = {
                "submissionId": state["submissionId"],
                "groupKey": state["groupKey"],
                "groupName": state["groupName"],
                "filename": "model.onnx",
                "size": state["size"],
                "sha256": digest.hexdigest(),
                "uploadedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            }
            _atomic_json(target_dir / "metadata.json", result)
            _fsync_directory(target_dir)
            state["completed"] = True
            state["result"] = result
            state["updatedAt"] = result["uploadedAt"]
            _atomic_json(state_path(upload_id), state)
            return result
        finally:
            lock.release()

    return app


app = create_app()
