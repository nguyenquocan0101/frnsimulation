"""Explicit Windows launcher; never auto-starts or connects to a robot."""

from __future__ import annotations

import argparse

from bridge.control.approval_ui import launch_ui
from bridge.control.ui_model import UIModel


def main(argv=None):
    parser = argparse.ArgumentParser(description="FAIRINO local approval UI")
    parser.add_argument("--dry-run", action="store_true", help="start disarmed without robot/network")
    args = parser.parse_args(argv)
    if not args.dry_run:
        raise SystemExit("Use --dry-run for the safe UI preview; production startup requires the signed Windows launcher")
    launch_ui(UIModel())


if __name__ == "__main__":
    main()
