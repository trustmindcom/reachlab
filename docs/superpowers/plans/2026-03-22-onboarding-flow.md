# Onboarding Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a step-by-step onboarding wizard that guides new users through extension install, post analysis, voice interview, and source discovery so they get personalized topic bubbles without manual configuration.

**Architecture:** Single-page React wizard rendered in place of the main app when `onboarding_complete` setting is missing. Each step commits to the DB independently. Reuses existing interview, analysis, and source infrastructure.

**Tech Stack:** React, TypeScript, Tailwind CSS, Fastify (server), SQLite, Claude Agent SDK (source discovery)

---

## Chunk 1: Server Endpoints + App Gate

### Task 1: Generic Settings Endpoints

**Files:**
- Modify: `server/src/routes/settings.ts`
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Add GET /api/settings/:key endpoint**

In `server/src/routes/settings.ts`, add:

```typescript
app.get("/api/settings/:key", async (request, reply) => {
  const { key } = request.params as { key: string };
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return reply.status(404).send({ error: "Setting not found" });
  return { value: row.value };
});
```

- [ ] **Step 2: Add POST /api/settings endpoint (upsert)**

In `server/src/routes/settings.ts`, add:

```typescript
app.post("/api/settings", async (request) => {
  const { key, value } = request.body as { key: string; value: string };
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP"
  ).run(key, value, value);
  return { ok: true };
});
```

- [ ] **Step 3: Add client methods**

In `dashboard/src/api/client.ts`, add:

```typescript
async getSetting(key: string): Promise<string | null> {
  try {
    const res = await this.fetch(`/api/settings/${encodeURIComponent(key)}`);
    return res.value;
  } catch {
    return null;
  }
},

async setSetting(key: string, value: string): Promise<void> {
  await this.fetch("/api/settings", {
    method: "POST",
    body: JSON.stringify({ key, value }),
  });
},
```

- [ ] **Step 4: Test endpoints manually**

Run: `curl http://localhost:3211/api/settings/onboarding_complete` → expect 404
Run: `curl -X POST http://localhost:3211/api/settings -H 'Content-Type: application/json' -d '{"key":"test_key","value":"test_val"}'` → expect `{"ok":true}`
Run: `curl http://localhost:3211/api/settings/test_key` → expect `{"value":"test_val"}`

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/settings.ts dashboard/src/api/client.ts
git commit -m "feat: add generic settings GET/POST endpoints for onboarding gate"
```

### Task 2: App.tsx Onboarding Gate

**Files:**
- Modify: `dashboard/src/App.tsx`
- Create: `dashboard/src/pages/onboarding/OnboardingWizard.tsx` (stub)

- [ ] **Step 1: Create OnboardingWizard stub**

Create `dashboard/src/pages/onboarding/OnboardingWizard.tsx`:

```tsx
interface OnboardingWizardProps {
  onComplete: () => void;
}

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-text-primary mb-4">
          <span className="text-accent">Reach</span>Lab Setup
        </h1>
        <p className="text-text-secondary mb-6">Onboarding wizard coming soon...</p>
        <button
          onClick={onComplete}
          className="px-6 py-3 bg-accent text-white rounded-lg text-sm font-medium hover:opacity-90"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add onboarding gate to App.tsx**

In `App.tsx`, add state and effect:

```tsx
import OnboardingWizard from "./pages/onboarding/OnboardingWizard";

// Inside App():
const [onboardingComplete, setOnboardingComplete] = useState<boolean | null>(null);

useEffect(() => {
  api.getSetting("onboarding_complete").then((val) => {
    setOnboardingComplete(val === "true");
  });
}, []);

// Before the return, add:
if (onboardingComplete === null) {
  return null; // Loading
}

if (!onboardingComplete) {
  return (
    <OnboardingWizard onComplete={() => {
      api.setSetting("onboarding_complete", "true").then(() => {
        setOnboardingComplete(true);
      });
    }} />
  );
}
```

- [ ] **Step 3: Verify the gate works**

Run dev server. If `onboarding_complete` is not set, should see the stub wizard. Click "Skip for now" → should see the normal app. Refresh → should still see normal app (setting persisted).

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/App.tsx dashboard/src/pages/onboarding/OnboardingWizard.tsx
git commit -m "feat: add onboarding gate — show wizard for new users"
```

---

## Chunk 2: Welcome Page + Extension Setup

### Task 3: Welcome Page Component

**Files:**
- Create: `dashboard/src/pages/onboarding/WelcomePage.tsx`

- [ ] **Step 1: Build WelcomePage**

```tsx
interface WelcomePageProps {
  onStart: () => void;
}

