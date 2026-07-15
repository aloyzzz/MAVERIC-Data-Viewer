#!/usr/bin/env python3
"""MAVERIC keep-alive supervisor.

Runs on each host (data and web). It does two jobs:

  1. Keep-alive: launches the managed Node process and relaunches it if it exits.
  2. Auto-update: polls the data server's GET /api/deploy/status. When the
     requested deploy generation is newer than the one this host last applied,
     it runs scripts/release-deploy.sh (git pull + npm ci + verify + build for
     this role), restarts the managed Node process, and reports the outcome to
     POST /api/deploy/report.

The "Update & Restart" button in the Management pane calls POST
/api/management/update, which bumps the requested generation. Both supervisors
pick it up on their next poll, so one click updates both hosts.

Configuration is via environment variables (all optional except where noted):

  MAVERIC_ROLE            "data" or "web"        (default: data)
  MAVERIC_APP_DIR         app checkout dir        (default: script's parent dir)
  MAVERIC_START_CMD       command to run the app  (default: role-based, see below)
  MAVERIC_DATA_SERVER_URL base URL of the data server for status/report calls
                          (default: http://localhost:5051)
  MAVERIC_DEPLOY_TOKEN    token for POST /api/deploy/report
                          (default: falls back to management password server-side)
  MAVERIC_RELEASE_BRANCH  branch to deploy        (default: release)
  MAVERIC_POLL_INTERVAL   seconds between status polls (default: 10)
  MAVERIC_DEPLOY_USE_SUDO passed through to release-deploy.sh (default: 0 here)

Default start commands:
  data -> npm run start        (Express API on $PORT, default 5051)
  web  -> npm run start:web     (static + /api proxy on $PORT, default 5052)
"""

import json
import os
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROLE = os.environ.get("MAVERIC_ROLE", "data")
APP_DIR = os.environ.get(
    "MAVERIC_APP_DIR",
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
)
DATA_SERVER_URL = os.environ.get("MAVERIC_DATA_SERVER_URL", "http://localhost:5051").rstrip("/")
DEPLOY_TOKEN = os.environ.get("MAVERIC_DEPLOY_TOKEN", "")
BRANCH = os.environ.get("MAVERIC_RELEASE_BRANCH", "release")
POLL_INTERVAL = float(os.environ.get("MAVERIC_POLL_INTERVAL", "10"))

DEFAULT_START = {
    "data": "npm run start",
    "web": "npm run start:web",
}
START_CMD = os.environ.get("MAVERIC_START_CMD", DEFAULT_START.get(ROLE, "npm run start"))

if ROLE not in ("data", "web"):
    print(f"[keepalive] MAVERIC_ROLE must be 'data' or 'web', got {ROLE!r}", file=sys.stderr)
    sys.exit(2)


def log(msg):
    print(f"[keepalive:{ROLE}] {time.strftime('%Y-%m-%dT%H:%M:%S')} {msg}", flush=True)


def git_sha():
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"], cwd=APP_DIR, stderr=subprocess.DEVNULL
        )
        return out.decode().strip()
    except Exception:
        return ""


def get_requested_generation():
    """Return (generation, branch) from the data server, or (None, None) on error."""
    url = f"{DATA_SERVER_URL}/api/deploy/status"
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        req = data.get("requested", {})
        return int(req.get("generation", 0)), req.get("branch", BRANCH)
    except Exception as err:
        log(f"status poll failed: {err}")
        return None, None


def report(generation, status, message=""):
    """Best-effort report of this host's applied state back to the data server."""
    url = f"{DATA_SERVER_URL}/api/deploy/report"
    body = json.dumps({
        "role": ROLE,
        "generation": generation,
        "sha": git_sha(),
        "status": status,
        "message": message[:500],
        "token": DEPLOY_TOKEN,
    }).encode()
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if DEPLOY_TOKEN:
        req.add_header("X-Deploy-Token", DEPLOY_TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=8):
            pass
    except urllib.error.HTTPError as err:
        log(f"report failed: HTTP {err.code}")
    except Exception as err:
        log(f"report failed: {err}")


