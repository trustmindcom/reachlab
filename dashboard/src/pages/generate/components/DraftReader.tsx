import type { GenDraft } from "../../../api/client";

interface DraftReaderProps {
  draft: GenDraft;
}

export default function DraftReader({ draft }: DraftReaderProps) {
  return (
    <div className="flex-1 px-11 py-10 animate-fade-up-draft" key={`${draft.type}-${draft.hook.slice(0, 20)}`}>
      {/* Hook */}
      <h2 className="font-serif-gen text-[26px] leading-[1.3] text-gen-text-0 mb-6">
        {draft.hook}
      </h2>

      {/* Body */}
      <div
        className="text-[15.5px] leading-[1.85] text-gen-text-1 whitespace-pre-line mb-6"
        style={{ fontFamily: "var(--font-sans)" }}
      >
        {draft.body}
      </div>

      {/* Closing */}
      <div className="border-t border-gen-border-1 pt-4">
        <p className="font-serif-gen italic text-[15.5px] text-gen-text-0 leading-relaxed">
          {draft.closing}
        </p>
      </div>

      {/* Meta */}
      <div className="mt-4 text-[13px] text-gen-text-2">
        <span className="font-semibold text-gen-text-1">{draft.word_count}</span> words
        <span className="mx-2 text-gen-text-4">|</span>
        {draft.structure_label}
      </div>
    </div>
  );
}
