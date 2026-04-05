import { useState, useEffect } from "react";
import { api, type HealthData } from "./api/client";
import { PersonaProvider } from "./context/PersonaContext";
import PersonaSwitcher from "./components/PersonaSwitcher";
import Overview from "./pages/Overview";
import Posts from "./pages/Posts";
import Coach from "./pages/Coach";
import Timing from "./pages/Timing";
import Followers from "./pages/Followers";
import Settings from "./pages/Settings";
import Generate from "./pages/Generate";
import OnboardingWizard from "./pages/onboarding/OnboardingWizard";
import ApiKeySetup from "./pages/onboarding/ApiKeySetup";
import { ToastProvider } from "./components/Toast";
import UpdateBadge from "./components/UpdateBadge";
import ErrorBoundary from "./components/ErrorBoundary";
import { formatTimeAgo } from "./pages/coach/components";

const tabs = ["Overview", "Posts", "Coach", "Generate", "Timing", "Followers", "Settings"] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const hash = window.location.hash.slice(1) as Tab;
    return tabs.includes(hash) ? hash : "Overview";
  });
  const [health, setHealth] = useState<HealthData | null>(null);
  const [keysConfigured, setKeysConfigured] = useState<boolean | null>(null);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(err => console.error("[App] Health check failed:", err));
    // Check API keys first, then onboarding status
    api.getConfigKeys()
      .then(({ keys }) => {
        const requiredMissing = keys.some((k) => k.required && !k.configured);
        setKeysConfigured(!requiredMissing);
      })
      .catch(err => {
        console.error("[App] API key check failed:", err);
        setKeysConfigured(true); // On error, skip key check — show main app
      });
    api.getSetting("onboarding_complete")
      .then((val) => setOnboardingComplete(val === "true"))
      .catch(err => {
        console.error("[App] Onboarding check failed:", err);
        setOnboardingComplete(true); // On error, show main app
      });
  }, []);

  useEffect(() => {
    window.location.hash = tab;
  }, [tab]);

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    api.setTimezone(tz).catch(err => console.error("[App] Failed to set timezone:", err));
  }, []);

  const hasErrors = health?.sources
    ? Object.values(health.sources).some((s) => s.status === "error")
    : false;
  const analysisDown = health?.analysis?.status === "failing";

  // Still loading
  if (keysConfigured === null || onboardingComplete === null) {
    return null;
  }

  // Show API key setup if required keys are missing
  if (!keysConfigured) {
    return (
      <ApiKeySetup
        onComplete={() => setKeysConfigured(true)}
      />
    );
  }

  // Show onboarding wizard for new users
  if (!onboardingComplete) {
    return (
      <OnboardingWizard
        onComplete={() => {
          api.setSetting("onboarding_complete", "true")
            .then(() => {
              setOnboardingComplete(true);
              window.location.hash = "Generate";
              setTab("Generate");
            })
            .catch(() => {
              // Still transition even if persist fails — user can re-run from Settings
              setOnboardingComplete(true);
              window.location.hash = "Generate";
              setTab("Generate");
            });
        }}
      />
    );
  }

  return (
    <ToastProvider>
    <PersonaProvider>
    <div className="min-h-screen">
      {/* Alert banners */}
      {hasErrors && health && (
        <div className="bg-negative/10 border-b border-negative/30 px-6 py-3 text-sm text-negative flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 4.5v4a.75.75 0 01-1.5 0v-4a.75.75 0 011.5 0z" />
          </svg>
          <span>
            Sync issues detected:{" "}
            {Object.entries(health.sources)
              .filter(([, s]) => s.status === "error")
              .map(([name]) => name)
              .join(", ")}
          </span>
        </div>
      )}
      {analysisDown && (
        <div className="bg-warning/10 border-b border-warning/30 px-6 py-3 text-sm text-warning flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 10.5a.75.75 0 110-1.5.75.75 0 010 1.5zM8.75 4.5v4a.75.75 0 01-1.5 0v-4a.75.75 0 011.5 0z" />
          </svg>
          <span>
            AI analysis has failed {health!.analysis!.consecutive_failures} times in a row — insights and coaching are not updating.
          </span>
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-50 bg-surface-0/80 backdrop-blur-md border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="font-extrabold text-accent">Reach</span><span className="font-light">Lab</span>
          </h1>
          <nav className="flex gap-1">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative px-3.5 py-1.5 rounded-md text-sm font-medium transition-colors duration-150 ease-[var(--ease-snappy)] ${
                  tab === t
                    ? "text-text-primary"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-2"
                }`}
              >
                {t}
                {tab === t && (
                  <span className="absolute -bottom-[17px] left-1 right-1 h-0.5 bg-accent rounded-full" />
                )}
              </button>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <UpdateBadge />
          <PersonaSwitcher />
          {(health?.last_sync_at || health?.analysis?.last_success) && (
            <div
              className="flex items-center gap-3 text-[11px] text-text-muted font-mono tabular-nums bg-surface-2/60 px-2.5 py-1 rounded"
              title={[
                health?.last_sync_at && `Last sync: ${new Date(health.last_sync_at + (health.last_sync_at.endsWith("Z") ? "" : "Z")).toLocaleString()}`,
                health?.analysis?.last_success && `AI analysis: ${new Date(health.analysis.last_success + (health.analysis.last_success.endsWith("Z") ? "" : "Z")).toLocaleString()}`,
              ].filter(Boolean).join("\n")}
            >
              {health?.last_sync_at && (
                <span><span className="text-text-muted/60">sync</span> {formatTimeAgo(health.last_sync_at)}</span>
              )}
              {health?.last_sync_at && health?.analysis?.last_success && (
                <span className="text-text-muted/30">·</span>
              )}
              {health?.analysis?.last_success && (
                <span><span className="text-text-muted/60">coach</span> {formatTimeAgo(health.analysis.last_success)}</span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="px-6 py-6 max-w-[1400px] mx-auto">
        {tab === "Overview" && <ErrorBoundary><Overview /></ErrorBoundary>}
        {tab === "Posts" && <ErrorBoundary><Posts /></ErrorBoundary>}
        {tab === "Coach" && <ErrorBoundary><Coach /></ErrorBoundary>}
        {tab === "Generate" && <ErrorBoundary><Generate /></ErrorBoundary>}
        {tab === "Timing" && <ErrorBoundary><Timing /></ErrorBoundary>}
        {tab === "Followers" && <ErrorBoundary><Followers /></ErrorBoundary>}
        {tab === "Settings" && <ErrorBoundary><Settings /></ErrorBoundary>}
      </main>
    </div>
    </PersonaProvider>
    </ToastProvider>
  );
}
