import { useState } from "react";
import { useSpatialStore, type SpatialNodeData } from "../../../store/spatialStore";

const NOTE_COLORS = {
  amber: {
    // tinted from the theme surface, so a note reads in light and dark themes alike
    bg: "bg-[color-mix(in_srgb,#d4a03c_16%,var(--fahh-sidebar))]",
    border: "border-[#d4a03c]/50",
    text: "text-fahh-text",
    indicator: "bg-[#d4a03c]",
  },
  cyan: {
    // tinted from the theme surface, so a note reads in light and dark themes alike
    bg: "bg-[color-mix(in_srgb,#38bdf8_16%,var(--fahh-sidebar))]",
    border: "border-[#38bdf8]/50",
    text: "text-fahh-text",
    indicator: "bg-[#38bdf8]",
  },
  pink: {
    // tinted from the theme surface, so a note reads in light and dark themes alike
    bg: "bg-[color-mix(in_srgb,#f472b6_16%,var(--fahh-sidebar))]",
    border: "border-[#f472b6]/50",
    text: "text-fahh-text",
    indicator: "bg-[#f472b6]",
  },
  green: {
    // tinted from the theme surface, so a note reads in light and dark themes alike
    bg: "bg-[color-mix(in_srgb,#4ade80_16%,var(--fahh-sidebar))]",
    border: "border-[#4ade80]/50",
    text: "text-fahh-text",
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
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-fahh-surface shrink-0">
        <span className="text-[11px] uppercase tracking-wider text-fahh-muted font-mono">
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
                colorKey === c ? "scale-125 ring-2 ring-fahh-text/50" : "opacity-60 hover:opacity-100"
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
        className={`flex-1 w-full resize-none bg-transparent outline-none text-base leading-relaxed ${color.text} placeholder:text-fahh-muted`}
      />
    </div>
  );
}
