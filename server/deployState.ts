import { resolve } from 'path';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { dirname } from 'path';

// Coordination state for the "Update & Restart" button.
//
// The data server owns this file. When an operator clicks the button in the
// Management pane, the data server increments `requested.generation`. The
// keep-alive supervisors on each host (data + web) poll GET /api/deploy/status,
// and whenever the requested generation is newer than what they last applied
// they pull, rebuild, and restart their managed Node process, then report the
// outcome back with POST /api/deploy/report.
//
// All state lives on the data host's filesystem and is mutated only by the data
// server process, so there is a single writer and no cross-host file sharing.

export type DeployRole = 'data' | 'web';

export interface AppliedState {
  generation: number;
  sha: string;
  status: 'idle' | 'deploying' | 'ok' | 'error';
  message: string;
  at: string;
}

export interface DeployState {
  requested: {
    generation: number;
    branch: string;
    at: string;
    by: string;
  };
  applied: Record<DeployRole, AppliedState | null>;
}

const STATE_DIR = process.env.MAVERIC_STATE_DIR
  ? resolve(process.env.MAVERIC_STATE_DIR)
  : process.cwd();
const STATE_FILE = resolve(STATE_DIR, 'deploy-state.json');
const DEFAULT_BRANCH = process.env.MAVERIC_RELEASE_BRANCH ?? 'release';

function emptyState(): DeployState {
  return {
    requested: { generation: 0, branch: DEFAULT_BRANCH, at: '', by: '' },
    applied: { data: null, web: null },
  };
}

function readState(): DeployState {
  if (!existsSync(STATE_FILE)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<DeployState>;
    const base = emptyState();
    return {
      requested: { ...base.requested, ...(parsed.requested ?? {}) },
      applied: { ...base.applied, ...(parsed.applied ?? {}) },
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: DeployState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  // Atomic write so a concurrent reader never sees a half-written file.
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, STATE_FILE);
}

export function requestUpdate(by: string, branch?: string): DeployState {
  const state = readState();
  state.requested = {
    generation: state.requested.generation + 1,
    branch: branch || state.requested.branch || DEFAULT_BRANCH,
    at: new Date().toISOString(),
    by: by || 'management',
  };
  writeState(state);
  return state;
}

export function getDeployStatus(): DeployState {
  return readState();
}

export function reportDeploy(
  role: DeployRole,
  update: Partial<Omit<AppliedState, 'at'>>,
): DeployState {
  const state = readState();
  const prev = state.applied[role] ?? {
    generation: 0, sha: '', status: 'idle' as const, message: '', at: '',
  };
  state.applied[role] = {
    generation: update.generation ?? prev.generation,
    sha: update.sha ?? prev.sha,
    status: update.status ?? prev.status,
    message: update.message ?? prev.message,
    at: new Date().toISOString(),
  };
  writeState(state);
  return state;
}
