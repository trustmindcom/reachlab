import fs from "fs";
import path from "path";

const MAX_BACKUPS = 7;

export function backupDatabase(dbPath: string): void {
  if (!fs.existsSync(dbPath)) return;
  const stat = fs.statSync(dbPath);
  if (stat.size === 0) return;

  const dataDir = path.dirname(dbPath);
  const backupDir = path.join(dataDir, "backups");
  fs.mkdirSync(backupDir, { recursive: true });

  const today = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(backupDir, `linkedin-${today}.db`);

  // Skip if today's backup already exists
  if (fs.existsSync(backupPath)) return;

  fs.copyFileSync(dbPath, backupPath);
  console.log(`[Backup] Created daily backup: ${backupPath}`);

  // Prune old backups
  const backups = fs.readdirSync(backupDir)
    .filter((f) => f.startsWith("linkedin-") && f.endsWith(".db"))
    .sort()
    .reverse();

  for (const old of backups.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(backupDir, old));
    console.log(`[Backup] Pruned old backup: ${old}`);
  }
}
