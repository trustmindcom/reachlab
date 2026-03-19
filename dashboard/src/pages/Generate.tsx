import { useState } from "react";
import SubTabBar, { type GenerateSubTab } from "./generate/SubTabBar";
import StorySelection from "./generate/StorySelection";
import DraftVariations from "./generate/DraftVariations";
import ReviewEdit from "./generate/ReviewEdit";
import Rules from "./generate/Rules";
import GenerationHistory from "./generate/GenerationHistory";
import type {
  GenStory,
  GenDraft,
  GenQualityGate,
  GenCoachingInsight,
} from "../api/client";

interface GenerationState {
  researchId: number | null;
  generationId: number | null;
  postType: "news" | "topic" | "insight";
  stories: GenStory[];
  articleCount: number;
  sourceCount: number;
  selectedStoryIndex: number | null;
  drafts: GenDraft[];
  selectedDraftIndices: number[];
  combiningGuidance: string;
  finalDraft: string;
  qualityGate: GenQualityGate | null;
  appliedInsights: GenCoachingInsight[];
}

const initialState: GenerationState = {
  researchId: null,
  generationId: null,
  postType: "news",
  stories: [],
  articleCount: 0,
  sourceCount: 0,
  selectedStoryIndex: null,
  drafts: [],
  selectedDraftIndices: [],
  combiningGuidance: "",
  finalDraft: "",
  qualityGate: null,
  appliedInsights: [],
};

export default function Generate() {
  const [subTab, setSubTab] = useState<GenerateSubTab>("Generate");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [gen, setGen] = useState<GenerationState>(initialState);
  const [loading, setLoading] = useState(false);

  const resetPipeline = () => {
    setGen(initialState);
    setStep(1);
  };

  return (
    <div>
      <SubTabBar active={subTab} onChange={setSubTab} />

      <div className="mt-6">
        {subTab === "Generate" && step === 1 && (
          <StorySelection
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onNext={() => setStep(2)}
          />
        )}
        {subTab === "Generate" && step === 2 && (
          <DraftVariations
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onBack={() => setStep(1)}
            onNext={() => setStep(3)}
          />
        )}
        {subTab === "Generate" && step === 3 && (
          <ReviewEdit
            gen={gen}
            setGen={setGen}
            loading={loading}
            setLoading={setLoading}
            onBack={() => setStep(2)}
            onReset={resetPipeline}
          />
        )}
        {subTab === "Rules" && <Rules />}
        {subTab === "History" && <GenerationHistory onOpen={(id) => {
          // TODO: restore generation from history
          setSubTab("Generate");
        }} />}
      </div>
    </div>
  );
}
