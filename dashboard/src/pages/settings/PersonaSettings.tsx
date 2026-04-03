import { useState } from "react";
import { api } from "../../api/client";
import { usePersona } from "../../context/PersonaContext";

export default function PersonaSettings() {
  const { personas, active, refreshPersonas } = usePersona();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    setError(null);
    if (!name.trim()) {
      setError("Display name is required.");
      return;
    }
    if (!url.includes("/company/")) {
      setError("URL must be a LinkedIn company page (must contain /company/).");
      return;
    }
    setSaving(true);
    try {
      const res = await api.createPersona({ name: name.trim(), linkedin_url: url.trim() });
      if ((res as any).error) {
        setError((res as any).error);
      } else {
        setName("");
        setUrl("");
        setShowForm(false);
        await refreshPersonas();
      }
    } catch {
      setError("Failed to add persona.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section>
      <div className="mb-5">
        <h3 className="text-sm font-semibold tracking-wide uppercase text-text-muted mb-0.5">
          Personas
        </h3>
        <p className="text-xs text-text-muted/70">Manage personal and company page profiles</p>
      </div>
      <div className="bg-surface-1 border border-border rounded-lg p-5 space-y-4">
        {/* Existing personas */}
        {personas.length > 0 && (
          <div className="space-y-2">
            {personas.map((p) => (
              <div
                key={p.id}
                className={`flex items-center justify-between px-4 py-3 rounded-lg border ${
                  active?.id === p.id
                    ? "border-accent/50 bg-accent/5"
                    : "border-border bg-surface-2"
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-text-primary">{p.name}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      p.type === "company_page"
                        ? "bg-accent/10 text-accent"
                        : "bg-surface-3 text-text-muted"
                    }`}
                  >
                    {p.type === "company_page" ? "Company" : "Personal"}
                  </span>
                </div>
                <a
                  href={p.linkedin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline truncate max-w-[200px]"
                >
                  {p.linkedin_url.replace(/^https?:\/\/(www\.)?linkedin\.com/, "")}
                </a>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        {showForm ? (
          <div className="space-y-3 pt-2 border-t border-border/50">
            <div>
              <label className="block text-xs text-text-muted mb-1">Display Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted mb-1">LinkedIn Company Page URL</label>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://www.linkedin.com/company/12345678/"
                className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent"
              />
              <p className="text-xs text-text-muted mt-1">
                Use the admin URL with the numeric ID. Find it at your page's admin dashboard: linkedin.com/company/<strong>12345678</strong>/admin/dashboard
              </p>
            </div>
            {error && <p className="text-xs text-negative">{error}</p>}
            <div className="flex items-center gap-3">
              <button
                onClick={handleAdd}
                disabled={saving}
                className="px-4 py-2 rounded-md text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-50"
              >
                {saving ? "Adding..." : "Add Persona"}
              </button>
              <button
                onClick={() => { setShowForm(false); setError(null); setName(""); setUrl(""); }}
                className="px-4 py-2 rounded-md text-sm font-medium bg-surface-2 text-text-primary hover:bg-surface-3 transition-colors duration-150 ease-[var(--ease-snappy)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowForm(true)}
            className="px-4 py-2 rounded-md text-sm font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors duration-150 ease-[var(--ease-snappy)]"
          >
            Add Company Page
          </button>
        )}
      </div>
    </section>
  );
}
