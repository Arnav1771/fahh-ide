import { ProblemsPanel } from "../../ProblemsPanel";

export function DiagnosticsNodeView() {
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#141311]">
      <ProblemsPanel />
    </div>
  );
}
