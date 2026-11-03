import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, FileText, Hand, LogOut, Plus, Send, Bot, Undo2, Square, KeyRound, X, MessageSquare } from "lucide-react";
import { openExternal } from "../../lib/browser";
import {
  activity, agentLine, browserLink, call, elapsed, joinTable, loadSeat, loadServer, parseInvite, saveSeat, saveServer, startTable, watch,
  type AgentEvent, type RoomView, type Seat, type Turn,
} from "../../lib/roundtable";

const input = "w-full rounded border border-fahh-surface bg-fahh-sidebar px-2 py-1 text-xs text-fahh-text outline-none focus:border-fahh-accent";
const primary = "px-3 py-1.5 rounded bg-fahh-accent text-[#0a0907] font-semibold text-xs hover:brightness-110 disabled:opacity-40 transition-all";
const quiet = "flex items-center gap-1 px-2 py-1 rounded bg-fahh-accent/20 text-fahh-accent text-xs hover:bg-fahh-accent/30 disabled:opacity-40";
const STATE: Record<string, string> = { running: "working", queued: "waiting", done: "done", failed: "failed", cancelled: "stopped" };

/** Roundtable: start or join a shared coding table without leaving Fahh. */
export function Roundtable() {
  const [seat, setSeat] = useState<Seat | null>(() => loadSeat());
  return seat ? <Table seat={seat} onLeave={() => (saveSeat(null), setSeat(null))} /> : <Lobby onSeated={(s) => (saveSeat(s), setSeat(s))} />;
}