class ManagedProcess:
    """Runs START_CMD and keeps it alive."""

    def __init__(self):
        self.proc = None

    def start(self):
        if self.proc and self.proc.poll() is None:
            return
        log(f"starting managed process: {START_CMD}")
        self.proc = subprocess.Popen(
            START_CMD, cwd=APP_DIR, shell=True, start_new_session=True
        )

    def stop(self):
        if not self.proc or self.proc.poll() is not None:
            return
        log("stopping managed process")
        try:
            os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
        except Exception:
            self.proc.terminate()
        try:
            self.proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            log("managed process did not exit; sending SIGKILL")
            try:
                os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
            except Exception:
                self.proc.kill()

    def restart(self):
        self.stop()
        self.start()

    def alive(self):
        return self.proc is not None and self.proc.poll() is None


def run_deploy(branch):
    """Run release-deploy.sh for this role (build only; we handle the restart).

    Returns (ok, message).
    """
    script = os.path.join(APP_DIR, "scripts", "release-deploy.sh")
    env = dict(os.environ)
    env["MAVERIC_RELEASE_BRANCH"] = branch or BRANCH
    env["MAVERIC_DEPLOY_ROLE"] = ROLE
    env["MAVERIC_APP_DIR"] = APP_DIR
    # The supervisor owns the restart, so tell the deploy script not to.
    env["MAVERIC_DATA_RESTART_CMD"] = ""
    env["MAVERIC_WEB_RESTART_CMD"] = ""
    env.setdefault("MAVERIC_DEPLOY_USE_SUDO", "0")
    log(f"running release-deploy.sh (branch={branch or BRANCH}, role={ROLE})")
    try:
        result = subprocess.run(
            ["bash", script], cwd=APP_DIR, env=env,
            capture_output=True, text=True, timeout=1800,
        )
    except subprocess.TimeoutExpired:
        return False, "deploy timed out"
    if result.returncode != 0:
        tail = (result.stderr or result.stdout or "").strip().splitlines()[-5:]
        return False, "deploy failed: " + " | ".join(tail)
    return True, "deploy ok"


def main():
    applied_generation = None  # unknown until first successful poll
    managed = ManagedProcess()
    managed.start()

    stopping = {"flag": False}

    def handle_signal(signum, _frame):
        log(f"received signal {signum}; shutting down")
        stopping["flag"] = True

    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    log(f"supervisor up. app_dir={APP_DIR} data_server={DATA_SERVER_URL} poll={POLL_INTERVAL}s")

    while not stopping["flag"]:
        # Keep-alive: relaunch the app if it died.
        if not managed.alive():
            log("managed process not running; relaunching")
            managed.start()

        # Auto-update: check for a newer requested generation.
        requested, req_branch = get_requested_generation()
        if requested is not None:
            if applied_generation is None:
                # First poll: adopt the current requested generation as baseline
                # so a restart of the supervisor doesn't redeploy needlessly.
                applied_generation = requested
                report(applied_generation, "idle", "supervisor online")
            elif requested > applied_generation:
                log(f"update requested: generation {applied_generation} -> {requested}")
                report(requested, "deploying", f"deploying {req_branch}")
                ok, message = run_deploy(req_branch)
                if ok:
                    managed.restart()
                    applied_generation = requested
                    report(requested, "ok", message)
                    log(f"applied generation {requested}")
                else:
                    report(requested, "error", message)
                    log(f"deploy error: {message}")
                    # Leave applied_generation unchanged so it retries next poll.

        # Sleep in short slices so we react to process death / signals promptly.
        waited = 0.0
        while waited < POLL_INTERVAL and not stopping["flag"]:
            if not managed.alive():
                break
            time.sleep(min(1.0, POLL_INTERVAL - waited))
            waited += 1.0

    managed.stop()
    log("supervisor stopped")


if __name__ == "__main__":
    main()
