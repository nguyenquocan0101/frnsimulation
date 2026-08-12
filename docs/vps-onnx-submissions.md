# VPS ONNX submissions

The install, Quick Tunnel URL rotation, health checks, cleanup, and rollback
runbook lives at [`vps/onnx-submissions/deploy/README.md`](../vps/onnx-submissions/deploy/README.md).
The production API is loopback-only and uses the tunnel URL from
`onnx-submission-config.mjs`; no VPS credential belongs in source control.