function Lobby({ onSeated }: { onSeated: (s: Seat) => void }) {
  const [server, setServer] = useState(loadServer);
  const [link, setLink] = useState("");
  const [name, setName] = useState(() => localStorage.getItem("fahh-roundtable-name") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const go = async (how: "start" | "join") => {
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem("fahh-roundtable-name", name.trim());
      let base: string, code: string;
      if (how === "start") {
        code = await startTable(server);
        base = server.trim().replace(/\/+$/, "");
        saveServer(base);
      } else ({ base, code } = parseInvite(link));
      const seat = await joinTable(base, code, name);
      if (how === "start") await navigator.clipboard?.writeText(`${base}/${code}`).catch(() => {});
      onSeated(seat);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-3 text-xs space-y-4">
      <p className="text-fahh-muted">Sit at a shared coding table: everyone sees every turn, asks run one at a time, and each change is committed under the name of whoever asked.</p>
      <label className="block space-y-1">
        <span className="text-fahh-muted">Your name at the table</span>
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana" />
      </label>
      <section className="space-y-1.5 rounded border border-fahh-surface p-2">
        <div className="font-semibold text-fahh-text">Start a new table</div>
        <input className={input} value={server} onChange={(e) => setServer(e.target.value)} aria-label="Roundtable server" />
        <button className={`${primary} w-full flex items-center justify-center gap-1`} disabled={busy || !name.trim()} onClick={() => void go("start")}>
          <Plus size={12} /> Start a table
        </button>
        <p className="text-[10px] text-fahh-muted">The invite link is copied for you to send.</p>
      </section>
      <section className="space-y-1.5 rounded border border-fahh-surface p-2">
        <div className="font-semibold text-fahh-text">Join with an invite link</div>
        <input className={input} value={link} onChange={(e) => setLink(e.target.value)} placeholder="http://host:4173/ABC12" onKeyDown={(e) => e.key === "Enter" && void go("join")} />
        <button className={`${quiet} w-full justify-center`} disabled={busy || !name.trim() || !link.trim()} onClick={() => void go("join")}>
          Join
        </button>
      </section>
      {error && <p className="text-fahh-error">{error}</p>}
    </div>
  );
}

function Table({ seat, onLeave }: { seat: Seat; onLeave: () => void }) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [live, setLive] = useState<Record<string, string>>({});
  const [last, setLast] = useState<AgentEvent | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"table" | "files">("table");
  const [, tick] = useState(0);
  const api = (path: string, opts: Parameters<typeof call>[2] = {}) => call(seat.base, `/api/rooms/${seat.code}${path}`, { token: seat.member.token, ...opts });
  const refreshTimer = useRef<ReturnType<typeof setTimeout>>();
  const refresh = () => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void api("").then(setRoom).catch((e) => setError(e.message)), 120);
  };

  useEffect(() => {
    const stop = new AbortController();
    void watch(
      seat,
      (type, data) => {
        if (type === "room.snapshot") setRoom(data);
        else if (type === "room.gone") {
          setError("This table no longer exists.");
          onLeave();
        } else if (type === "turn.started") {
          setLast(null);
          setLive((l) => ({ ...l, [data.turn.id]: "" }));
          refresh();
        } else if (type === "turn.output") {
          setLast(data.event);
          if (data.event.kind === "text") setLive((l) => ({ ...l, [data.turnId]: (l[data.turnId] ?? "") + data.event.text }));
        } else if (type === "turn.finished") {
          setLast(null);
          setLive((l) => {
            const { [data.turn.id]: _, ...rest } = l;
            return rest;
          });
          refresh();
        } else refresh();
      },
      stop.signal,
      setConnected,
    );
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => (stop.abort(), clearInterval(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seat.base, seat.code, seat.member.token]);

  const flash = (m: string) => (setNotice(m), setTimeout(() => setNotice(null), 2200));
  const copy = async (text: string, said: string) => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    flash(said);
  };
  const leave = async () => {
    await api("/leave", { method: "POST", body: {} }).catch(() => {});
    onLeave();
  };

  return (
    <div className="h-full flex flex-col text-xs">
      <div className="px-3 py-2 border-b border-fahh-surface shrink-0 flex items-center gap-1.5">
        <span className="fahh-label text-[10px] uppercase tracking-widest text-fahh-muted font-semibold">Table</span>
        <span className="font-mono font-bold text-fahh-text tracking-widest">{seat.code}</span>
        <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500" : "bg-fahh-error animate-pulse"}`} title={connected ? "Live" : "Reconnecting"} />
        <span className="ml-auto flex gap-1">
          <IconBtn title="Copy invite link" onClick={() => void copy(`${seat.base}/${seat.code}`, "Invite link copied")}><Copy size={12} /></IconBtn>
          <IconBtn title="Connect my AI agent (copies one line to paste into it)" onClick={() => void copy(agentLine(seat), "Copied: paste it into your AI agent")}><Bot size={12} /></IconBtn>
          <IconBtn title="Open in browser (same seat)" onClick={() => void openExternal(browserLink(seat))}><ExternalLink size={12} /></IconBtn>
          <IconBtn title="Leave the table" onClick={() => void leave()}><LogOut size={12} /></IconBtn>
        </span>
      </div>
      {room && <People room={room} me={seat.member.id} />}
      <div className="flex border-b border-fahh-surface shrink-0">
        {(["table", "files"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`flex-1 py-1 ${tab === t ? "text-fahh-text border-b border-fahh-accent" : "text-fahh-muted"}`}>
            {t === "table" ? "Table" : "Files"}
          </button>
        ))}
      </div>
      {tab === "files" ? (
        <Files api={api} turns={room?.history.length ?? 0} />
      ) : (
        <>
          <Transcript room={room} live={live} me={seat.member.id} onUndo={(id) => void api("/undo", { method: "POST", body: { turnId: id } }).catch((e) => setError(e.message))} />
          {room?.running && (
            <div className="px-3 py-1 border-t border-fahh-surface text-fahh-muted flex items-center gap-1.5" aria-live="polite">
              <span className="w-1.5 h-1.5 rounded-full bg-fahh-accent animate-pulse" />
              <span className="truncate">{room.running.agent ?? "The agent"} is {activity(last)}</span>
              <span className="ml-auto font-mono text-[10px]">{elapsed(room.running.startedAt ?? Date.now())}</span>
              {(room.running.author === seat.member.id || room.members.find((m) => m.id === seat.member.id)?.role === "owner") && (
                <IconBtn title="Stop this turn" onClick={() => void api("/stop", { method: "POST", body: { turnId: room.running!.id } })}><Square size={11} /></IconBtn>
              )}
            </div>
          )}
          {room && <Composer room={room} me={seat.member.id} api={api} onError={setError} />}
        </>
      )}
      {(error || notice) && (
        <div className={`px-3 py-1 border-t border-fahh-surface flex items-center gap-1 ${error ? "text-fahh-error" : "text-fahh-accent"}`}>
          <span className="flex-1">{error ?? notice}</span>
          {error && <IconBtn title="Dismiss" onClick={() => setError(null)}><X size={11} /></IconBtn>}
        </div>
      )}
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} className="p-1 rounded text-fahh-muted hover:text-fahh-text hover:bg-fahh-surface/60">
      {children}
    </button>
  );
}

