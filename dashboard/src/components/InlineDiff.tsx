/**
 * Renders an inline diff between two strings, highlighting only the parts
 * that actually changed. Shared text shows in neutral color; removed text
 * in red with strikethrough; added text in green.
 *
 * Uses a simple word-level longest-common-subsequence approach — good enough
 * for paragraph-length prompt diffs without pulling in a full diff library.
 */

interface InlineDiffProps {
  oldText: string;
  newText: string;
}

interface DiffSegment {
  type: "equal" | "remove" | "add";
  text: string;
}

function tokenize(text: string): string[] {
  // Split on word boundaries but keep whitespace attached to preceding word
  return text.match(/\S+\s*/g) || [];
}

function lcsTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

function computeDiff(oldText: string, newText: string): DiffSegment[] {
  const oldWords = tokenize(oldText);
  const newWords = tokenize(newText);
  const dp = lcsTable(oldWords, newWords);
  const segments: DiffSegment[] = [];

  let i = oldWords.length;
  let j = newWords.length;
  const ops: Array<{ type: "equal" | "remove" | "add"; word: string }> = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      ops.push({ type: "equal", word: oldWords[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: "add", word: newWords[j - 1] });
      j--;
    } else {
      ops.push({ type: "remove", word: oldWords[i - 1] });
      i--;
    }
  }

  ops.reverse();

  // Merge consecutive same-type ops into segments
  for (const op of ops) {
    if (segments.length > 0 && segments[segments.length - 1].type === op.type) {
      segments[segments.length - 1].text += op.word;
    } else {
      segments.push({ type: op.type, text: op.word });
    }
  }

  return segments;
}

export default function InlineDiff({ oldText, newText }: InlineDiffProps) {
  const segments = computeDiff(oldText, newText);

  return (
    <div className="text-[14px] leading-relaxed font-mono whitespace-pre-wrap">
      {segments.map((seg, i) => {
        if (seg.type === "equal") {
          return <span key={i} className="text-text-secondary">{seg.text}</span>;
        }
        if (seg.type === "remove") {
          return (
            <span key={i} className="bg-negative/10 text-negative/70 line-through decoration-negative/40">
              {seg.text}
            </span>
          );
        }
        return (
          <span key={i} className="bg-positive/10 text-positive/80 font-medium">
            {seg.text}
          </span>
        );
      })}
    </div>
  );
}
