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