function People({ room, me }: { room: RoomView; me: string }) {
  return (
    <div className="px-3 py-1.5 flex flex-wrap gap-1 border-b border-fahh-surface shrink-0">
      {room.members.map((m) => (
        <span key={m.id} title={[m.role, m.agent, m.keys?.length ? `keys: ${m.keys.join(", ")}` : ""].filter(Boolean).join(" · ")} className="px-1.5 py-0.5 rounded-full bg-fahh-surface/70 text-fahh-text">
          {m.role === "owner" ? "★ " : ""}{m.name}{m.id === me ? " (you)" : ""}
        </span>
      ))}
    </div>
  );
}

function Transcript({ room, live, me, onUndo }: { room: RoomView | null; live: Record<string, string>; me: string; onUndo: (id: string) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const items = useMemo(() => {
    if (!room) return [];
    const turns = [...room.history, ...(room.running ? [room.running] : []), ...room.waiting];
    return [
      ...turns.map((t) => ({ at: t.createdAt, turn: t as Turn | undefined, note: undefined })),
      ...room.notes.map((n) => ({ at: n.at, turn: undefined, note: n })),
    ].sort((a, b) => a.at - b.at);
  }, [room]);
  const undone = useMemo(() => new Set([...(room?.history ?? []), ...(room?.waiting ?? []), ...(room?.running ? [room.running] : [])].filter((t) => t.undoes && t.status !== "failed" && t.status !== "cancelled").map((t) => t.undoes!)), [room]);
  const name = (id: string) => room?.members.find((m) => m.id === id)?.name ?? "someone";
  // Braces matter: newer WebView2 returns a Promise from scrollIntoView, and an
  // effect that returns a non-function crashes React when it cleans up.
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [items.length, live]);

  if (!room) return <div className="flex-1 p-3 text-fahh-muted">Sitting down…</div>;
  return (
    <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2.5">
      {items.length === 0 && <p className="text-fahh-muted">Nothing has happened yet. Ask for the first change below.</p>}
      {items.map(({ turn, note }) =>
        note ? (
          <div key={note.id} className="flex gap-1.5">
            <MessageSquare size={11} className="mt-0.5 shrink-0 text-fahh-muted" />
            <div className="min-w-0">
              <span className="font-semibold text-fahh-text">{note.name}</span> <span className="text-fahh-muted">note</span>
              <div className="text-fahh-text whitespace-pre-wrap break-words">{note.text || (note.images?.length ? `(${note.images.length} picture${note.images.length > 1 ? "s" : ""}: open in browser to see)` : "")}</div>
            </div>
          </div>
        ) : turn ? (
          <div key={turn.id} className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-fahh-text">{name(turn.author)}</span>
              <span className={`px-1 rounded text-[10px] ${turn.status === "failed" ? "bg-red-500/20 text-red-400" : "bg-fahh-surface text-fahh-muted"}`}>{STATE[turn.status] ?? turn.status}</span>
              {turn.agent && <span className="text-[10px] text-fahh-muted font-mono">{turn.agent}</span>}
              {turn.author === me && turn.status === "done" && turn.commit && !undone.has(turn.id) && (
                <button className="ml-auto flex items-center gap-0.5 text-[10px] text-fahh-muted hover:text-fahh-text" title="Queue a turn that reverts this change" onClick={() => onUndo(turn.id)}>
                  <Undo2 size={10} /> Undo
                </button>
              )}
            </div>
            <div className="rounded bg-fahh-surface/50 px-2 py-1 text-fahh-text whitespace-pre-wrap break-words">{turn.prompt}</div>
            {(live[turn.id] || turn.summary) && <div className="border-l-2 border-fahh-surface pl-2 text-fahh-text whitespace-pre-wrap break-words">{live[turn.id] || turn.summary}</div>}
            {turn.commit && <div className="text-[10px] text-fahh-muted font-mono">recorded as {turn.commit.slice(0, 7)}</div>}
            {turn.error && <div className="text-fahh-error">{turn.error}</div>}
          </div>
        ) : null,
      )}
      <div ref={end} />
    </div>
  );
}

