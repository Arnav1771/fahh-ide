import { ReaAnalysisPanel } from "../../ReaAnalysis";

export function ReaNodeView() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#141311] h-full w-full">
      <ReaAnalysisPanel />
    </div>
  );
}
