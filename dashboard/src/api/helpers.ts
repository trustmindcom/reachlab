import { getActivePersonaId } from "../context/PersonaContext";

function getBaseUrl(): string {
  const personaId = getActivePersonaId();
  return `/api/personas/${personaId}`;
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${path}`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

/** Append personaId query param to any URL for routes not under the persona URL prefix */
export function withPersonaId(url: string): string {
  const personaId = getActivePersonaId();
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}personaId=${personaId}`;
}

// For routes not under the persona URL prefix (insights, generate, settings, sources, author-profile)
// Passes personaId as a query param so the server knows which persona to scope to.
export async function getUnscoped<T>(path: string): Promise<T> {
  const res = await fetch(withPersonaId(`/api${path}`));
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}
