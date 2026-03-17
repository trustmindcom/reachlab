import type Database from "better-sqlite3";
import { insertAiLog, type AiLogInput } from "../db/ai-queries.js";

export class AiLogger {
  constructor(
    private db: Database.Database,
    private runId: number
  ) {}

  log(params: Omit<AiLogInput, "run_id">): void {
    insertAiLog(this.db, { ...params, run_id: this.runId });
  }
}
