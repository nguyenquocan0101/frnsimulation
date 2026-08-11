"""Tk-free preview helpers plus the optional Windows approval window."""

from __future__ import annotations

from .ui_model import UIModel


def build_preview(run, *, paired=False):
    commands = tuple(run.get("commands", ())) if isinstance(run, dict) else tuple(run.commands)
    revision = run.get("points_revision") if isinstance(run, dict) else run.points_revision
    run_id = run.get("runId") if isinstance(run, dict) else run.run_id
    return {"runId": run_id, "commandCount": len(commands),
            "sourceLines": [command.line for command in commands],
            "pointsRevision": revision, "paired": bool(paired)}


def launch_ui(model: UIModel | None = None):
    """Launch the local UI only when explicitly requested by the launcher."""
    import tkinter as tk
    from tkinter import ttk
    model = model or UIModel()
    root = tk.Tk()
    root.title("FAIRINO Control — Disarmed")
    root.minsize(640, 420)
    status = tk.StringVar(value=model.message)
    ttk.Label(root, text="FAIRINO CONTROL", font=("Segoe UI", 18, "bold")).pack(padx=20, pady=(20, 4), anchor="w")
    ttk.Label(root, textvariable=status).pack(padx=20, pady=10, anchor="w")
    stop = ttk.Button(root, text="Software Stop", command=lambda: (model.stop(), status.set(model.message)))
    stop.pack(padx=20, pady=10, anchor="w")
    root.protocol("WM_DELETE_WINDOW", lambda: (model.close(), root.destroy()))
    root.mainloop()
