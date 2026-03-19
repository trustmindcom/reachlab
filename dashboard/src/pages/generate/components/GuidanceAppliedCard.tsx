import type { GenCoachingInsight } from "../../../api/client";

interface GuidanceAppliedCardProps {
  insights: GenCoachingInsight[];
}

export default function GuidanceAppliedCard({ insights }: GuidanceAppliedCardProps) {
  if (insights.length === 0) return null;

  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <h4 className="text-[13px] font-semibold text-gen-text-0 mb-3">Guidance applied</h4>
      <div className="space-y-2.5">
        {insights.map((insight) => (
          <div
            key={insight.id}
            className="pl-3 border-l-2 border-gen-accent text-[12px] text-gen-text-2 leading-relaxed"
          >
            <p className="text-gen-text-1 font-medium mb-0.5">{insight.title}</p>
            <p>{insight.prompt_text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
