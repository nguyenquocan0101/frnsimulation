"""Immutable operator-side configuration used by calibration validation."""

from dataclasses import dataclass
from typing import Tuple


PRODUCTION_ORIGIN = "https://fairino-robot-simulator.vercel.app"
LOCAL_DEVELOPMENT_ORIGIN = "http://127.0.0.1:8080"
ALLOWED_ORIGINS = (PRODUCTION_ORIGIN, LOCAL_DEVELOPMENT_ORIGIN)


def validate_runtime_origins(origins) -> frozenset[str]:
    """Return only a non-empty subset of the two explicit browser origins.

    The installer requires both origins.  Narrow unit/dry-run services may use
    one of them, but a caller can never widen the WSS listener to a wildcard
    or an unrelated website.
    """
    try:
        values = tuple(origins)
    except TypeError as exc:
        raise ValueError("allowed origins must be iterable") from exc
    if not values or len(values) != len(set(values)) or not all(
        isinstance(origin, str) and origin in ALLOWED_ORIGINS for origin in values
    ):
        raise ValueError("origins must be an explicit allowed-origin subset")
    return frozenset(values)


@dataclass(frozen=True)
class Profile:
    name: str = "fr5-default"
    model: str = "FR5"
    tool: int = 0
    # FAIRINO MoveJ's `user` argument is the selected workpiece frame.  The
    # calibrated FR5 workshop fixture uses frame/workpiece 0.
    user: int = 0
    workpiece: int = 0
    allowed_origins: Tuple[str, ...] = ALLOWED_ORIGINS


DEFAULT_PROFILE = Profile()
