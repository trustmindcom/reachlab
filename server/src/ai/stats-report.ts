import type Database from "better-sqlite3";

// ── Types ──────────────────────────────────────────────────

export interface PostRow {
  id: string;
  hook_text: string | null;
  full_text: string | null;
  content_preview: string | null;
  content_type: string;
  published_at: string;
  impressions: number;
  reactions: number;
  comments: number;
  reposts: number;
  saves: number | null;
  sends: number | null;
}

export interface PostWithER extends PostRow {
  er: number | null;
}

// ── Stats helpers ──────────────────────────────────────────

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function iqr(values: number[]): number | null {
  if (values.length < 4) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 4)]!;
  const q3 = sorted[Math.floor((sorted.length * 3) / 4)]!;
  return q3 - q1;
}

export function cliffsDelta(x: number[], y: number[]): { d: number; label: string } {
  if (x.length === 0 || y.length === 0) return { d: 0, label: "negligible" };
  let dominance = 0;
  for (const xi of x) {
    for (const yj of y) {
      if (xi > yj) dominance++;
      else if (xi < yj) dominance--;
    }
  }
  const d = dominance / (x.length * y.length);
  const absD = Math.abs(d);
  const label =
    absD < 0.147 ? "negligible" : absD < 0.33 ? "small" : absD < 0.474 ? "medium" : "large";
  return { d, label };
}

export function computeER(
  reactions: number,
  comments: number,
  reposts: number,
  impressions: number
): number | null {
  if (impressions <= 0) return null;
  return ((reactions + comments + reposts) / impressions) * 100;
}

// ── Formatters ─────────────────────────────────────────────

export function pct(n: number): string {
  return n.toFixed(1) + "%";
}

export function getPostPreview(post: {
  hook_text: string | null;
  full_text: string | null;
  content_preview: string | null;
}): string {
  const rawText = post.hook_text ?? post.full_text ?? post.content_preview;
  if (!rawText) return "Untitled post";
  return rawText.length > 80 ? rawText.slice(0, 77) + "..." : rawText;
}

export function formatInTimezone(
  date: Date,
  tz: string,
  opts: Intl.DateTimeFormatOptions
): string {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(date);
}

export function getLocalHour(isoString: string, tz: string): number {
  const date = new Date(isoString);
  const formatted = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: tz,
  }).format(date);
  return parseInt(formatted, 10) % 24;
}

export function getLocalDayName(isoString: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: tz,
  }).format(new Date(isoString));
}

// Placeholder for buildStatsReport — implemented in Task 3
export function buildStatsReport(
  db: Database.Database,
  timezone: string,
  writingPrompt: string | null
): string {
  return "PLACEHOLDER";
}
