# ONNX submission VPS runbook

The API listens only on `127.0.0.1:8787`; Cloudflare Quick Tunnel is the only
public entry point. Never put passwords, Firebase tokens, or private keys in
this directory or in service files.

Current workshop URL (ephemeral):
`https://obtained-durham-agent-envelope.trycloudflare.com`

## Install and inspect

Copy the release to `/opt/techcamp-onnx/releases/<release-id>`, create its
`.venv`, install `requirements.txt`, and point `/opt/techcamp-onnx/current` at
the release. Keep `/srv/techcamp-onnx` on the same filesystem for atomic model
renames. Install the two unit files under `/etc/systemd/system/` and copy the
non-secret settings from `onnx-submissions.env.example` to
`/etc/techcamp-onnx.env`. The API refuses to start if that env file is absent;
this prevents an accidental fallback to development defaults.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onnx-submissions.service
curl -fsS http://127.0.0.1:8787/healthz
sudo systemctl enable --now onnx-quick-tunnel.service
sudo systemctl is-active onnx-submissions.service onnx-quick-tunnel.service
```

## Find and republish a changed Quick Tunnel URL

Quick Tunnel URLs are random and can change after restart. Inspect the latest
URL, then update the single production URL in `onnx-submission-config.mjs`, run
the frontend tests, commit/push, and redeploy Vercel. Do not declare the
workshop ready until the URL in the web app matches this output.

```bash
sudo journalctl -u onnx-quick-tunnel.service -n 100 --no-pager
curl -fsS https://CURRENT.trycloudflare.com/healthz
curl -i -X OPTIONS https://CURRENT.trycloudflare.com/v1/uploads \
  -H 'Origin: https://fairino-robot-simulator.vercel.app' \
  -H 'Access-Control-Request-Method: POST'
```

The API reserves capacity for the workshop's ten groups (20 GiB completed,
5 GiB temporary, with a safety margin). It must not expose ports 80 or 443;
verify with `ss -ltnp` after installation.

## Operations and rollback

```bash
sudo journalctl -u onnx-submissions.service -n 100 --no-pager
sudo journalctl -u onnx-quick-tunnel.service -n 100 --no-pager
df -h /srv/techcamp-onnx
find /srv/techcamp-onnx/.uploads -type f -name '*.json' -mmin +1440 -print
```

Stale incomplete uploads are cleaned by the API after their TTL; inspect first
and remove only confirmed stale state/part pairs. To roll back, stop the API,
switch `current` to the previous release, then restart; leave submission data
untouched. If Quick Tunnel is unavailable, use the Firebase-only `.py` review
fallback and do not claim ONNX upload availability.
