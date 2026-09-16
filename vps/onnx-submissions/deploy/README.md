# ONNX submission VPS runbook

The API listens only on `127.0.0.1:8787`; Cloudflare Quick Tunnel is the only
public entry point. Never put passwords, Firebase tokens, or private keys in
this directory or in service files.

Current workshop URL (ephemeral):
`https://obtained-durham-agent-envelope.trycloudflare.com`

For real-robot Teacher jobs, create `/etc/techcamp-onnx.secret.env` with mode
`600` and one high-entropy `TECHCAMP_AGENT_TOKEN` value. Load it through the
optional systemd `EnvironmentFile` in `onnx-submissions.service`; copy the same
value only to the Windows Local Agent. It must never be placed in the frontend,
Firebase, or a student submission.

## Install and inspect

Copy the release to `/opt/techcamp-onnx/releases/<release-id>`, create its
`.venv`, install `requirements.txt`, and point `/opt/techcamp-onnx/current` at
the release. Keep `/srv/techcamp-onnx` on the same filesystem for atomic model
renames. Install the two unit files under `/etc/systemd/system/` and copy the
non-secret settings from `onnx-submissions.env.example` to
`/etc/techcamp-onnx.env`. The API refuses to start if that env file is absent;
this prevents an accidental fallback to development defaults.

The current Teacher gate is `0909`. If an older deployment has a six-digit
`TEACHER_PASSWORD` override in `/etc/techcamp-onnx.env`, change it to `0909`
(or remove that override to use the application default) before restarting the
service.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now onnx-submissions.service
curl -fsS http://127.0.0.1:8787/healthz
sudo systemctl enable --now onnx-quick-tunnel.service
sudo systemctl is-active onnx-submissions.service onnx-quick-tunnel.service
```

The Local Agent runs on the judge PC, not on this VPS. See
`E:\fmsimulation\TechCamp-colgnaoh\docs\LOCAL_AGENT.md` for its setup and
dry-run workflow.

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

From the Windows web checkout, the release helper performs the public health
check, verifies the Vercel session, runs `npm test`, updates the frontend API
URL, and deploys production:

```powershell
cd E:\fmsimulation\frnsimulation
.\scripts\deploy-production.ps1 -TunnelUrl "https://CURRENT.trycloudflare.com"
```

Use `-SkipTests` only after a separate successful test run. The helper never
stores or prints `TECHCAMP_AGENT_TOKEN`.

If npm reports `Invalid Version` while invoking Vercel, use the pinned CLI
package instead of the unpinned `npx vercel` form:

```powershell
npx --yes vercel@59.17.0 login
npx --yes vercel@59.17.0 whoami
```

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