function Composer({ room, me, api, onError }: { room: RoomView; me: string; api: (p: string, o?: any) => Promise<any>; onError: (m: string) => void }) {
  const mine = room.members.find((m) => m.id === me);
  const agents = (room.agents ?? []).filter((a) => a.ready);
  const [agent, setAgent] = useState(mine?.agent ?? room.agent ?? agents[0]?.name ?? "");
  const [text, setText] = useState("");
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const needsKey = (n: string) => agents.find((a) => a.name === n)?.needsKey && !mine?.keys?.includes(n);

  const send = async (asNote: boolean) => {
    const body = text.trim();
    if (!body) return;
    if (!asNote && needsKey(agent)) return setKeyFor(agent);
    setText("");
    try {
      await api(asNote ? "/say" : "/ask", { method: "POST", body: asNote ? { text: body } : { prompt: body, agent } });
    } catch (e) {
      setText(body);
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  const saveKey = async () => {
    if (!keyFor || !key.trim()) return;
    try {
      await api("/key", { method: "POST", body: { provider: keyFor, key: key.trim() } });
      setAgent(keyFor);
      setKeyFor(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setKey("");
    }
  };

  return (
    <div className="border-t border-fahh-surface p-2 space-y-1.5 shrink-0">
      {keyFor && (
        <div className="space-y-1 rounded border border-fahh-surface p-1.5">
          <div className="text-fahh-muted">Your {keyFor} key. Held in the table's memory while you're seated, never saved or shown.</div>
          <div className="flex gap-1">
            <input type="password" className={input} value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void saveKey()} autoFocus />
            <button className={quiet} onClick={() => void saveKey()}>Use</button>
            <IconBtn title="Cancel" onClick={() => setKeyFor(null)}><X size={11} /></IconBtn>
          </div>
        </div>
      )}
      <div className="flex gap-1 items-center">
        <select className={`${input} w-auto`} value={agent} onChange={(e) => (setAgent(e.target.value), needsKey(e.target.value) && setKeyFor(e.target.value))} title="Which agent runs your asks">
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.name}{a.needsKey ? (mine?.keys?.includes(a.name) ? " ✓" : " · key") : a.fallback ? " (stand-in)" : ""}
            </option>
          ))}
        </select>
        <IconBtn title="Use my own key" onClick={() => setKeyFor(agents.find((a) => a.name === agent)?.needsKey ? agent : agents.find((a) => a.needsKey)?.name ?? null)}><KeyRound size={12} /></IconBtn>
      </div>
      <textarea
        className={`${input} resize-none`}
        rows={2}
        value={text}
        placeholder="Ask for a change… (Enter to ask, Shift+Enter for a line)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void send(false);
          }
        }}
      />
      <div className="flex gap-1">
        <button className={`${quiet} flex-1 justify-center`} onClick={() => void send(true)} title="Say it to the table. Runs nothing."><Hand size={11} /> Note</button>
        <button className={`${primary} flex-1 flex items-center justify-center gap-1`} onClick={() => void send(false)}><Send size={11} /> Ask</button>
      </div>
    </div>
  );
}

function Files({ api, turns }: { api: (p: string, o?: any) => Promise<any>; turns: number }) {
  const [tree, setTree] = useState<string[] | null>(null);
  const [open, setOpen] = useState<{ path: string; content: string } | null>(null);
  useEffect(() => {
    api("/files").then((d) => setTree(d.tree)).catch(() => setTree([]));
    // Refresh whenever another turn lands in history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);
  const show = async (path: string) => {
    try {
      const d = await api(`/file?path=${encodeURIComponent(path)}`);
      setOpen({ path, content: d.tooBig ? `This file is ${Math.round(d.size / 1024)} KB, too large to show.` : d.content });
    } catch (e) {
      setOpen({ path, content: e instanceof Error ? e.message : String(e) });
    }
  };
  if (open) {
    return (
      <div className="flex-1 flex flex-col min-h-0">
        <div className="px-3 py-1 flex items-center gap-1 border-b border-fahh-surface">
          <span className="font-mono truncate text-fahh-text">{open.path}</span>
          <span className="ml-auto"><IconBtn title="Close" onClick={() => setOpen(null)}><X size={11} /></IconBtn></span>
        </div>
        <pre className="flex-1 overflow-auto p-2 font-mono text-[11px] text-fahh-text whitespace-pre">{open.content}</pre>
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto py-1">
      {tree === null ? null : tree.length === 0 ? (
        <p className="px-3 py-2 text-fahh-muted">No files yet. They appear here as turns commit them.</p>
      ) : (
        tree.map((p) => (
          <button key={p} onClick={() => void show(p)} className="w-full flex items-center gap-1.5 px-3 py-0.5 text-left hover:bg-fahh-surface/60 font-mono text-fahh-text">
            <FileText size={11} className="shrink-0 text-fahh-muted" /> <span className="truncate">{p}</span>
          </button>
        ))
      )}
    </div>
  );
}
