import { useState, useEffect, useRef, useCallback } from "react";
import { api, type GenStory, type DiscoveryTopic } from "../../api/client";
import StoryCard from "./components/StoryCard";
import ScannerLoader from "./components/ScannerLoader";

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
  };
  setGen: (fn: (prev: any) => any) => void;
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
type RectMap = Map<HTMLElement, DOMRect>;

function getCardRects(gridEl: HTMLElement): RectMap {
  const rects: RectMap = new Map();
  gridEl.querySelectorAll<HTMLElement>("[data-card]").forEach((card) => {
    rects.set(card, card.getBoundingClientRect());
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
    const oldRect = oldRects.get(card);
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

  const gridRef = useRef<HTMLDivElement>(null);

  // Auto-discover on mount: use daily cache if available
  useEffect(() => {
    if (!gen.discoveryTopics && !gen.stories.length && !loading) {
      const cached = getCachedTopics();
      if (cached) {
        setGen((prev: any) => ({
          ...prev,
          discoveryTopics: cached,
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
      setCachedTopics(res.topics);
      setGen((prev: any) => ({
        ...prev,
        discoveryTopics: res.topics,
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
    setGen((prev: any) => ({ ...prev, discoveryTopics: null }));
    handleDiscover();
  };

  const handleTopicClick = async (label: string, guidance?: string) => {
    setLoading(true);
    setError(null);
    setActiveMessages(RESEARCH_MESSAGES);
    const fullTopic = guidance ? `${label} — ${guidance}` : label;
    setGen((prev: any) => ({ ...prev, selectedTopic: fullTopic }));

    const avoid = gen.stories.map((s) => s.headline).filter(Boolean);

    try {
      const res = await api.generateResearch(fullTopic, avoid.length > 0 ? avoid : undefined);
      setGen((prev: any) => ({
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
    setGen((prev: any) => ({
      ...prev,
      stories: [],
      researchId: null,
      selectedStoryIndex: null,
      selectedTopic: null,
    }));
  };

  const handleGenerateDrafts = async () => {
    if (gen.selectedStoryIndex === null || gen.researchId === null) return;
    setLoading(true);
    setActiveMessages(DRAFTS_MESSAGES);
    try {
      const res = await api.generateDrafts(gen.researchId, gen.selectedStoryIndex, gen.personalConnection || undefined, gen.draftLength);
      setGen((prev: any) => ({
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
        const cards = gridRef.current.querySelectorAll<HTMLElement>("[data-card]");
        const expandedEl = cards[index] ?? null;
        const anims = flipAnimate(gridRef.current, oldRects, expandedEl, expandedIndex !== null ? 480 : 450);

        if (anims.length === 0) {
          setIsAnimating(false);
          return;
        }

        Promise.all(anims.map((a) => a.finished)).then(() => {
          setIsAnimating(false);
          expandedEl?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
    });
  }, [expandedIndex, isAnimating]);

  const collapseCard = useCallback(() => {
    if (isAnimating || expandedIndex === null || !gridRef.current) return;

    setIsAnimating(true);
    const grid = gridRef.current;
    const oldRects = getCardRects(grid);

    setExpandedIndex(null);
    setGuidanceText("");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!gridRef.current) return;
        const anims = flipAnimate(gridRef.current, oldRects, null, 420);

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

      {/* Loading state — scanner animation */}
      {loading && (
        <ScannerLoader messages={activeMessages} />
      )}

      {/* Discovery grid view */}
      {!loading && !hasStories && (
        <div>
          {/* Topic input */}
          <div className="flex gap-2 mb-8">
            <input
              type="text"
              value={topicInput}
              onChange={(e) => setTopicInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleGoTopic(); }}
              placeholder="I want to write about..."
              className="flex-1 bg-gen-bg-1 border border-gen-border-1 rounded-[10px] px-4 py-3 text-[16px] text-gen-text-0 placeholder:text-gen-text-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gen-accent/50 focus-visible:border-gen-accent"
            />
            <button
              onClick={handleGoTopic}
              disabled={!topicInput.trim()}
              className="px-6 py-3 bg-gen-accent text-white text-[16px] font-medium rounded-[10px] hover:bg-gen-accent/90 transition-colors duration-150 ease-[var(--ease-snappy)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Go
            </button>
          </div>

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
                style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}
              >
                {gen.discoveryTopics!.map((topic, i) => {
                  const isExpanded = expandedIndex === i;
                  const tagColor = getTagColor(topic.category_tag);
                  const domain = extractDomain(topic.source_url);

                  return (
                    <div
                      key={topic.label}
                      data-card
                      onClick={() => {
                        if (!isExpanded) expandCard(i);
                      }}
                      className={`relative rounded-xl transition-[border-color,box-shadow] duration-300 ease-out ${
                        isExpanded
                          ? "border border-gen-accent/25 bg-gen-bg-2 shadow-[0_0_0_1px_rgba(107,161,245,0.06),0_12px_48px_rgba(0,0,0,0.35)] cursor-default p-0 z-10"
                          : "bg-gen-bg-1 border border-gen-border-1 p-[18px_20px_16px] cursor-pointer hover:border-gen-border-2"
                      }`}
                      style={isExpanded ? { gridColumn: "1 / -1" } : undefined}
                    >
                      {/* Accent bar when expanded */}
                      {isExpanded && (
                        <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gen-accent rounded-l-xl" />
                      )}

                      {/* Collapsed card content */}
                      {!isExpanded && (
                        <div>
                          <span
                            className="inline-block text-[12px] font-medium px-2 py-0.5 rounded-md mb-2.5"
                            style={{ background: tagColor.bg, color: tagColor.text }}
                          >
                            {topic.category_tag}
                          </span>
                          <div className="font-serif-gen font-medium text-[17px] leading-[1.35] text-gen-text-0 mb-1.5 tracking-[-0.2px]">
                            {topic.label}
                          </div>
                          <div className="text-[14px] leading-[1.6] text-gen-text-2 line-clamp-2 mb-3">
                            {topic.summary}
                          </div>
                          <div className="flex items-center gap-2 text-[14px]">
                            <span className="text-gen-text-3">{domain}</span>
                          </div>
                        </div>
                      )}

                      {/* Expanded panel content */}
                      {isExpanded && (
                        <>
                          {/* Close button */}
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
                            {/* Left: story details */}
                            <div className="p-7 pr-8 border-b md:border-b-0 md:border-r border-gen-border-1">
                              <span
                                className="inline-block text-[12px] font-medium px-2 py-0.5 rounded-md mb-3.5"
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
                                  className="text-[13px] text-gen-text-3 hover:text-gen-accent transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {domain}
                                </a>
                              </div>
                            </div>

                            {/* Right: guidance + write */}
                            <div className="p-7 flex flex-col">
                              <div className="text-[15px] font-medium text-gen-text-0 mb-1">
                                Your angle
                              </div>
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleTopicClick(topic.label, guidanceText.trim() || undefined);
                                  }}
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
                  setGen((prev: any) => ({ ...prev, selectedStoryIndex: i }))
                }
              />
            ))}
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
                onChange={(e) => setGen((prev: any) => ({ ...prev, personalConnection: e.target.value }))}
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
                    onClick={() => setGen((prev: any) => ({ ...prev, draftLength: len }))}
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
    </div>
  );
}
