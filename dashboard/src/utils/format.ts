export function fmt(n: number | null | undefined): string {
  if (n == null) return "--";
  return n.toLocaleString();
}

export function fmtPct(n: number | null | undefined): string {
  if (n == null) return "--";
  return (n * 100).toFixed(1) + "%";
}