export default function WelcomePage({ onStart }: WelcomePageProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] text-center px-4">
      <h1 className="text-[28px] font-semibold text-text-primary mb-2">
        <span className="text-accent">Reach</span>Lab
      </h1>
      <p className="text-[14px] text-text-muted mb-8 max-w-md">
        Write LinkedIn posts that sound like you, powered by AI that knows your voice.
      </p>

      <div className="flex gap-3 mb-8">
        {[
          { num: 1, label: "Connect\nLinkedIn" },
          { num: 2, label: "Voice\nInterview" },
          { num: 3, label: "Find\nSources" },
        ].map(({ num, label }) => (
          <div
            key={num}
            className="text-center px-6 py-4 bg-surface-2 border border-border rounded-xl"
          >
            <div className="text-[22px] text-accent font-light">{num}</div>
            <div className="text-[11px] text-text-muted mt-1 whitespace-pre-line">{label}</div>
          </div>
        ))}
      </div>

      <button
        onClick={onStart}
        className="px-6 py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 transition-opacity"
      >
        Get started
      </button>
      <p className="text-[11px] text-text-muted mt-3">
        ~10 minutes · makes everything work better
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/onboarding/WelcomePage.tsx
git commit -m "feat: add onboarding welcome page"
```

### Task 4: Extension Setup Component

**Files:**
- Create: `dashboard/src/pages/onboarding/ExtensionSetup.tsx`

- [ ] **Step 1: Build ExtensionSetup**

Component shows:
1. Instructions to install the Chrome extension (copy chrome://extensions URL, enable dev mode, load unpacked)
2. "Check connection" button that calls `GET /api/health`
3. After connection verified: prompt to visit LinkedIn with link to `https://www.linkedin.com/analytics/creator/content/`
4. Poll `/api/health` checking `last_sync_at` to detect when posts arrive
5. Show post count when detected, enable Continue
6. Skip link at bottom

```tsx
import { useState, useEffect, useRef } from "react";
import { api } from "../../api/client";

interface ExtensionSetupProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function ExtensionSetup({ onNext, onSkip }: ExtensionSetupProps) {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [synced, setSynced] = useState(false);
  const [postCount, setPostCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const checkConnection = async () => {
    setChecking(true);
    setError(null);
    try {
      const health = await api.health();
      if (health) {
        setConnected(true);
        if (health.last_sync_at) {
          setSynced(true);
          setPostCount(health.post_count ?? 0);
        }
      }
    } catch {
      setError("Can't reach the server. Make sure ReachLab is running.");
    } finally {
      setChecking(false);
    }
  };

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const health = await api.health();
        if (health?.last_sync_at) {
          setSynced(true);
          setPostCount(health.post_count ?? 0);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 3000);
  };

  const copyUrl = () => {
    navigator.clipboard.writeText("chrome://extensions");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-[20px] font-semibold text-text-primary mb-2">Connect LinkedIn</h2>
      <p className="text-[13px] text-text-secondary mb-6">
        Install the ReachLab Chrome extension to import your LinkedIn posts.
      </p>

      <div className="space-y-4 mb-6">
        <div className="flex gap-3 items-start">
          <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-[13px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
          <div>
            <p className="text-[13px] text-text-primary">Open Chrome extensions page</p>
            <button onClick={copyUrl} className="text-[12px] text-accent hover:underline mt-0.5">
              {copied ? "Copied!" : "Copy chrome://extensions"}
            </button>
          </div>
        </div>
        <div className="flex gap-3 items-start">
          <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-[13px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
          <p className="text-[13px] text-text-primary">Enable "Developer mode" (toggle in top-right)</p>
        </div>
        <div className="flex gap-3 items-start">
          <span className="w-6 h-6 rounded-full bg-accent/10 text-accent text-[13px] font-semibold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
          <p className="text-[13px] text-text-primary">Click "Load unpacked" and select the <code className="text-[12px] bg-surface-2 px-1.5 py-0.5 rounded">extension/</code> folder</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">
          {error}
        </div>
      )}

      {!connected ? (
        <button
          onClick={checkConnection}
          disabled={checking}
          className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 disabled:opacity-50"
        >
          {checking ? "Checking..." : "Check connection"}
        </button>
      ) : !synced ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[13px] text-positive">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.3 5.3l-4 4a.75.75 0 01-1.1 0l-2-2a.75.75 0 111.1-1.1L6.8 8.7l3.4-3.4a.75.75 0 111.1 1.1z"/></svg>
            Extension connected!
          </div>
          <p className="text-[13px] text-text-secondary">
            Now visit LinkedIn to import your posts:
          </p>
          <a
            href="https://www.linkedin.com/analytics/creator/content/"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => startPolling()}
            className="block w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium text-center hover:opacity-90"
          >
            Open LinkedIn Analytics
          </a>
          <p className="text-[12px] text-text-muted text-center">Waiting for posts to sync...</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-[13px] text-positive">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm3.3 5.3l-4 4a.75.75 0 01-1.1 0l-2-2a.75.75 0 111.1-1.1L6.8 8.7l3.4-3.4a.75.75 0 111.1 1.1z"/></svg>
            Found {postCount} posts!
          </div>
          <button
            onClick={onNext}
            className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90"
          >
            Continue
          </button>
        </div>
      )}

      <button
        onClick={onSkip}
        className="w-full mt-4 py-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors"
      >
        I'll do this later
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/onboarding/ExtensionSetup.tsx
git commit -m "feat: add extension setup step for onboarding"
```

