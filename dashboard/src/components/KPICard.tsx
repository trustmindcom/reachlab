interface Props {
  label: string;
  value: string;
  subtitle?: string | null;
  variant?: "default" | "hero";
}

export default function KPICard({ label, value, subtitle, variant = "default" }: Props) {
  const isPositive = subtitle?.startsWith("+");
  const isNegative = subtitle?.startsWith("-");
  const hero = variant === "hero";

  return (
    <div className={
      hero
        ? "bg-surface-1 border border-accent/20 rounded-lg p-6 flex flex-col gap-1"
        : "bg-surface-1 border border-border rounded-lg p-4 flex flex-col gap-1"
    }>
      <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
        {label}
      </span>
      <span className={`font-semibold tracking-tight font-mono tabular-nums ${hero ? "text-3xl" : "text-2xl"}`}>
        {value}
      </span>
      {subtitle && (
        <span
          className={`text-xs font-medium ${
            isPositive
              ? "text-positive"
              : isNegative
                ? "text-negative"
                : "text-text-secondary"
          }`}
        >
          {subtitle}
        </span>
      )}
    </div>
  );
}
