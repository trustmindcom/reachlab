// Re-export all types for backward compatibility
export * from "./types.js";

// Re-export helpers for any direct consumers
export { get, getUnscoped, withPersonaId } from "./helpers.js";

// Import domain API objects
import { analyticsApi } from "./analytics.js";
import { generateApi } from "./generate.js";
import { settingsApi } from "./settings.js";
import { coachApi } from "./coach.js";

// Compose the unified api object — all existing imports from client.ts continue to work
export const api = {
  ...analyticsApi,
  ...generateApi,
  ...settingsApi,
  ...coachApi,
};
