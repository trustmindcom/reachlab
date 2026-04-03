import { useState, useEffect } from "react";
import { api } from "../../api/client";
import { useToast } from "../../components/Toast";

export default function ApiKeysManager() {
  const { showError } = useToast();
  const [keys, setKeys] = useState<Array<{ key: string; label: string; required: boolean; configured: boolean; prefix: string; url: string }>>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getConfigKeys()
      .then(({ keys: k }) => {
        setKeys(k);
        const v: Record<string, string> = {};
        for (const key of k) v[key.key] = "";
        setValues(v);
      })
      .catch(() => showError("Failed to load API key configuration"));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    const toSave: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (value.trim()) toSave[key] = value.trim();
    }
    if (Object.keys(toSave).length > 0) {
      try {
        await api.saveConfigKeys(toSave);
        // Refresh key status
        const { keys: updated } = await api.getConfigKeys();
        setKeys(updated);
        setValues((prev) => {
          const v = { ...prev };
          for (const key of Object.keys(v)) v[key] = "";
          return v;
        });
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch {
        showError("Failed to save API keys");
      }
    }
    setSaving(false);
  };

  const hasChanges = Object.values(values).some((v) => v.trim());

  if (keys.length === 0) return null;

  return (
    <div className="space-y-3">
      {keys.map((k) => (
        <div key={k.key} className="flex items-center gap-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[14px] text-text-secondary">{k.label}</span>
              {k.configured ? (
                <span className="text-[10px] text-green-400">configured</span>
              ) : (
                <span className="text-[10px] text-negative">missing</span>
              )}
              <a href={k.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-accent hover:underline">
                get key
              </a>
            </div>
            <input
              type="password"
              value={values[k.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [k.key]: e.target.value }))}
              placeholder={k.configured ? "Paste to replace" : `${k.prefix}...`}
              className="w-full bg-surface-2 border border-border rounded-md px-2.5 py-1.5 text-[14px] text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:border-accent font-mono"
            />
          </div>
        </div>
      ))}
      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-1.5 bg-accent text-white rounded-md text-[14px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "Saved!" : "Save keys"}
        </button>
      )}
    </div>
  );
}
