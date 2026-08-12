# Phase 04 — Service and Quick Tunnel deployment

**Dependencies:** Phases 01–03 pass locally  
**Stories:** P1 workshop operator  
**Requirements:** FR-11, FR-12, FR-13

## Objective

Install a versioned, restartable loopback API on the VPS and expose it through a no-domain Cloudflare Quick Tunnel, then publish the current HTTPS URL to the web app.

## Implementation tasks

1. Re-run capacity/port/outbound preflight and capture a sanitized deployment record. Create a dedicated unprivileged `techcamp-onnx` user and directories:
   - `/opt/techcamp-onnx/releases/<release-id>` for immutable code/venv
   - `/opt/techcamp-onnx/current` symlink
   - `/srv/techcamp-onnx/submissions` for durable data
   - `/etc/techcamp-onnx.env` for origins/project/data settings
2. Copy release artifacts, create a venv, install pinned requirements, set ownership/permissions, and run API tests/health checks before switching `current`.
3. Install `onnx-submissions.service` with `User=techcamp-onnx`, loopback `127.0.0.1:8787`, bounded request/keepalive timeouts, log rotation, restart policy and hardening. Disable or redact access-log query strings so one-time download tickets never enter logs. Grant write access only to `/srv/techcamp-onnx`; confirm temp and final paths are on the same filesystem before relying on atomic rename.
4. Install cloudflared from the official package/binary checksum and `onnx-quick-tunnel.service` executing `cloudflared tunnel --url http://127.0.0.1:8787 --no-autoupdate`.
5. Start API first, then tunnel. Parse the current `https://*.trycloudflare.com` URL from `journalctl`; validate `/healthz`, CORS preflight, and auth failures externally.
6. Update only `onnx-submission-config.mjs` with the current URL, run frontend tests, commit/push main, and deploy Vercel. Test from the production simulator origin.
7. Document exact commands to inspect API/tunnel logs, find a changed URL, update the web config, redeploy, check disk, and clean stale incomplete uploads. Add a pre-workshop operator check, URL-change detection/manual republish gate, and a Firebase-only fallback if Quick Tunnel changes or is unavailable.

## Deployment verification

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onnx-submissions.service
curl -fsS http://127.0.0.1:8787/healthz
sudo systemctl enable --now onnx-quick-tunnel.service
sudo journalctl -u onnx-quick-tunnel.service -n 100 --no-pager
sudo systemctl is-active onnx-submissions.service onnx-quick-tunnel.service
```

From a machine outside the VPS network:

```bash
curl -fsS https://CURRENT.trycloudflare.com/healthz
curl -i -X OPTIONS https://CURRENT.trycloudflare.com/v1/uploads \
  -H 'Origin: https://fairino-robot-simulator.vercel.app' \
  -H 'Access-Control-Request-Method: POST'
```

## Acceptance checks

- API listens only on loopback; no ports 80/443 are opened.
- Both units restart after process failure; API survives reboot. A tunnel restart produces a URL that can be discovered from logs and manually republished.
- Production origin is allowed and an arbitrary origin is denied.
- A public upload larger than 100 MB succeeds using 8 MiB chunks; no individual Cloudflare request exceeds 8 MiB plus headers.
- Documentation names the current URL and the one-file/one-line change needed when it changes.

## Risks / stop conditions

- Quick Tunnels have no availability SLA and random URLs. If the workshop requires a stable address, stop and switch to a named tunnel/domain rather than hiding the limitation.
- A `Restart=always` tunnel can silently invalidate the web URL; do not declare the workshop ready until the public URL equals web config and the external health/upload smoke passes immediately before the session.
- Do not print SSH credentials, Firebase bearer tokens, or teacher sessions into deployment logs/transcripts.
