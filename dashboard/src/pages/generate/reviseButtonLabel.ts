export function reviseButtonLabel(selectedCount: number): string {
  return selectedCount === 0
    ? "Start over from my intent"
    : `Generate 3 from your ${selectedCount} included`;
}
