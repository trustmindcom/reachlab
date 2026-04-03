import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface UpdateStatus {
  available: boolean;
  can_auto_update: boolean;
  behind_count: number;
  message: string | null;
  last_checked: string | null;
}

let currentStatus: UpdateStatus = {
  available: false,
  can_auto_update: false,
  behind_count: 0,
  message: null,
  last_checked: null,
};

async function git(cmd: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${cmd}`, { encoding: "utf-8", timeout: 30_000, cwd: await getRepoRoot() });
    return stdout.trim();
  } catch {
    return "";
  }
}

let _repoRoot: string | null = null;
async function getRepoRoot(): Promise<string> {
  if (_repoRoot) return _repoRoot;
  try {
    const { stdout } = await execAsync("git rev-parse --show-toplevel", { encoding: "utf-8", timeout: 5000 });
    _repoRoot = stdout.trim();
    return _repoRoot;
  } catch {
    return process.cwd();
  }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    await git("fetch origin main --quiet");

    const localHead = await git("rev-parse HEAD");
    const remoteHead = await git("rev-parse origin/main");

    if (!localHead || !remoteHead || localHead === remoteHead) {
      currentStatus = { available: false, can_auto_update: false, behind_count: 0, message: null, last_checked: new Date().toISOString() };
      return currentStatus;
    }

    const behindCount = parseInt(await git("rev-list --count HEAD..origin/main") || "0", 10);
    if (behindCount === 0) {
      currentStatus = { available: false, can_auto_update: false, behind_count: 0, message: null, last_checked: new Date().toISOString() };
      return currentStatus;
    }

    const dirty = await git("status --porcelain");
    const aheadCount = parseInt(await git("rev-list --count origin/main..HEAD") || "0", 10);

    if (dirty || aheadCount > 0) {
      currentStatus = {
        available: true,
        can_auto_update: false,
        behind_count: behindCount,
        message: "Update available. Local changes require manual rebase.",
        last_checked: new Date().toISOString(),
      };
      return currentStatus;
    }

    // Clean and not diverged — auto-pull
    const pullResult = await git("pull --ff-only origin main");
    if (pullResult.includes("Already up to date") || pullResult.includes("Updating")) {
      currentStatus = {
        available: false,
        can_auto_update: false,
        behind_count: 0,
        message: null,
        last_checked: new Date().toISOString(),
      };
      return currentStatus;
    }

    currentStatus = {
      available: true,
      can_auto_update: false,
      behind_count: behindCount,
      message: "Update available. Auto-update failed — try pulling manually.",
      last_checked: new Date().toISOString(),
    };
    return currentStatus;
  } catch (err) {
    console.error("[Update] Check failed:", err);
    return currentStatus;
  }
}

export function getUpdateStatus(): UpdateStatus {
  return currentStatus;
}

let intervalId: ReturnType<typeof setInterval> | undefined;

export function startUpdateChecker(): void {
  setTimeout(() => checkForUpdates(), 10_000);
  intervalId = setInterval(() => checkForUpdates(), 24 * 60 * 60 * 1000);
}

export function stopUpdateChecker(): void {
  if (intervalId) clearInterval(intervalId);
}
