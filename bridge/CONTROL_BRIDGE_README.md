# FAIRINO local control bridge

The bridge is a separate WSS loopback service on `127.0.0.1:8766`; the
existing telemetry bridge remains read-only. It starts disarmed and dry-run by
default. Production mode requires a trusted localhost certificate, validated
local `points.json`, operator pairing and approval, and a physical E-stop at
the workcell. No camera, student source, token, or private key is packaged.

Run `install-control-bridge.ps1 -DryRun` for a safe rehearsal. The production
certificate/independent StopMotion capability is intentionally recorded as an
operator gate; this repository does not claim that hardware gate has passed.
