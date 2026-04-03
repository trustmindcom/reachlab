import { useState, useEffect } from "react";

interface UpdateStatus {
  available: boolean;
  can_auto_update: boolean;
  behind_count: number;
  message: string | null;
  last_checked: string | null;
}

const DISMISS_KEY = "reachlab-update-dismissed";

export default function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === "true"
  );

  useEffect(() => {
    function fetchStatus() {
      fetch("/api/system/update-status")
        .then((r) => r.json())
        .then(setStatus)
        .catch(() => {});
    }

    fetchStatus();
    const id = setInterval(fetchStatus, 30 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  if (!status?.available || !status.message || dismissed) return null;

  return (
    <div className="fixed top-3 right-3 z-[100] flex items-center gap-2 bg-warning/10 text-warning border border-warning/20 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm">
      <span>{status.message}</span>
      <button
        onClick={() => {
          setDismissed(true);
          sessionStorage.setItem(DISMISS_KEY, "true");
        }}
        className="ml-1 hover:text-warning/80 transition-colors"
        aria-label="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" />
        </svg>
      </button>
    </div>
  );
}
