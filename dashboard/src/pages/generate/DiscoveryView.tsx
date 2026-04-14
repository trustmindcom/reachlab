import { useState, useEffect, useRef, useCallback } from "react";
import { api, type GenStory, type DiscoveryTopic } from "../../api/client";
import type { SetGen } from "../Generate";
import StoryCard from "./components/StoryCard";
import ScannerLoader from "./components/ScannerLoader";
import {
  getLockedTopics,
  saveLockedTopics,
  mergeLocked,
  toggleLockedTopic,
  isTopicLocked,
} from "./lockedTopics";

interface DiscoveryViewProps {
  gen: {
    discoveryTopics: DiscoveryTopic[] | null;
    selectedTopic: string | null;
    stories: GenStory[];
    articleCount: number;
    sourceCount: number;
    researchId: number | null;
    selectedStoryIndex: number | null;
    personalConnection: string;
    draftLength: "short" | "medium" | "long";
    brainstormAngles: string[];
    brainstormTopic: string | null;
    selectedAngle: string | null;
  };
  setGen: SetGen;
  loading: boolean;
  setLoading: (v: boolean) => void;
  onNext: () => void;
}

const DISCOVERY_MESSAGES = [
  "Scanning feeds...",
  "Reading headlines...",
  "Clustering topics...",
  "Finding angles...",
];

const RESEARCH_MESSAGES = [
  "Deep diving...",
  "Finding perspectives...",
  "Building story cards...",
];

const DRAFTS_MESSAGES = [
  "Writing drafts...",
  "Applying your voice...",
  "Refining structure...",
  "Polishing language...",
];

const BRAINSTORM_MESSAGES = [
  "Reading your voice...",
  "Thinking about angles...",
  "Finding hot takes...",
];

const CACHE_KEY = "reachlab_discovery_cache";

function getCachedTopics(): DiscoveryTopic[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.date === new Date().toISOString().slice(0, 10) && Array.isArray(cached.topics) && cached.topics.length > 0) {
      return cached.topics;
    }
  } catch {}
  return null;
}

function setCachedTopics(topics: DiscoveryTopic[]) {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({
      date: new Date().toISOString().slice(0, 10),
      topics,
    }));
  } catch {}
}

function clearCachedTopics() {
  try { sessionStorage.removeItem(CACHE_KEY); } catch {}
}

// ── Category tag color mapping ────────────────────────────
const TAG_COLORS: Record<string, { bg: string; text: string }> = {
  security: { bg: "rgba(232,124,124,0.08)", text: "#d4897e" },
  "supply chain": { bg: "rgba(232,124,124,0.08)", text: "#d4897e" },
  ai: { bg: "rgba(107,161,245,0.08)", text: "#7eb3e8" },
  "ai engineering": { bg: "rgba(107,161,245,0.08)", text: "#7eb3e8" },
  governance: { bg: "rgba(107,161,245,0.08)", text: "#7eb3e8" },
  "dev tools": { bg: "rgba(232,199,124,0.08)", text: "#c8b07a" },
  "trust & safety": { bg: "rgba(176,124,232,0.08)", text: "#b090d4" },
  trust: { bg: "rgba(176,124,232,0.08)", text: "#b090d4" },
  infrastructure: { bg: "rgba(124,232,168,0.08)", text: "#82c89e" },
  strategy: { bg: "rgba(232,160,124,0.08)", text: "#cca07a" },
};

