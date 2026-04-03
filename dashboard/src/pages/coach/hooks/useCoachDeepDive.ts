import { useState } from "react";
import {
  api,
  type ProgressData,
  type CategoryPerformance,
  type EngagementQuality,
  type SparklinePoint,
  type TopicPerformance,
  type HookPerformance,
  type ImageSubtypePerformance,
} from "../../../api/client";

export function useCoachDeepDive(showError: (msg: string) => void) {
  const [progress, setProgress] = useState<ProgressData | null>(null);
  const [categories, setCategories] = useState<CategoryPerformance[]>([]);
  const [engagement, setEngagement] = useState<EngagementQuality | null>(null);
  const [sparklinePoints, setSparklinePoints] = useState<SparklinePoint[]>([]);
  const [topics, setTopics] = useState<TopicPerformance[]>([]);
  const [hooks, setHooks] = useState<{ by_hook_type: HookPerformance[]; by_format_style: HookPerformance[] }>({ by_hook_type: [], by_format_style: [] });
  const [imageSubtypes, setImageSubtypes] = useState<ImageSubtypePerformance[]>([]);

  const load = () => {
    const fail = (what: string) => () => showError(`Failed to load ${what}`);

    api.deepDiveProgress().then(setProgress).catch(fail("progress metrics"));
    api.deepDiveCategories().then((r) => setCategories(r.categories)).catch(fail("categories"));
    api.deepDiveEngagement().then((r) => setEngagement(r.engagement)).catch(fail("engagement"));
    api.deepDiveSparkline(90).then((r) => setSparklinePoints(r.points)).catch(err => console.error("[Coach] Failed to load sparkline:", err));
    api.deepDiveTopics().then((r) => setTopics(r.topics)).catch(fail("topics"));
    api.deepDiveHooks().then(setHooks).catch(fail("hook performance"));
    api.deepDiveImageSubtypes().then((r) => setImageSubtypes(r.subtypes)).catch(err => console.error("[Coach] Failed to load image subtypes:", err));
  };

  return {
    progress,
    categories,
    engagement,
    sparklinePoints,
    topics,
    hooks,
    imageSubtypes,
    load,
  };
}
