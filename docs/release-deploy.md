# Release Deployment

Pushes to the `release` branch can rebuild the server and web UI through either
a server-side Git hook or GitHub Actions.

## Local package scripts

- `npm run verify` checks the TypeScript source.
- `npm run build:web` builds the React UI into `dist/`.
- `npm run build:server` verifies the TypeScript server source.
- `npm run build:all` verifies the server and builds the UI.
- `npm run deploy:release` runs `scripts/release-deploy.sh`.

## Server-side Git hook

Install the hook in the bare repository that receives pushes:

```bash
cp scripts/git-post-receive-release.sh /path/to/repo.git/hooks/post-receive
chmod +x /path/to/repo.git/hooks/post-receive
```

Useful environment variables:

```bash
export MAVERIC_RELEASE_BRANCH=release
export MAVERIC_APP_DIR=/opt/maveric/app
export MAVERIC_DEPLOY_LOG=/opt/maveric/logs/deploy.log
export MAVERIC_DEPLOY_ROLE=all
export MAVERIC_DEPLOY_USE_SUDO=1
export MAVERIC_DATA_RESTART_CMD='systemctl restart maveric-data-viewer'
export MAVERIC_WEB_RESTART_CMD='systemctl restart maveric-web-viewer'
```

`MAVERIC_DEPLOY_ROLE` can be `all`, `data`, or `web`.
`MAVERIC_DEPLOY_USE_SUDO` defaults to `1`, so both deploy scripts re-exec
through `sudo -E` when they are not already running as root. Set it to `0` for
local dry runs or hosts where the deploy user already owns the app directory.
For Git hooks and GitHub Actions SSH deploys, configure passwordless sudo for
the deploy user because these jobs run noninteractively.

## GitHub Actions

The workflow at `.github/workflows/release-deploy.yml` runs on pushes to
`release`. It always verifies TypeScript and builds the web UI. It only SSHes to
a deployment host when these repository secrets are configured:

- `RELEASE_SSH_HOST`
- `RELEASE_SSH_USER`
- `RELEASE_SSH_KEY`
- `RELEASE_APP_DIR`
- `RELEASE_DEPLOY_ROLE`
- `MAVERIC_DATA_RESTART_CMD`
- `MAVERIC_WEB_RESTART_CMD`

For split hosts, use one host-specific checkout on each machine and set
`RELEASE_DEPLOY_ROLE` to `data` or `web` for the host that should rebuild.

## One-click update from the Management pane

The Management pane (Settings -> Management) has an **Update & Restart** button
that pulls the latest release, rebuilds, and restarts both the data and web
servers without SSH or a Git push. It is driven by the keep-alive supervisor
`scripts/keepalive.py`, which must run on each host.

### How it works

1. The button calls `POST /api/management/update` on the data server, which
   increments a "requested deploy generation" stored in `deploy-state.json` on
   the data host.
2. A keep-alive supervisor runs on each host. It keeps the Node process alive
   (relaunching it if it exits) and polls `GET /api/deploy/status`.
3. When the requested generation is newer than the one a host last applied, the
   supervisor runs `scripts/release-deploy.sh` for its role (git pull, `npm ci`,
   `npm run verify`, build), restarts its managed Node process, and reports the
   result to `POST /api/deploy/report`.
4. The Management pane polls `GET /api/deploy/status` and shows per-host progress
   (deploying / up to date / behind / error).

Because both supervisors watch the same generation on the data host, one click
updates both hosts. The supervisor owns the restart, so leave
`MAVERIC_DATA_RESTART_CMD` / `MAVERIC_WEB_RESTART_CMD` unset when using it.

### Running the supervisor

On the **data host**:

```bash
MAVERIC_ROLE=data \
MAVERIC_APP_DIR=/opt/maveric/app \
MAVERIC_DATA_SERVER_URL=http://localhost:5051 \
MAVERIC_RELEASE_BRANCH=release \
MAVERIC_DEPLOY_TOKEN=<shared-token> \
python3 scripts/keepalive.py
```

On the **web host**:

```bash
MAVERIC_ROLE=web \
MAVERIC_APP_DIR=/opt/maveric/app \
MAVERIC_DATA_SERVER_URL=http://mavericdata.isi.edu:5051 \
MAVERIC_RELEASE_BRANCH=release \
MAVERIC_DEPLOY_TOKEN=<shared-token> \
python3 scripts/keepalive.py
```

Run each under a process manager (systemd, supervisord, tmux) so the supervisor
itself is restarted on host reboot. The supervisor launches the app with
`npm run start` (data) or `npm run start:web` (web) by default; override with
`MAVERIC_START_CMD`.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `MAVERIC_ROLE` | `data` | `data` or `web` — which server this supervisor manages |
| `MAVERIC_APP_DIR` | script's parent dir | App checkout to build and run |
| `MAVERIC_START_CMD` | role-based | Command to launch the app |
| `MAVERIC_DATA_SERVER_URL` | `http://localhost:5051` | Base URL for status/report calls |
| `MAVERIC_DEPLOY_TOKEN` | management password (server-side fallback) | Auth for `POST /api/deploy/report` |
| `MAVERIC_RELEASE_BRANCH` | `release` | Branch to deploy |
| `MAVERIC_POLL_INTERVAL` | `10` | Seconds between status polls |
| `MAVERIC_STATE_DIR` | app dir (data server) | Where the data server writes `deploy-state.json` |

Set `MAVERIC_DEPLOY_TOKEN` to the same value on the server (data host) and both
supervisors. If it is unset, the server accepts the management password instead.

### Related endpoints

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/management/update` | management password | Request a deploy (bumps generation) |
| `GET /api/deploy/status` | none (read-only) | Current requested + per-host applied state |
| `POST /api/deploy/report` | deploy token or password | Supervisor reports its applied state |
