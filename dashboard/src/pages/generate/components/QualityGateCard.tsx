import type { GenQualityGate } from "../../../api/client";

interface QualityGateCardProps {
  gate: GenQualityGate;
}

export default function QualityGateCard({ gate }: QualityGateCardProps) {
  return (
    <div className="bg-gen-bg-2 border border-gen-border-2 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[13px] font-semibold text-gen-text-0">Quality gate</h4>
        <span
          className={`px-2 py-0.5 rounded-md text-[11px] font-medium ${
            gate.passed
              ? "bg-positive/10 text-positive border border-positive/20"
              : "bg-warning/10 text-warning border border-warning/20"
          }`}
        >
          {gate.passed ? "Passed" : "Warning"}
        </span>
      </div>
      <div className="space-y-2">
        {gate.checks.map((check) => (
          <div key={check.name} className="flex items-start gap-2">
            <span className="mt-0.5 flex-shrink-0">
              {check.status === "pass" ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="#34d399" strokeWidth="1.5" />
                  <path d="M4.5 7l1.5 1.5 3-3" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" stroke="#fbbf24" strokeWidth="1.5" />
                  <path d="M7 4.5v3M7 9.5h.005" stroke="#fbbf24" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              )}
            </span>
            <div>
              <p className="text-[12px] text-gen-text-1 font-medium">
                {check.name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
              </p>
              <p className="text-[11px] text-gen-text-3 leading-snug">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