function getTagColor(tag: string): { bg: string; text: string } {
  const key = tag.toLowerCase();
  if (TAG_COLORS[key]) return TAG_COLORS[key];
  // Fuzzy match: check if any key is contained in the tag or vice versa
  for (const [k, v] of Object.entries(TAG_COLORS)) {
    if (key.includes(k) || k.includes(key)) return v;
  }
  // Default fallback
  return { bg: "rgba(107,161,245,0.08)", text: "#7eb3e8" };
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ── FLIP animation helpers ────────────────────────────────
// Key by data-index (stable across React re-renders) not by HTMLElement ref
type RectMap = Map<string, DOMRect>;

function getCardRects(gridEl: HTMLElement): RectMap {
  const rects: RectMap = new Map();
  gridEl.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
    const key = card.getAttribute("data-index") ?? "";
    if (key) rects.set(key, card.getBoundingClientRect());
  });
  return rects;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function flipAnimate(
  gridEl: HTMLElement,
  oldRects: RectMap,
  expandedEl: HTMLElement | null,
  duration = 450
): Animation[] {
  const cards = gridEl.querySelectorAll<HTMLElement>("[data-card]");
  const animations: Animation[] = [];

  // Skip animations entirely for reduced motion preference
  if (prefersReducedMotion()) return animations;

  const expandedIndex = expandedEl ? [...cards].indexOf(expandedEl) : -1;

  cards.forEach((card, i) => {
    const key = card.getAttribute("data-index") ?? "";
    const oldRect = key ? oldRects.get(key) : undefined;
    if (!oldRect) return;
    const newRect = card.getBoundingClientRect();

    const dx = oldRect.left - newRect.left;
    const dy = oldRect.top - newRect.top;
    const sw = oldRect.width / newRect.width;
    const sh = oldRect.height / newRect.height;

    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sw - 1) < 0.005 && Math.abs(sh - 1) < 0.005) return;

    const isHero = card === expandedEl;
    const dist = Math.abs(i - expandedIndex);
    const stagger = isHero ? 0 : 15 + dist * 10;

    const keyframes = isHero
      ? [
          { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sw}, ${sh})` },
          { transformOrigin: "top left", transform: "none" },
        ]
      : [
          { transform: `translate(${dx}px, ${dy}px) scale(${sw}, ${sh})`, opacity: 0.6 },
          { transform: "none", opacity: 1 },
        ];

    const anim = card.animate(keyframes, {
      duration,
      easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      fill: "forwards",
      delay: isHero ? 0 : stagger,
    });

    // Clean up stale transforms after animation completes
    anim.onfinish = () => {
      card.style.transform = "";
      card.style.opacity = "";
    };

    animations.push(anim);
  });

  return animations;
}

// ── Main component ─────────────────────────────────────────

export default function DiscoveryView({ gen, setGen, loading, setLoading, onNext }: DiscoveryViewProps) {
  const [topicInput, setTopicInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [activeMessages, setActiveMessages] = useState<string[]>(DISCOVERY_MESSAGES);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [guidanceText, setGuidanceText] = useState("");
  const [isAnimating, setIsAnimating] = useState(false);
  const [lockedTopics, setLockedTopics] = useState<DiscoveryTopic[]>(() => getLockedTopics());

  const isLocked = useCallback(
    (topic: DiscoveryTopic) => isTopicLocked(lockedTopics, topic),
    [lockedTopics]
  );

  const toggleLock = useCallback((topic: DiscoveryTopic) => {
    setLockedTopics((prev) => {
      const next = toggleLockedTopic(prev, topic);
      saveLockedTopics(next);
      return next;
    });
  }, []);

  const gridRef = useRef<HTMLDivElement>(null);
  const discoverStartedRef = useRef(false);

  // Auto-discover on mount: use daily cache if available (StrictMode-safe)
  useEffect(() => {
    if (discoverStartedRef.current) return;
    if (!gen.discoveryTopics && !gen.stories.length && !loading) {
      discoverStartedRef.current = true;
      const cached = getCachedTopics();
      if (cached) {
        setGen((prev) => ({
          ...prev,
          discoveryTopics: mergeLocked(lockedTopics, cached),
          stories: [],
          researchId: null,
          selectedStoryIndex: null,
          selectedTopic: null,
        }));
      } else {
        handleDiscover();
      }
    }
  }, []);

  // Scroll expanded card into view when it appears
  useEffect(() => {
    if (expandedIndex === null || !gridRef.current) return;
    const el = gridRef.current.querySelector<HTMLElement>(`[data-card][data-index="${expandedIndex}"]`);
    if (!el) return;
    setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);
  }, [expandedIndex]);

  // Escape key to collapse
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedIndex !== null && !isAnimating) {
        collapseCard();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [expandedIndex, isAnimating]);

  const handleDiscover = async () => {
    setIsDiscovering(true);
    setLoading(true);
    setError(null);
    setActiveMessages(DISCOVERY_MESSAGES);

    try {
      const res = await api.generateDiscover();
      const merged = mergeLocked(lockedTopics, res.topics);
      setCachedTopics(merged);
      setGen((prev) => ({
        ...prev,
        discoveryTopics: merged,
        stories: [],
        researchId: null,
        selectedStoryIndex: null,
        selectedTopic: null,
      }));
    } catch (err: any) {
      setError(err.message ?? "Couldn't load topics. Try again.");
    } finally {
      setLoading(false);
      setIsDiscovering(false);
    }
  };

  const handleRefresh = () => {
    clearCachedTopics();
    setExpandedIndex(null);
    setGen((prev) => ({ ...prev, discoveryTopics: null }));
    handleDiscover();
  };

  const handleTopicClick = async (label: string, guidance?: string, sourceContext?: { summary: string; source_headline: string; source_url: string }) => {
    setLoading(true);
    setError(null);
    setActiveMessages(RESEARCH_MESSAGES);
    const fullTopic = guidance ? `${label} — ${guidance}` : label;
    setGen((prev) => ({ ...prev, selectedTopic: fullTopic }));

    const avoid = gen.stories.map((s) => s.headline).filter(Boolean);

    try {
      const res = await api.generateResearch(fullTopic, avoid.length > 0 ? avoid : undefined, sourceContext);
      setGen((prev) => ({
        ...prev,
        researchId: res.research_id,
        stories: res.stories,
        articleCount: res.article_count,
        sourceCount: res.source_count,
        selectedStoryIndex: null,
      }));
    } catch (err: any) {
      setError(err.message ?? "Research failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoTopic = () => {
    const trimmed = topicInput.trim();
    if (!trimmed) return;
    handleTopicClick(trimmed);
  };

  const handleBackToTopics = () => {
    setGen((prev) => ({
      ...prev,
      stories: [],
      researchId: null,
      selectedStoryIndex: null,
      selectedTopic: null,
    }));
  };

  const handleGenerateDrafts = async () => {
    // Story-based path
    if (gen.selectedStoryIndex !== null && gen.researchId !== null) {
      setLoading(true);
      setActiveMessages(DRAFTS_MESSAGES);
      try {
        const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.personalConnection || undefined, gen.draftLength);
        setGen((prev) => ({
          ...prev,
          generationId: res.generation_id,
          drafts: res.drafts,
          selectedDraftIndices: [],
        }));
        onNext();
      } catch (err: any) {
        setError(err.message ?? "Draft generation failed. Try again.");
      } finally {
        setLoading(false);
      }
      return;
    }

    // Brainstorm/angle path
    if (gen.selectedAngle && gen.brainstormTopic) {
      setLoading(true);
      setActiveMessages(DRAFTS_MESSAGES);
      try {
        const res = await api.generateDrafts(null, null, gen.personalConnection || undefined, gen.draftLength, gen.brainstormTopic, gen.selectedAngle);
        setGen((prev) => ({
          ...prev,
          generationId: res.generation_id,
          drafts: res.drafts,
          selectedDraftIndices: [],
        }));
        onNext();
      } catch (err: any) {
        setError(err.message ?? "Draft generation failed. Try again.");
      } finally {
        setLoading(false);
      }
    }
  };

  const handleBrainstorm = async () => {
    const topic = gen.selectedTopic || topicInput.trim();
    if (!topic) return;
    setLoading(true);
    setActiveMessages(BRAINSTORM_MESSAGES);
    setError(null);
    try {
      const res = await api.brainstormAngles(topic);
      setGen((prev) => ({
        ...prev,
        brainstormAngles: res.angles,
        brainstormTopic: topic,
        selectedAngle: null,
        // Clear story selection
        stories: [],
        researchId: null,
        selectedStoryIndex: null,
      }));
    } catch (err: any) {
      setError(err.message ?? "Brainstorm failed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  // ── FLIP expand/collapse ────────────────────────────────
  const expandCard = useCallback((index: number) => {
    if (isAnimating || !gridRef.current) return;
    if (expandedIndex === index) return;

    setIsAnimating(true);
    const grid = gridRef.current;
    const oldRects = getCardRects(grid);

    // If switching from another expanded card
    if (expandedIndex !== null) {
      setExpandedIndex(index);
      setGuidanceText("");
    } else {
      setExpandedIndex(index);
      setGuidanceText("");
    }

    // Need to wait for React to re-render with new expandedIndex
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!gridRef.current) return;
        const heroEl = gridRef.current.querySelector<HTMLElement>(`[data-card][data-index="${index}"]`);
        const anims = flipAnimate(gridRef.current, oldRects, heroEl, expandedIndex !== null ? 480 : 450);

        if (anims.length === 0) {
          setIsAnimating(false);
          return;
        }

        Promise.all(anims.map((a) => a.finished)).then(() => {
          setIsAnimating(false);
        });
      });
    });
  }, [expandedIndex, isAnimating]);

  const collapseCard = useCallback(() => {
    if (isAnimating || expandedIndex === null || !gridRef.current) return;

    setIsAnimating(true);
    const grid = gridRef.current;
    const oldRects = getCardRects(grid);
    const collapsingIndex = expandedIndex;

    setExpandedIndex(null);
    setGuidanceText("");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!gridRef.current) return;
        const heroEl = gridRef.current.querySelector<HTMLElement>(`[data-card][data-index="${collapsingIndex}"]`);
        const anims = flipAnimate(gridRef.current, oldRects, heroEl, 420);

        if (anims.length === 0) {
          setIsAnimating(false);
          return;
        }

        Promise.all(anims.map((a) => a.finished)).then(() => {
          setIsAnimating(false);
        });
      });
    });
  }, [expandedIndex, isAnimating]);

  const hasStories = gen.stories.length > 0;
  const hasTopics = gen.discoveryTopics && gen.discoveryTopics.length > 0;

  return (
    <div>
      {/* Error state */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[15px] text-red-400">
          {error}
        </div>
      )}

      {/* Topic input — always visible during discovery phase so user can start typing an idea while topics load */}
      {!hasStories && (
        <div className="flex gap-2 mb-6 items-end">
          <textarea
            value={topicInput}
            onChange={(e) => {
              setTopicInput(e.target.value);
              // Auto-expand: reset height then set to scrollHeight
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleGoTopic(); } }}
            placeholder="I want to write about..."
            rows={1}
            className="flex-1 bg-gen-bg-1 border border-gen-border-1 rounded-[10px] px-4 py-3 text-[16px] text-gen-text-0 placeholder:text-gen-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gen-accent/50 focus-visible:border-gen-accent resize-none overflow-hidden"
          />
          <button
            onClick={handleGoTopic}
            disabled={!topicInput.trim() || loading}
            className="px-6 py-3 bg-gen-accent text-white text-[16px] font-medium rounded-[10px] hover:bg-gen-accent/90 transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-40 disabled:cursor-not-allowed self-end"
          >
            Go
          </button>
        </div>
      )}

      {/* Loading state — scanner animation (below the input so user can keep typing) */}
      {loading && (
        <ScannerLoader messages={activeMessages} />
      )}

      {/* Discovery grid view */}
      {!loading && !hasStories && (
        <div>
          {hasTopics && (
            <>
              {/* Divider */}
              <div className="flex items-center gap-4 mb-7">
                <div className="flex-1 h-px bg-gen-border-1" />
                <span className="text-[13px] uppercase tracking-[1.6px] text-gen-text-4">or explore trending topics</span>
                <div className="flex-1 h-px bg-gen-border-1" />
              </div>

              {/* Magazine grid */}
              <div
                ref={gridRef}
                className="grid gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gridAutoFlow: "dense" }}
              >
                {gen.discoveryTopics!.map((topic, i) => {
                  const isExpanded = expandedIndex === i;
                  const tagColor = getTagColor(topic.category_tag);
                  const domain = extractDomain(topic.source_url);
                  const locked = isLocked(topic);

                  return (
                    <div
                      key={topic.label}
                      data-card
                      data-index={i}
                      onClick={() => { if (!isExpanded) expandCard(i); }}
                      style={isExpanded ? { gridColumn: "1 / -1" } : undefined}
                      className={`group relative rounded-xl transition-[border-color,box-shadow] duration-300 ease-out ${
                        isExpanded
                          ? "border border-gen-accent/25 bg-gen-bg-2 shadow-[0_0_0_1px_rgba(107,161,245,0.06),0_12px_48px_rgba(0,0,0,0.35)] cursor-default p-0 z-10"
                          : `bg-gen-bg-1 border p-[18px_20px_16px] cursor-pointer flex flex-col ${
                              locked
                                ? "border-gen-accent/40 hover:border-gen-accent/60"
                                : "border-gen-border-1 hover:border-gen-border-2"
                            }`
                      }`}
                    >
                      {isExpanded && (
                        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gen-accent rounded-l-xl" />
                      )}

                      {!isExpanded && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleLock(topic); }}
                            aria-label={locked ? "Unlock topic" : "Lock topic to keep through refresh"}
                            className={`peer absolute top-2 left-2 w-6 h-6 flex items-center justify-center rounded-md transition-all duration-150 z-10 ${
                              locked
                                ? "text-gen-accent opacity-100"
                                : "text-gen-text-4 opacity-0 group-hover:opacity-100 hover:text-gen-text-1 hover:bg-gen-bg-2"
                            }`}
                          >
                            {locked ? (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round">
                                <rect x="3" y="6.5" width="8" height="5.5" rx="1" />
                                <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0V6.5" fill="none" strokeLinecap="round" />
                              </svg>
                            ) : (
                              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="6.5" width="8" height="5.5" rx="1" />
                                <path d="M4.5 6.5V4.5a2.5 2.5 0 0 1 5 0V6.5" />
                              </svg>
                            )}
                          </button>
                          <span
                            role="tooltip"
                            className="pointer-events-none absolute top-[34px] left-2 z-20 whitespace-nowrap rounded-md bg-gen-bg-3 border border-gen-border-1 px-2 py-1 text-[11px] font-medium text-gen-text-1 opacity-0 translate-y-[-2px] peer-hover:opacity-100 peer-hover:translate-y-0 peer-focus-visible:opacity-100 peer-focus-visible:translate-y-0 transition-all duration-150 ease-out shadow-[0_4px_12px_rgba(0,0,0,0.25)]"
                          >
                            {locked ? "Click to unlock" : "Lock to keep through refresh"}
                          </span>
                          <div className={`font-serif-gen font-medium text-[17px] leading-[1.35] text-gen-text-0 mb-1.5 tracking-[-0.2px] ${locked ? "pl-7" : ""}`}>
                            {topic.label}
                          </div>
                          <div className="text-[14px] leading-[1.6] text-gen-text-2 line-clamp-3 mb-3">
                            {topic.summary}
                          </div>
                          <div className="flex items-center justify-between text-[13px] mt-auto">
                            <span className="text-gen-text-3">{domain}</span>
                            <span
                              className="text-[11px] font-medium px-1.5 py-0.5 rounded-md"
                              style={{ background: tagColor.bg, color: tagColor.text }}
                            >
                              {topic.category_tag}
                            </span>
                          </div>
                        </>
                      )}

                      {isExpanded && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); collapseCard(); }}
                            className="absolute top-4 right-4 z-20 w-8 h-8 bg-gen-bg-3 border border-gen-border-1 rounded-lg flex items-center justify-center text-gen-text-3 hover:text-gen-text-0 hover:bg-gen-bg-4 transition-colors duration-150"
                            aria-label="Close"
                          >
                            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                              <path d="M2 2l10 10M12 2L2 12" />
                            </svg>
                          </button>

                          <div className="grid grid-cols-1 md:grid-cols-2 min-h-[300px]">
                            <div className="p-7 pr-8 border-b md:border-b-0 md:border-r border-gen-border-1 flex flex-col">
                              <span
                                className="inline-block text-[12px] font-medium px-2 py-0.5 rounded-md mb-3.5 self-start"
                                style={{ background: tagColor.bg, color: tagColor.text }}
                              >
                                {topic.category_tag}
                              </span>
                              <div className="font-serif-gen font-medium text-[24px] leading-[1.3] text-gen-text-0 mb-3 tracking-[-0.3px]">
                                {topic.label}
                              </div>
                              <div className="text-[15px] leading-[1.7] text-gen-text-2 mb-5">
                                {topic.summary}
                              </div>
                              <div className="mt-auto pt-4 border-t border-gen-border-1">
                                <a
                                  href={topic.source_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[13px] text-gen-text-3 hover:text-gen-accent transition-colors"
                                >
                                  {domain}
                                </a>
                              </div>
                            </div>

                            <div className="p-7 flex flex-col">
                              <div className="text-[15px] font-medium text-gen-text-0 mb-1">Your angle</div>
                              <div className="text-[13px] text-gen-text-4 mb-4">
                                What perspective do you want to bring? Leave blank to explore freely.
                              </div>
                              <textarea
                                value={guidanceText}
                                onChange={(e) => setGuidanceText(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                rows={5}
                                placeholder="e.g. 'focus on what this means for engineering leaders'"
                                className="flex-1 w-full min-h-[120px] bg-gen-bg-1 border border-gen-border-1 rounded-[10px] px-4 py-3.5 text-[15px] text-gen-text-0 placeholder:text-gen-text-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gen-accent/30 focus-visible:border-gen-accent resize-none leading-[1.6] mb-4"
                              />
                              <div className="flex items-center gap-3">
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleTopicClick(topic.label, guidanceText.trim() || undefined, { summary: topic.summary, source_headline: topic.source_headline, source_url: topic.source_url }); }}
                                  className="px-7 py-3 bg-gen-accent text-white text-[15px] font-medium rounded-[10px] hover:opacity-90 transition-opacity duration-150"
                                >
                                  Write about this
                                </button>
                              </div>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              <div
                className="flex items-center justify-center gap-3 mt-6 transition-opacity duration-250"
                style={{ opacity: expandedIndex !== null ? 0 : 1, pointerEvents: expandedIndex !== null ? "none" : "auto" }}
              >
                <span className="text-[14px] text-gen-text-4">
                  {gen.discoveryTopics!.length} stories from your feeds
                </span>
                <span className="text-gen-text-4 opacity-40">·</span>
                <button
                  onClick={handleRefresh}
                  className="text-[14px] text-gen-text-3 hover:text-gen-accent transition-colors duration-150 ease-[var(--ease-snappy)] cursor-pointer"
                >
                  Find new topics
                </button>
              </div>
            </>
          )}

          {/* If no topics and not loading, show retry */}
          {!hasTopics && !loading && (
            <div className="text-center py-10">
              <button
                onClick={handleDiscover}
                className="px-5 py-2.5 border border-gen-border-1 rounded-[10px] text-[15px] text-gen-text-2 hover:text-gen-text-0 hover:border-gen-border-2 transition-colors duration-150 ease-[var(--ease-snappy)]"
              >
                Load trending topics
              </button>
            </div>
          )}
        </div>
      )}

      {/* Story cards — shown after clicking a topic or entering a topic */}
      {!loading && hasStories && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-medium text-gen-text-0">
              Pick a story to write about
            </h2>
            <button
              onClick={handleBackToTopics}
              className="text-[15px] text-gen-text-3 hover:text-gen-text-1 transition-colors duration-150 ease-[var(--ease-snappy)]"
            >
              Back to topics
            </button>
          </div>

          <div className="space-y-3">
            {gen.stories.map((story, i) => (
              <StoryCard
                key={i}
                story={story}
                index={i}
                selected={gen.selectedStoryIndex === i}
                onSelect={() =>
                  setGen((prev) => ({ ...prev, selectedStoryIndex: i }))
                }
              />
            ))}
          </div>

          {/* Brainstorm option — skip stories, find your own angle */}
          <div className="mt-4 pt-4 border-t border-gen-border-1">
            <button
              onClick={handleBrainstorm}
              className="w-full text-left px-5 py-4 rounded-xl border border-dashed border-gen-border-2 text-gen-text-2 hover:text-gen-text-0 hover:border-gen-accent/40 hover:bg-gen-bg-2/30 transition-colors duration-150 ease-[var(--ease-snappy)]"
            >
              <span className="text-[15px] font-medium">I don't need a story</span>
              <span className="text-[14px] text-gen-text-3 ml-2">— help me find my angle on this topic</span>
            </button>
          </div>

          {/* Personal connection */}
          {gen.selectedStoryIndex !== null && (
            <div className="mt-4 p-4 bg-gen-bg-1 border border-gen-border-1 rounded-xl space-y-2">
              <h3 className="text-[16px] font-medium text-gen-text-0">
                What's your personal connection to this?
              </h3>
              <p className="text-[14px] text-gen-text-3">
                Optional — helps the AI ground the draft in your real experience.
              </p>
              <textarea
                value={gen.personalConnection}
                onChange={(e) => setGen((prev) => ({ ...prev, personalConnection: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (gen.selectedStoryIndex !== null && !loading) handleGenerateDrafts();
                  }
                }}
                rows={3}
                placeholder='e.g. "We migrated off Heroku to AWS and it took 6 months longer than estimated..."'
                className="w-full bg-gen-bg-0 border border-gen-border-1 rounded-lg px-3 py-2 text-[15px] text-gen-text-0 placeholder:text-gen-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gen-accent/50 focus-visible:border-gen-accent resize-none"
              />
            </div>
          )}

          {/* Bottom bar */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-gen-border-1">
            <span className="text-[14px] text-gen-text-3">
              {gen.articleCount} articles from {gen.sourceCount} sources
            </span>
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-gen-bg-2 rounded-lg p-0.5">
                {(["short", "medium", "long"] as const).map((len) => (
                  <button
                    key={len}
                    onClick={() => setGen((prev) => ({ ...prev, draftLength: len }))}
                    className={`px-2.5 py-1 text-[13px] font-medium rounded-md transition-colors duration-150 ease-[var(--ease-snappy)] capitalize ${
                      gen.draftLength === len
                        ? "bg-gen-bg-0 text-gen-text-0 shadow-sm"
                        : "text-gen-text-3 hover:text-gen-text-1"
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
              <button
                onClick={handleGenerateDrafts}
                disabled={gen.selectedStoryIndex === null || loading}
                className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[15px] font-medium rounded-[10px] hover:bg-white transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Generate drafts
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brainstorm angles — shown after clicking "I don't need a story" */}
      {!loading && gen.brainstormAngles.length > 0 && !hasStories && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[15px] font-medium text-gen-text-0">
              Pick an angle to write about
            </h2>
            <button
              onClick={() => {
                setGen((prev) => ({
                  ...prev,
                  brainstormAngles: [],
                  brainstormTopic: null,
                  selectedAngle: null,
                }));
              }}
              className="text-[15px] text-gen-text-3 hover:text-gen-text-1 transition-colors duration-150 ease-[var(--ease-snappy)]"
            >
              Back
            </button>
          </div>

          <p className="text-[14px] text-gen-text-3 mb-4">
            {gen.brainstormTopic}
          </p>

          <div className="space-y-2">
            {gen.brainstormAngles.map((angle, i) => {
              const isSelected = gen.selectedAngle === angle;
              return (
                <button
                  key={i}
                  onClick={() => setGen((prev) => ({ ...prev, selectedAngle: isSelected ? null : angle }))}
                  className={`w-full text-left rounded-xl px-5 py-4 transition-all border ${
                    isSelected
                      ? "border-gen-accent-border bg-gen-bg-2 shadow-[inset_3px_0_0_0_var(--color-gen-accent)]"
                      : "border-gen-border-1 bg-gen-bg-1 hover:border-gen-border-2"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`mt-1 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      isSelected ? "border-gen-accent bg-gen-accent" : "border-gen-text-4"
                    }`}>
                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                    </div>
                    <span className="text-[15px] text-gen-text-1 leading-snug">{angle}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Or write your own */}
          <div className="mt-4">
            <textarea
              value={gen.selectedAngle && !gen.brainstormAngles.includes(gen.selectedAngle) ? gen.selectedAngle : ""}
              onChange={(e) => setGen((prev) => ({ ...prev, selectedAngle: e.target.value || null }))}
              rows={2}
              placeholder="Or write your own angle..."
              className="w-full bg-gen-bg-1 border border-gen-border-1 rounded-lg px-4 py-3 text-[15px] text-gen-text-0 placeholder:text-gen-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gen-accent/50 focus-visible:border-gen-accent resize-none"
            />
          </div>

          {/* Personal connection */}
          {gen.selectedAngle && (
            <div className="mt-4 p-4 bg-gen-bg-1 border border-gen-border-1 rounded-xl space-y-2">
              <h3 className="text-[16px] font-medium text-gen-text-0">
                What's your personal connection to this?
              </h3>
              <p className="text-[14px] text-gen-text-3">
                Optional — helps the AI ground the draft in your real experience.
              </p>
              <textarea
                value={gen.personalConnection}
                onChange={(e) => setGen((prev) => ({ ...prev, personalConnection: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (gen.selectedAngle && !loading) handleGenerateDrafts();
                  }
                }}
                rows={3}
                placeholder='e.g. "I spent 6 months building a vendor assessment program from scratch..."'
                className="w-full bg-gen-bg-0 border border-gen-border-1 rounded-lg px-3 py-2 text-[15px] text-gen-text-0 placeholder:text-gen-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gen-accent/50 focus-visible:border-gen-accent resize-none"
              />
            </div>
          )}

          {/* Bottom bar */}
          <div className="flex items-center justify-end mt-6 pt-4 border-t border-gen-border-1">
            <div className="flex items-center gap-3">
              <div className="flex items-center bg-gen-bg-2 rounded-lg p-0.5">
                {(["short", "medium", "long"] as const).map((len) => (
                  <button
                    key={len}
                    onClick={() => setGen((prev) => ({ ...prev, draftLength: len }))}
                    className={`px-2.5 py-1 text-[13px] font-medium rounded-md transition-colors duration-150 ease-[var(--ease-snappy)] capitalize ${
                      gen.draftLength === len
                        ? "bg-gen-bg-0 text-gen-text-0 shadow-sm"
                        : "text-gen-text-3 hover:text-gen-text-1"
                    }`}
                  >
                    {len}
                  </button>
                ))}
              </div>
              <button
                onClick={handleGenerateDrafts}
                disabled={!gen.selectedAngle || loading}
                className="px-4 py-2 bg-gen-text-0 text-gen-bg-0 text-[15px] font-medium rounded-[10px] hover:bg-white transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Generate drafts
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
