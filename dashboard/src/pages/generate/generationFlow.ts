export type ResearchStatus = "idle" | "loading" | "succeeded" | "failed";

export interface SourceContext {
  summary: string;
  source_headline: string;
  source_url: string;
}

export interface ResearchRequest {
  generationId: number;
  authorIntent: string;
  sourceContext?: SourceContext;
  avoid?: string[];
}

export function shouldClearAmbientSelection(submittedIntent: string): boolean {
  return submittedIntent.trim().length > 0;
}

export function canGenerateDrafts({
  generationId,
  researchStatus,
  allowIntentOnlyAfterFailure,
}: {
  generationId: number | null;
  researchStatus: ResearchStatus;
  allowIntentOnlyAfterFailure: boolean;
}): boolean {
  return generationId !== null
    && researchStatus !== "loading"
    && (researchStatus !== "failed" || allowIntentOnlyAfterFailure);
}

export function resolveAmbientIntent(guidance: string, label: string): string {
  return guidance.trim() || label.trim();
}

function sameSourceContext(left?: SourceContext, right?: SourceContext): boolean {
  if (!left || !right) return left === right;
  return left.summary === right.summary
    && left.source_headline === right.source_headline
    && left.source_url === right.source_url;
}

export function canRetryResearch(
  researchStatus: ResearchStatus,
  retryRequest: ResearchRequest | null,
  currentRequest: ResearchRequest,
): boolean {
  return researchStatus === "failed"
    && retryRequest !== null
    && retryRequest.generationId === currentRequest.generationId
    && retryRequest.authorIntent === currentRequest.authorIntent
    && sameSourceContext(retryRequest.sourceContext, currentRequest.sourceContext);
}
