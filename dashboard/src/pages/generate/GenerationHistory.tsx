interface GenerationHistoryProps {
  onOpen: (id: number) => void;
}

export default function GenerationHistory({ onOpen }: GenerationHistoryProps) {
  return (
    <div className="text-gen-text-3 text-[14px] py-12 text-center">
      Generation history — coming soon
    </div>
  );
}
