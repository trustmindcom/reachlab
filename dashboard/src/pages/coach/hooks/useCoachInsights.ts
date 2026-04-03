import { useState } from "react";
import {
  api,
  type Insight,
  type Changelog,
  type AnalysisGap,
  type TimingSlot,
} from "../../../api/client";

export function useCoachInsights(showError: (msg: string) => void) {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [changelog, setChangelog] = useState<Changelog | null>(null);
  const [gaps, setGaps] = useState<AnalysisGap[]>([]);
  const [timingSlots, setTimingSlots] = useState<TimingSlot[]>([]);

  const load = () => {
    const fail = (what: string) => () => showError(`Failed to load ${what}`);

    api.insights().then((r) => setInsights(r.insights)).catch(fail("insights"));
    api.insightsChangelog().then(setChangelog).catch(err => console.error("[Coach] Failed to load changelog:", err));
    api.insightsGaps().then((r) => setGaps(r.gaps)).catch(err => console.error("[Coach] Failed to load gaps:", err));
    api.timing().then((r) => setTimingSlots(r.slots)).catch(fail("timing data"));
  };

  return {
    insights,
    changelog,
    gaps,
    timingSlots,
    load,
  };
}
