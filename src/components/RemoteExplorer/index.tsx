import { useCallback, useEffect, useState } from "react";
import { Box, ChevronDown, ChevronRight, FolderOpen, Monitor, RefreshCw, Server, SquareTerminal } from "lucide-react";
import { remoteContainers, remoteSshHosts, remoteWslDistros, remoteWslHome, type Container, type SshHost, type WslDistro } from "../../lib/tauri";
import { useWorkspace } from "../../hooks/useWorkspace";
import { useTerminalStore } from "../../store/terminalStore";
import { write } from "../../lib/ptySessions";
import { revealView } from "../../lib/workbench";
import { useToastStore } from "../../store/toastStore";

function Section({ title, onRefresh, children }: { title: string; onRefresh?: () => void; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-fahh-surface">
      <div className="flex items-center group">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex-1 flex items-center gap-1 px-2 py-1 text-[11px] uppercase tracking-wide font-semibold text-fahh-muted hover:text-fahh-text"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {title}
        </button>
        {onRefresh && (
          <button title="Refresh" aria-label={`Refresh ${title}`} onClick={onRefresh} className="mr-2 opacity-0 group-hover:opacity-100 text-fahh-muted hover:text-fahh-text">
            <RefreshCw size={12} />
          </button>
        )}
      </div>
      {open && <div className="pb-2">{children}</div>}
    </div>
  );
}

function Row({ icon, title, detail, actions }: { icon: React.ReactNode; title: string; detail?: string; actions: React.ReactNode }) {
  return (
    <div className="group flex items-center gap-2 px-3 py-1 text-xs hover:bg-fahh-surface/50">
      <span className="text-fahh-muted shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-fahh-text">{title}</div>
        {detail && <div className="truncate text-[11px] text-fahh-muted">{detail}</div>}
      </div>
      <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100">{actions}</div>
    </div>
  );
}

const Action = ({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) => (
  <button title={title} aria-label={title} onClick={onClick} className="p-0.5 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface">
    {children}
  </button>
);

/** A terminal tab that types `command` into a fresh shell (ssh, docker exec). */
function terminalRunning(title: string, command: string, profile = "", cwd?: string) {
  const id = useTerminalStore.getState().createSession(profile, title, cwd);
  revealView("terminal");
  void write(id, `${command}\r`);
}

/** Remote Explorer: WSL distros, SSH hosts and running containers, like VS Code's. */
export function RemoteExplorer() {
  const { openFolder } = useWorkspace();
  const toast = useToastStore((s) => s.show);
  const [distros, setDistros] = useState<WslDistro[] | null>(null);
  const [hosts, setHosts] = useState<SshHost[] | null>(null);
  const [containers, setContainers] = useState<Container[] | null>(null);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const isWindows = navigator.userAgent.includes("Windows");

  const loadWsl = useCallback(() => void remoteWslDistros().then(setDistros).catch(() => setDistros([])), []);
  const loadSsh = useCallback(() => void remoteSshHosts().then(setHosts).catch(() => setHosts([])), []);
  const loadDocker = useCallback(() => {
    setDockerError(null);
    void remoteContainers()
      .then(setContainers)
      .catch((e) => {
        setContainers([]);
        setDockerError(String(e));
      });
  }, []);
  useEffect(() => {
    loadWsl();
    loadSsh();
    loadDocker();
  }, [loadWsl, loadSsh, loadDocker]);

  const openWslHome = async (d: WslDistro) => {
    try {
      await openFolder(await remoteWslHome(d.name));
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto text-sm" data-testid="remote-explorer">
      {isWindows && (
        <Section title="WSL Targets" onRefresh={loadWsl}>
          {distros === null && <p className="px-3 text-xs text-fahh-muted">Looking for distros…</p>}
          {distros?.length === 0 && <p className="px-3 text-xs text-fahh-muted">No WSL distros. Install one with: wsl --install</p>}
          {distros?.map((d) => (
            <Row
              key={d.name}
              icon={<Monitor size={14} />}
              title={`${d.name}${d.default ? " (default)" : ""}`}
              detail={`WSL ${d.version} · ${d.running ? "Running" : "Stopped"}`}
              actions={
                <>
                  <Action title={`Open home folder in ${d.name}`} onClick={() => void openWslHome(d)}>
                    <FolderOpen size={13} />
                  </Action>
                  <Action title={`New terminal in ${d.name}`} onClick={() => terminalRunning(d.name, `cd ~`, "wsl", `\\\\wsl.localhost\\${d.name}\\`)}>
                    <SquareTerminal size={13} />
                  </Action>
                </>
              }
            />
          ))}
        </Section>
      )}

      <Section title="SSH" onRefresh={loadSsh}>
        {hosts === null && <p className="px-3 text-xs text-fahh-muted">Reading ~/.ssh/config…</p>}
        {hosts?.length === 0 && <p className="px-3 text-xs text-fahh-muted">No hosts in ~/.ssh/config. Add a Host block to list it here.</p>}
        {hosts?.map((h) => (
          <Row
            key={h.name}
            icon={<Server size={14} />}
            title={h.name}
            detail={[h.user, h.hostname].filter(Boolean).join("@") || undefined}
            actions={
              <Action title={`ssh ${h.name} in a terminal`} onClick={() => terminalRunning(`ssh ${h.name}`, `ssh ${h.name}`)}>
                <SquareTerminal size={13} />
              </Action>
            }
          />
        ))}
        {hosts && hosts.length > 0 && <p className="px-3 pt-1 text-[11px] text-fahh-muted">Opens an SSH session in the terminal. Editing remote files is not supported yet.</p>}
      </Section>

      <Section title="Dev Containers" onRefresh={loadDocker}>
        {containers === null && <p className="px-3 text-xs text-fahh-muted">Asking Docker…</p>}
        {dockerError && <p className="px-3 text-xs text-fahh-muted">{dockerError}</p>}
        {containers?.length === 0 && !dockerError && <p className="px-3 text-xs text-fahh-muted">No running containers.</p>}
        {containers?.map((c) => (
          <Row
            key={c.id}
            icon={<Box size={14} />}
            title={c.name}
            detail={`${c.image} · ${c.status}`}
            actions={
              <Action title={`Shell in ${c.name}`} onClick={() => terminalRunning(c.name, `docker exec -it ${c.id} sh -c "command -v bash >/dev/null && exec bash || exec sh"`)}>
                <SquareTerminal size={13} />
              </Action>
            }
          />
        ))}
      </Section>
    </div>
  );
}
