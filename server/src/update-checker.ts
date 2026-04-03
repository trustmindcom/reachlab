import { execSync } from "child_process";

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

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: "utf-8", timeout: 30_000, cwd: getRepoRoot() }).trim();
  } catch {
    return "";
  }
}

function getRepoRoot(): string {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", timeout: 5000 }).trim();
  } catch {
    return process.cwd();
  }
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    git("fetch origin main --quiet");

    const localHead = git("rev-parse HEAD");
    const remoteHead = git("rev-parse origin/main");

    if (!localHead || !remoteHead || localHead === remoteHead) {
      currentStatus = { available: false, can_auto_update: false, behind_count: 0, message: null, last_checked: new Date().toISOString() };
      return currentStatus;
    }

    const behindCount = parseInt(git("rev-list --count HEAD..origin/main") || "0", 10);
    if (behindCount === 0) {
      currentStatus = { available: false, can_auto_update: false, behind_count: 0, message: null, last_checked: new Date().toISOString() };
      return currentStatus;
    }

    const dirty = git("status --porcelain");
    const aheadCount = parseInt(git("rev-list --count origin/main..HEAD") || "0", 10);

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
    const pullResult = git("pull --ff-only origin main");
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
