import { useState } from "react";
import { useSpatialStore, type SpatialNodeData } from "../../../store/spatialStore";

const NOTE_COLORS = {
  amber: {
    bg: "bg-[#241d13]/90",
    border: "border-[#d4a03c]/40",
    text: "text-[#fed7aa]",
    indicator: "bg-[#d4a03c]",
  },
  cyan: {
    bg: "bg-[#11242d]/90",
    border: "border-[#38bdf8]/40",
    text: "text-[#bae6fd]",
    indicator: "bg-[#38bdf8]",
  },
  pink: {
    bg: "bg-[#281320]/90",
    border: "border-[#f472b6]/40",
    text: "text-[#fbcfe8]",
    indicator: "bg-[#f472b6]",
  },
  green: {
    bg: "bg-[#142619]/90",
    border: "border-[#4ade80]/40",
    text: "text-[#bbf7d0]",
    indicator: "bg-[#4ade80]",
  },
};

export function StickyNoteNodeView({ node }: { node: SpatialNodeData }) {
  const { updateNodeMeta } = useSpatialStore();
  const colorKey = node.meta?.noteColor || "amber";
  const color = NOTE_COLORS[colorKey] || NOTE_COLORS.amber;
  const [content, setContent] = useState(
    node.meta?.noteText ||
      "Spatial mapping of open files, terminals, and AI agents.\n\nCode the way you think — float spatially across code, live tests, and terminal outputs."
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setContent(val);
    updateNodeMeta(node.id, { noteText: val });
  };

  const handleColorChange = (c: "amber" | "cyan" | "pink" | "green") => {
    updateNodeMeta(node.id, { noteColor: c });
  };

  return (
    <div className={`flex-1 min-h-0 flex flex-col p-4 ${color.bg} transition-colors duration-200 overflow-hidden`}>
      {/* Color switcher header */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.08] shrink-0">
        <span className="text-[11px] uppercase tracking-wider text-white/50 font-mono">
          Architectural Note
        </span>
        <div className="flex items-center gap-1.5">
          {(["amber", "cyan", "pink", "green"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleColorChange(c)}
              title={`${c} note`}
              className={`w-3.5 h-3.5 rounded-full ${NOTE_COLORS[c].indicator} transition-transform ${
                colorKey === c ? "scale-125 ring-2 ring-white/50" : "opacity-60 hover:opacity-100"
              }`}
            />
          ))}
        </div>
      </div>

      {/* Editable handwritten text */}
      <textarea
        value={content}
        onChange={handleTextChange}
        placeholder="Type a thought, task, or architecture annotation..."
        style={{
          fontFamily: "'Architects Daughter', 'Caveat', 'Segoe Print', cursive",
        }}
        className={`flex-1 w-full resize-none bg-transparent outline-none text-base leading-relaxed ${color.text} placeholder:text-white/30`}
      />
    </div>
  );
}
