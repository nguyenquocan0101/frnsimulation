"""Fail-closed installation and startup diagnostics (no robot/network I/O)."""

from __future__ import annotations

from .config import ALLOWED_ORIGINS


class InstallationError(ValueError):
    pass


def validate_config(config: dict) -> bool:
    if not isinstance(config, dict): raise InstallationError("invalid config")
    if config.get("host") not in {"127.0.0.1", "localhost", "::1"}: raise InstallationError("loopback host required")
    if config.get("port") != 8766 or config.get("scheme") != "wss": raise InstallationError("WSS control defaults required")
    origins = config.get("origins")
    if not isinstance(origins, list) or tuple(origins) != ALLOWED_ORIGINS:
        raise InstallationError("exact allowed origins required")
    if not config.get("dry_run") and config.get("disarmed") is not True: raise InstallationError("bridge must start disarmed")
    if config.get("disarmed") is not True: raise InstallationError("startup must be disarmed")
    return True


def diagnostic_report(config: dict) -> dict:
    validate_config(config)
    return {"host": config["host"], "port": config["port"], "scheme": config["scheme"],
            "mode": "dry-run" if config.get("dry_run") else "production-selected", "disarmed": True,
            "robot": "not contacted" if config.get("dry_run") else "operator confirmation required"}
