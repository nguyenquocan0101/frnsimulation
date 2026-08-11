# WSS localhost compatibility spike

This disposable probe must be evaluated before implementing robot control.
It is intentionally separate from the telemetry bridge and imports no robot
SDK. The target is `wss://localhost:8766`, bound only to loopback.

Record the Windows build, Chrome version, certificate thumbprint/SAN/expiry,
the exact Vercel URL, and the browser console result. A successful result must
show the first application message pairing with a fixed `health_probe` response
and no mixed-content, certificate, or local-network error.

The temporary `/wss-probe` deployment is created only for the approved spike,
then removed and redeployed. A failed probe is a BLOCK: do not fall back to
plaintext WebSocket, LAN bind, cloud relay, or disabled certificate checks.
