import { Bell, Command, FolderOpen, Palette, PanelBottom, Volume2 } from "lucide-react";
import { useFahhStore } from "../../store/fahhStore";
import { runCommand } from "../../lib/commands";
import { Keycaps } from "./CommandPalette";

const ACTIONS = [
  { id: "folder.open", label: "Open a folder", Icon: FolderOpen, keys: undefined },
  { id: "palette.open", label: "Command palette", Icon: Command, keys: ["Ctrl", "Shift", "P"] },
  { id: "panel.toggle", label: "Terminal and run panel", Icon: PanelBottom, keys: ["Ctrl", "`"] },
  { id: "view.theme", label: "Change the theme", Icon: Palette, keys: undefined },
] as const;

/**
 * What you see with no file open: a title screen, not a blank pane. The bell
 * rings the fahh on purpose, so a new user hears what the editor is about
 * before their first typo does it for them.
 */
export function TitleScreen() {
  const fahhCount = useFahhStore((s) => s.fahhCount);
  const ringBell = useFahhStore((s) => s.ringBell);

  return (
    <div className="fahh-title relative flex flex-1 items-center justify-center overflow-hidden select-none">
      <div className="fahh-title-glow" aria-hidden="true" />
      <div className="relative flex flex-col items-center text-center">
        <button
          type="button"
          onClick={ringBell}
          className="fahh-bell group relative mb-5 flex h-20 w-20 items-center justify-center rounded-full"
          title="Ring the bell: play the fahh"
          aria-label="Ring the bell: play the fahh"
        >
          <span className="fahh-rings" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <Volume2 size={34} strokeWidth={1.5} className="relative text-fahh-accent" aria-hidden="true" />
        </button>

        <h1 className="fahh-wordmark">FAHH</h1>
        <p className="mt-2 font-mono text-xs tracking-[0.35em] text-fahh-muted uppercase">the editor that hears your mistakes</p>

        <ul className="mt-9 w-[340px] max-w-[80vw] space-y-1 text-left">
          {ACTIONS.map(({ id, label, Icon, keys }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => runCommand(id)}
                className="fahh-title-action flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-fahh-text transition-colors hover:bg-fahh-surface hover:text-fahh-text"
              >
                <Icon size={15} className="text-fahh-muted" aria-hidden="true" />
                <span className="flex-1 text-left">{label}</span>
                {keys && <Keycaps keys={[...keys]} />}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={ringBell}
              className="fahh-title-action flex w-full items-center gap-3 rounded px-3 py-2 text-sm text-fahh-text transition-colors hover:bg-fahh-surface hover:text-fahh-text"
            >
              <Bell size={15} className="text-fahh-muted" aria-hidden="true" />
              <span className="flex-1 text-left">Ring the bell</span>
              <span className="font-mono text-[11px] text-fahh-muted">test the fahh</span>
            </button>
          </li>
        </ul>

        <p className="fahh-press mt-8 font-mono text-[11px] tracking-[0.3em] uppercase text-fahh-muted">
          {fahhCount > 0 ? `${fahhCount} fahh${fahhCount === 1 ? "" : "s"} this session` : "press ctrl shift p"}
        </p>
      </div>
    </div>
  );
}