### Task 5: Wire Steps 0-1 into Wizard

**Files:**
- Modify: `dashboard/src/pages/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Implement wizard state machine with Steps 0-1**

```tsx
import { useState } from "react";
import WelcomePage from "./WelcomePage";
import ExtensionSetup from "./ExtensionSetup";

interface OnboardingWizardProps {
  onComplete: () => void;
}

type Step = "welcome" | "extension" | "analyze" | "interview" | "sources" | "done";

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>("welcome");

  return (
    <div className="min-h-screen bg-surface-0">
      {/* Progress bar */}
      {step !== "welcome" && step !== "done" && (
        <div className="fixed top-0 left-0 right-0 h-1 bg-surface-2 z-50">
          <div
            className="h-full bg-accent transition-all duration-500"
            style={{
              width: {
                extension: "20%",
                analyze: "40%",
                interview: "60%",
                sources: "80%",
              }[step],
            }}
          />
        </div>
      )}

      <div className="max-w-2xl mx-auto px-6 py-12">
        {step === "welcome" && (
          <WelcomePage onStart={() => setStep("extension")} />
        )}
        {step === "extension" && (
          <ExtensionSetup
            onNext={() => setStep("analyze")}
            onSkip={() => setStep("analyze")}
          />
        )}
        {step === "analyze" && (
          <div className="text-center py-20 text-text-muted">Analyze step (Task 6)</div>
        )}
        {step === "interview" && (
          <div className="text-center py-20 text-text-muted">Interview step (Task 7)</div>
        )}
        {step === "sources" && (
          <div className="text-center py-20 text-text-muted">Sources step (Task 8)</div>
        )}
        {step === "done" && (
          <div className="text-center py-20 text-text-muted">Done step (Task 9)</div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test the flow**

Run dev, verify: Welcome page → Get started → Extension setup → Skip → placeholder analyze step.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/onboarding/OnboardingWizard.tsx
git commit -m "feat: wire welcome + extension steps into onboarding wizard"
```

---

## Chunk 3: Analysis + Interview Steps

### Task 6: Analyze Writing Component

**Files:**
- Create: `dashboard/src/pages/onboarding/AnalyzeWriting.tsx`
- Modify: `dashboard/src/pages/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Build AnalyzeWriting component**

Component that:
- On mount, checks if posts exist via `/api/health` (`post_count`)
- If no posts: shows skip message
- If posts exist: triggers `POST /api/ai/refresh`, polls `GET /api/ai-runs` for completion
- Shows ScannerLoader during analysis (import from generate/DiscoveryView or extract to shared)
- After analysis: shows taxonomy topics as pills, shows writing prompt in textarea
- Edit button for writing prompt, Continue button

```tsx
import { useState, useEffect } from "react";
import { api } from "../../api/client";

interface AnalyzeWritingProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function AnalyzeWriting({ onNext, onSkip }: AnalyzeWritingProps) {
  const [phase, setPhase] = useState<"checking" | "no-posts" | "analyzing" | "done">("checking");
  const [topics, setTopics] = useState<string[]>([]);
  const [writingPrompt, setWritingPrompt] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("Reading your posts...");

  useEffect(() => {
    checkAndAnalyze();
  }, []);

  const checkAndAnalyze = async () => {
    try {
      const health = await api.health();
      const postCount = health?.post_count ?? 0;
      if (postCount === 0) {
        setPhase("no-posts");
        return;
      }

      setPhase("analyzing");

      // Trigger analysis
      await api.triggerAiRefresh();

      // Poll for completion
      const msgs = ["Reading your posts...", "Finding your topics...", "Building your writing profile..."];
      let msgIdx = 0;
      const msgTimer = setInterval(() => {
        msgIdx = Math.min(msgIdx + 1, msgs.length - 1);
        setMessage(msgs[msgIdx]);
      }, 4000);

      const pollTimer = setInterval(async () => {
        try {
          const runs = await api.getAiRuns();
          const latest = runs[0];
          if (latest && latest.status === "completed") {
            clearInterval(pollTimer);
            clearInterval(msgTimer);
            await loadResults();
            setPhase("done");
          }
        } catch {}
      }, 2000);
    } catch (err: any) {
      setError(err.message ?? "Analysis failed");
      setPhase("done");
    }
  };

  const loadResults = async () => {
    try {
      const taxonomy = await api.getTaxonomy();
      setTopics(taxonomy.map((t: any) => t.name));
      const prompt = await api.getWritingPrompt();
      setWritingPrompt(prompt ?? "");
    } catch {}
  };

  const savePrompt = async () => {
    try {
      await api.updateWritingPrompt(writingPrompt);
      setEditing(false);
    } catch {}
  };

  if (phase === "checking") {
    return <div className="text-center py-20 text-text-muted text-[13px]">Checking your posts...</div>;
  }

  if (phase === "no-posts") {
    return (
      <div className="max-w-lg mx-auto text-center">
        <h2 className="text-[20px] font-semibold text-text-primary mb-2">No posts to analyze yet</h2>
        <p className="text-[13px] text-text-secondary mb-6">
          After your first LinkedIn sync, come back to Settings to run the analysis.
        </p>
        <button onClick={onSkip} className="px-6 py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90">
          Continue
        </button>
      </div>
    );
  }

  if (phase === "analyzing") {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="relative w-20 h-20 mb-6">
          <div className="absolute inset-0 rounded-full border-2 border-accent/20 animate-ping" />
          <div className="absolute inset-2 rounded-full border-2 border-accent/40 animate-pulse" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-accent" />
          </div>
        </div>
        <p className="text-[13px] text-text-muted">{message}</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-[20px] font-semibold text-text-primary mb-2">Here's what we found</h2>
      <p className="text-[13px] text-text-secondary mb-6">
        We analyzed your posts and identified your topics and writing style.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">{error}</div>
      )}

      {topics.length > 0 && (
        <div className="mb-6">
          <h3 className="text-[13px] font-medium text-text-primary mb-2">Your topics</h3>
          <div className="flex flex-wrap gap-2">
            {topics.map((t) => (
              <span key={t} className="px-3 py-1.5 bg-surface-2 border border-border rounded-full text-[12px] text-text-secondary">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {writingPrompt && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-[13px] font-medium text-text-primary">Writing prompt</h3>
            {!editing && (
              <button onClick={() => setEditing(true)} className="text-[12px] text-accent hover:underline">Edit</button>
            )}
          </div>
          {editing ? (
            <div>
              <textarea
                value={writingPrompt}
                onChange={(e) => setWritingPrompt(e.target.value)}
                rows={6}
                className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent resize-none"
              />
              <button onClick={savePrompt} className="mt-2 px-4 py-2 bg-accent text-white rounded-lg text-[12px] font-medium hover:opacity-90">
                Save
              </button>
            </div>
          ) : (
            <div className="bg-surface-2 border border-border rounded-lg p-3 text-[12px] text-text-secondary max-h-32 overflow-y-auto whitespace-pre-wrap">
              {writingPrompt}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onNext}
        className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90"
      >
        Looks good, continue
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify API methods exist**

Check `client.ts` for: `triggerAiRefresh`, `getAiRuns`, `getTaxonomy`, `getWritingPrompt`, `updateWritingPrompt`. Add any that are missing.

- [ ] **Step 3: Wire into wizard**

Replace the analyze placeholder in `OnboardingWizard.tsx`:
```tsx
import AnalyzeWriting from "./AnalyzeWriting";
// ...
{step === "analyze" && (
  <AnalyzeWriting onNext={() => setStep("interview")} onSkip={() => setStep("interview")} />
)}
```

- [ ] **Step 4: Test the flow**

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/onboarding/AnalyzeWriting.tsx dashboard/src/pages/onboarding/OnboardingWizard.tsx dashboard/src/api/client.ts
git commit -m "feat: add post analysis step to onboarding"
```

### Task 7: Voice Interview Component

**Files:**
- Create: `dashboard/src/pages/onboarding/VoiceInterview.tsx`
- Modify: `dashboard/src/pages/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Build VoiceInterview wrapper**

This wraps the existing `InterviewModal` logic but inline (not a modal). Reuse `useRealtimeInterview` hook directly.

```tsx
import { useState } from "react";
import { api } from "../../api/client";
import { useRealtimeInterview } from "../../hooks/useRealtimeInterview";

interface VoiceInterviewProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function VoiceInterview({ onNext, onSkip }: VoiceInterviewProps) {
  const { status, elapsed, transcript, error, start, stop } = useRealtimeInterview();
  const [phase, setPhase] = useState<"pre" | "active" | "extracting" | "review">("pre");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [company, setCompany] = useState("");
  const [bio, setBio] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [noApiKey, setNoApiKey] = useState(false);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleStart = async () => {
    try {
      await start({ name, role, company, bio });
      setPhase("active");
    } catch (err: any) {
      if (err.message?.includes("OPENAI_API_KEY")) {
        setNoApiKey(true);
      }
    }
  };

  const handleStop = async () => {
    stop();
    setPhase("extracting");
    const transcriptText = transcript
      .map((t) => `${t.role === "user" ? "User" : "Interviewer"}: ${t.text}`)
      .join("\n\n");

    if (!transcriptText.trim()) {
      setExtractError("No conversation captured. Try again.");
      setPhase("pre");
      return;
    }

    try {
      const result = await api.extractProfile(transcriptText, elapsed);
      setExtractedText(result.profile_text);
      setPhase("review");
    } catch (err: any) {
      setExtractError(err.message ?? "Extraction failed");
      setPhase("pre");
    }
  };

  const handleSave = async () => {
    await api.saveAuthorProfile(extractedText);
    onNext();
  };

  if (noApiKey) {
    return (
      <div className="max-w-lg mx-auto text-center">
        <h2 className="text-[20px] font-semibold text-text-primary mb-2">Voice interview unavailable</h2>
        <p className="text-[13px] text-text-secondary mb-6">
          This feature requires an OpenAI API key. You can configure it in your environment and do the interview later from Settings.
        </p>
        <button onClick={onSkip} className="px-6 py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90">
          Continue without interview
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-[20px] font-semibold text-text-primary mb-2">Tell us about yourself</h2>
      <p className="text-[13px] text-text-secondary mb-6">
        A 5-minute voice conversation to capture what makes your perspective distinctive.
      </p>

      {(error || extractError) && (
        <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">
          {error || extractError}
        </div>
      )}

      {phase === "pre" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Name", value: name, set: setName, placeholder: "Your name" },
              { label: "Role", value: role, set: setRole, placeholder: "e.g. Engineering Manager" },
              { label: "Company", value: company, set: setCompany, placeholder: "Where you work" },
              { label: "Brief bio", value: bio, set: setBio, placeholder: "One sentence about what you do" },
            ].map(({ label, value, set, placeholder }) => (
              <div key={label}>
                <label className="text-[11px] text-text-muted block mb-1">{label}</label>
                <input
                  value={value}
                  onChange={(e) => set(e.target.value)}
                  placeholder={placeholder}
                  className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            ))}
          </div>
          <button
            onClick={handleStart}
            disabled={status === "connecting"}
            className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 disabled:opacity-50"
          >
            {status === "connecting" ? "Connecting..." : "Start Interview"}
          </button>
        </div>
      )}

      {phase === "active" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-4 h-4 bg-negative rounded-full animate-pulse" />
              </div>
              <span className="text-[13px] font-medium text-text-primary">Interview in progress</span>
            </div>
            <span className="text-2xl font-mono text-text-primary tabular-nums">{formatTime(elapsed)}</span>
          </div>
          <div className="bg-surface-2 rounded-lg p-4 max-h-48 overflow-y-auto space-y-2">
            {transcript.length === 0 ? (
              <p className="text-[13px] text-text-muted italic">Waiting for conversation...</p>
            ) : transcript.map((t, i) => (
              <div key={i} className={`text-[13px] ${t.role === "user" ? "text-text-primary" : "text-accent"}`}>
                <span className="text-[11px] text-text-muted font-medium">{t.role === "user" ? "You" : "AI"}:</span> {t.text}
              </div>
            ))}
          </div>
          <button onClick={handleStop} className="w-full py-3 bg-surface-2 text-text-primary rounded-xl text-[14px] font-medium border border-border hover:bg-surface-3">
            End Interview
          </button>
        </div>
      )}

      {phase === "extracting" && (
        <div className="text-center py-16 text-text-muted">
          <div className="animate-spin h-6 w-6 border-2 border-accent border-t-transparent rounded-full mx-auto mb-3" />
          <p className="text-[13px]">Extracting your profile...</p>
        </div>
      )}

      {phase === "review" && (
        <div className="space-y-4">
          <div>
            <label className="text-[11px] text-text-muted block mb-1">Extracted profile</label>
            <textarea
              value={extractedText}
              onChange={(e) => setExtractedText(e.target.value)}
              rows={6}
              className="w-full bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary focus:outline-none focus:border-accent resize-none"
            />
          </div>
          <button onClick={handleSave} className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90">
            Save & Continue
          </button>
        </div>
      )}

      <button onClick={onSkip} className="w-full mt-4 py-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors">
        Skip for now
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into wizard**

Replace interview placeholder in `OnboardingWizard.tsx`.

- [ ] **Step 3: Verify `saveAuthorProfile` exists in client.ts, add if missing**

- [ ] **Step 4: Test**

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/pages/onboarding/VoiceInterview.tsx dashboard/src/pages/onboarding/OnboardingWizard.tsx
git commit -m "feat: add voice interview step to onboarding"
```

---

## Chunk 4: Source Discovery + Completion

### Task 8: Source Discovery Endpoint

**Files:**
- Modify: `server/src/routes/generate.ts`
- Create: `server/src/ai/source-discoverer.ts`

- [ ] **Step 1: Create source discovery module**

`server/src/ai/source-discoverer.ts` — Uses Claude API (not Agent SDK for now — keep it simple with tool_use for web search via Perplexity/Sonar):

```typescript
import { searchWithSonarPro } from "./perplexity.js";
import { discoverFeeds, discoverFeedsByGuessing } from "./feed-discoverer.js";

interface DiscoveredSource {
  name: string;
  url: string;
  feed_url: string | null;
  description: string;
}

export async function discoverSources(topics: string[]): Promise<DiscoveredSource[]> {
  const topicStr = topics.slice(0, 10).join(", ");

  // Use Perplexity to find relevant blogs/newsletters for these topics
  const query = `Find 10-15 high-quality blogs, newsletters, and news sources that regularly publish about: ${topicStr}. For each, provide the name, URL, and a one-sentence description. Focus on individual expert blogs and niche publications, not generic news sites. Return as a JSON array with fields: name, url, description.`;

  const result = await searchWithSonarPro(query);

  // Parse the response to extract sources
  let sources: DiscoveredSource[] = [];
  try {
    // Try to find JSON array in the response
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      sources = parsed.map((s: any) => ({
        name: String(s.name || ""),
        url: String(s.url || ""),
        feed_url: null,
        description: String(s.description || ""),
      })).filter((s: DiscoveredSource) => s.name && s.url);
    }
  } catch {
    // If parsing fails, return empty — user can add manually
  }

  // Try to discover RSS feeds for each source
  for (const source of sources) {
    try {
      const feeds = await discoverFeeds(source.url);
      if (feeds.length > 0) {
        source.feed_url = feeds[0].url;
      } else {
        const guessed = await discoverFeedsByGuessing(source.url);
        if (guessed.length > 0) {
          source.feed_url = guessed[0].url;
        }
      }
    } catch {
      // Feed discovery is best-effort
    }
  }

  return sources;
}
```

- [ ] **Step 2: Add endpoint**

In `server/src/routes/generate.ts`:

```typescript
app.post("/api/sources/discover", async (request) => {
  const { topics } = request.body as { topics?: string[] };

  // Fall back to taxonomy topics if none provided
  let topicList = topics;
  if (!topicList || topicList.length === 0) {
    const rows = db.prepare("SELECT name FROM ai_taxonomy ORDER BY name").all() as { name: string }[];
    topicList = rows.map((r) => r.name);
  }

  if (topicList.length === 0) {
    return { sources: [] };
  }

  const { discoverSources } = await import("../ai/source-discoverer.js");
  const sources = await discoverSources(topicList);
  return { sources };
});
```

- [ ] **Step 3: Add client method**

```typescript
async discoverSources(topics?: string[]): Promise<Array<{ name: string; url: string; feed_url: string | null; description: string }>> {
  const res = await this.fetch("/api/sources/discover", {
    method: "POST",
    body: JSON.stringify({ topics }),
  });
  return res.sources;
},
```

- [ ] **Step 4: Commit**

```bash
git add server/src/ai/source-discoverer.ts server/src/routes/generate.ts dashboard/src/api/client.ts
git commit -m "feat: add source discovery endpoint using Perplexity + feed detection"
```

### Task 9: Source Discovery Component

**Files:**
- Create: `dashboard/src/pages/onboarding/SourceDiscovery.tsx`
- Modify: `dashboard/src/pages/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Build SourceDiscovery component**

```tsx
import { useState, useEffect } from "react";
import { api } from "../../api/client";

interface DiscoveredSource {
  name: string;
  url: string;
  feed_url: string | null;
  description: string;
  selected: boolean;
}

interface SourceDiscoveryProps {
  onNext: () => void;
  onSkip: () => void;
}

export default function SourceDiscovery({ onNext, onSkip }: SourceDiscoveryProps) {
  const [phase, setPhase] = useState<"discovering" | "selecting" | "saving">("discovering");
  const [sources, setSources] = useState<DiscoveredSource[]>([]);
  const [manualUrl, setManualUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    discover();
  }, []);

  const discover = async () => {
    try {
      const result = await api.discoverSources();
      setSources(result.map((s) => ({ ...s, selected: true })));
      setPhase("selecting");
    } catch (err: any) {
      setError(err.message ?? "Source discovery failed");
      setPhase("selecting");
    }
  };

  const toggleSource = (idx: number) => {
    setSources((prev) => prev.map((s, i) => i === idx ? { ...s, selected: !s.selected } : s));
  };

  const addManual = async () => {
    const url = manualUrl.trim();
    if (!url) return;
    try {
      const result = await api.addSource(url);
      setSources((prev) => [...prev, { name: result.name || url, url, feed_url: result.feed_url, description: "", selected: true }]);
      setManualUrl("");
    } catch (err: any) {
      setError(err.message ?? "Failed to add source");
    }
  };

  const saveAndContinue = async () => {
    setPhase("saving");
    const selected = sources.filter((s) => s.selected);
    for (const source of selected) {
      if (source.feed_url) {
        try {
          await api.addSource(source.url);
        } catch {
          // Best effort
        }
      }
    }
    onNext();
  };

  if (phase === "discovering") {
    return (
      <div className="text-center py-24">
        <div className="animate-spin h-6 w-6 border-2 border-accent border-t-transparent rounded-full mx-auto mb-3" />
        <p className="text-[13px] text-text-muted">Finding sources for your topics...</p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <h2 className="text-[20px] font-semibold text-text-primary mb-2">Your news sources</h2>
      <p className="text-[13px] text-text-secondary mb-6">
        We found sources relevant to your topics. Uncheck any you don't want.
      </p>

      {error && (
        <div className="mb-4 p-3 bg-negative/10 border border-negative/20 rounded-lg text-[13px] text-negative">{error}</div>
      )}

      {sources.length > 0 && (
        <div className="space-y-2 mb-6 max-h-64 overflow-y-auto">
          {sources.map((s, i) => (
            <label key={i} className="flex items-start gap-3 p-3 bg-surface-2 border border-border rounded-lg cursor-pointer hover:bg-surface-3 transition-colors">
              <input
                type="checkbox"
                checked={s.selected}
                onChange={() => toggleSource(i)}
                className="mt-0.5 accent-accent"
              />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-text-primary truncate">{s.name}</div>
                {s.description && <div className="text-[11px] text-text-muted mt-0.5">{s.description}</div>}
                <div className="text-[11px] text-text-muted truncate">{s.url}</div>
              </div>
            </label>
          ))}
        </div>
      )}

      {sources.length === 0 && !error && (
        <p className="text-[13px] text-text-muted mb-6">No sources discovered. You can add some manually below.</p>
      )}

      <div className="flex gap-2 mb-6">
        <input
          type="text"
          value={manualUrl}
          onChange={(e) => setManualUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addManual()}
          placeholder="Add a website URL..."
          className="flex-1 bg-surface-2 border border-border rounded-lg px-3 py-2 text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
        <button
          onClick={addManual}
          disabled={!manualUrl.trim()}
          className="px-4 py-2 bg-accent text-white rounded-lg text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      <button
        onClick={saveAndContinue}
        disabled={phase === "saving"}
        className="w-full py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90 disabled:opacity-50"
      >
        {phase === "saving" ? "Saving..." : "Save sources & continue"}
      </button>

      <button onClick={onSkip} className="w-full mt-4 py-2 text-[12px] text-text-muted hover:text-text-secondary transition-colors">
        Use default sources
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into wizard**

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/onboarding/SourceDiscovery.tsx dashboard/src/pages/onboarding/OnboardingWizard.tsx
git commit -m "feat: add source discovery step to onboarding"
```

### Task 10: Setup Complete Component

**Files:**
- Create: `dashboard/src/pages/onboarding/SetupComplete.tsx`
- Modify: `dashboard/src/pages/onboarding/OnboardingWizard.tsx`

- [ ] **Step 1: Build SetupComplete**

```tsx
import { useState, useEffect } from "react";
import { api } from "../../api/client";

interface SetupCompleteProps {
  onFinish: () => void;
}

export default function SetupComplete({ onFinish }: SetupCompleteProps) {
  const [stats, setStats] = useState({ topics: 0, sources: 0, hasProfile: false });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const [taxonomy, sources, profile] = await Promise.all([
        api.getTaxonomy().catch(() => []),
        api.getSources().catch(() => []),
        api.getAuthorProfile().catch(() => null),
      ]);
      setStats({
        topics: taxonomy.length,
        sources: sources.filter((s: any) => s.enabled).length,
        hasProfile: !!profile?.profile_text,
      });
    } catch {}
  };

  return (
    <div className="max-w-lg mx-auto text-center">
      <div className="text-[48px] mb-4">&#10003;</div>
      <h2 className="text-[24px] font-semibold text-text-primary mb-2">You're all set!</h2>
      <p className="text-[13px] text-text-secondary mb-8">
        ReachLab is configured and ready to help you write.
      </p>

      <div className="flex justify-center gap-6 mb-8">
        {stats.topics > 0 && (
          <div className="text-center">
            <div className="text-[20px] font-semibold text-accent">{stats.topics}</div>
            <div className="text-[11px] text-text-muted">topics</div>
          </div>
        )}
        {stats.sources > 0 && (
          <div className="text-center">
            <div className="text-[20px] font-semibold text-accent">{stats.sources}</div>
            <div className="text-[11px] text-text-muted">sources</div>
          </div>
        )}
        {stats.hasProfile && (
          <div className="text-center">
            <div className="text-[20px] font-semibold text-accent">&#10003;</div>
            <div className="text-[11px] text-text-muted">voice profile</div>
          </div>
        )}
      </div>

      <button
        onClick={onFinish}
        className="px-8 py-3 bg-accent text-white rounded-xl text-[14px] font-medium hover:opacity-90"
      >
        Start writing
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire into wizard + set onboarding_complete on finish**

The wizard's `onComplete` prop already handles setting `onboarding_complete = true`.

- [ ] **Step 3: Commit**

```bash
git add dashboard/src/pages/onboarding/SetupComplete.tsx dashboard/src/pages/onboarding/OnboardingWizard.tsx
git commit -m "feat: add setup complete step and finalize onboarding flow"
```

### Task 11: Re-run Setup from Settings

**Files:**
- Modify: `dashboard/src/pages/Settings.tsx`

- [ ] **Step 1: Add "Re-run setup" button to Settings**

At the bottom of Settings, add:

```tsx
<button
  onClick={async () => {
    await api.setSetting("onboarding_complete", "");
    window.location.reload();
  }}
  className="text-[12px] text-text-muted hover:text-text-primary transition-colors"
>
  Re-run setup wizard
</button>
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/pages/Settings.tsx
git commit -m "feat: add re-run setup wizard button to settings"
```

---

## Chunk 5: Polish + Missing API Methods

### Task 12: Ensure All Client API Methods Exist

**Files:**
- Modify: `dashboard/src/api/client.ts`

- [ ] **Step 1: Audit and add missing methods**

Check that these methods exist in `client.ts`. Add any that are missing:
- `getSetting(key)` / `setSetting(key, value)`
- `triggerAiRefresh()`
- `getAiRuns()`
- `getTaxonomy()`
- `getWritingPrompt()` / `updateWritingPrompt(text)`
- `getAuthorProfile()`
- `saveAuthorProfile(text)`
- `createInterviewSession(preInfo)`
- `extractProfile(transcript, duration)`
- `getSources()` / `addSource(url)` / `discoverSources(topics?)`

- [ ] **Step 2: Commit**

```bash
git add dashboard/src/api/client.ts
git commit -m "feat: ensure all onboarding API methods exist in client"
```

### Task 13: End-to-End Manual Test

- [ ] **Step 1: Clear onboarding state**

```bash
sqlite3 server/data/analytics.db "DELETE FROM settings WHERE key = 'onboarding_complete';"
```

- [ ] **Step 2: Run through complete flow**

1. Open app → should see Welcome page
2. Click "Get started" → Extension setup
3. Skip extension → Analyze step (should show "no posts" if fresh DB)
4. Continue → Voice interview
5. Skip → Source discovery
6. Skip/save → Setup complete
7. "Start writing" → normal app
8. Refresh → should stay on normal app

- [ ] **Step 3: Test re-run from Settings**

Go to Settings → "Re-run setup wizard" → should see Welcome page again.
