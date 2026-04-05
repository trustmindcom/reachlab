import type { DiscoveryTopic } from "../../api/client";

/** sessionStorage key for locked discovery topics. */
export const LOCKED_KEY = "reachlab_locked_topics";

/**
 * Minimal sessionStorage shape — avoids direct dependency on the DOM
 * `Storage` interface for environments without window/document.
 */
interface MinimalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): MinimalStorage | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function getLockedTopics(storage: MinimalStorage | null = defaultStorage()): DiscoveryTopic[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCKED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLockedTopics(
  topics: DiscoveryTopic[],
  storage: MinimalStorage | null = defaultStorage()
): void {
  if (!storage) return;
  try {
    storage.setItem(LOCKED_KEY, JSON.stringify(topics));
  } catch {
    // Storage full or disabled — best-effort
  }
}

/** Returns locked topics followed by fresh topics, de-duped by label. */
export function mergeLocked(
  locked: DiscoveryTopic[],
  fresh: DiscoveryTopic[]
): DiscoveryTopic[] {
  const lockedLabels = new Set(locked.map((t) => t.label));
  return [...locked, ...fresh.filter((t) => !lockedLabels.has(t.label))];
}

/** Returns the set with `topic` added if absent, removed if present (by label). */
export function toggleLockedTopic(
  locked: DiscoveryTopic[],
  topic: DiscoveryTopic
): DiscoveryTopic[] {
  const has = locked.some((t) => t.label === topic.label);
  return has ? locked.filter((t) => t.label !== topic.label) : [...locked, topic];
}

export function isTopicLocked(
  locked: DiscoveryTopic[],
  topic: DiscoveryTopic
): boolean {
  return locked.some((t) => t.label === topic.label);
}
