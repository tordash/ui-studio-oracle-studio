import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { isRemote } from '../api/host';
import { pairEvents } from '../lib/pulse/stream';
import { oracleColor } from '../lib/constellation/colors';
import { recipientOf } from '../lib/constellation/parse';
import { canUseTerminal } from '../lib/constellation/terminal-gate';
import { useFeedPoll } from '../hooks/useFeedPoll';
import { LiveDot } from '../components/constellation/LiveDot';

const MAW_BASE = `http://${window.location.hostname}:3456`;
/** maw :3456 (sessions, capture, send → tmux) only on localhost with no remote ?host= (C-D4). */
const TERMINAL_OK = canUseTerminal(isRemote, window.location.hostname);

const EVENT_ICONS: Record<string, string> = {
  UserPromptSubmit: '>_',
  PreToolUse: '...',
  PostToolUse: 'ok',
  Stop: '<<',
  SubagentStart: '++',
  SubagentStop: '--',
  SessionStart: 'ON',
  SessionEnd: 'OFF',
  Notification: '!!',
  TaskCompleted: 'TD',
  PostToolUseFailure: 'XX',
};

function getOracleColor(name: string): string {
  return oracleColor(name);
}

function relativeTime(ts: string): string {
  const now = new Date();
  // Parse as local time (feed.log timestamps are local)
  const then = new Date(ts.replace(' ', 'T'));
  const diffS = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (diffS < 5) return 'now';
  if (diffS < 60) return `${diffS}s`;
  if (diffS < 3600) return `${Math.floor(diffS / 60)}m`;
  if (diffS < 86400) return `${Math.floor(diffS / 3600)}h`;
  return `${Math.floor(diffS / 86400)}d`;
}

const MSG_TRUNCATE = 120;

function MessageCell({ text, className }: { text: string; className: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > MSG_TRUNCATE;

  if (!isLong) {
    return <span className={`text-sm font-mono leading-relaxed min-w-0 ${className}`}>{text}</span>;
  }

  return (
    <span
      className={`text-sm font-mono leading-relaxed min-w-0 cursor-pointer ${className}`}
      onClick={() => setExpanded(!expanded)}
    >
      {expanded ? text : text.slice(0, MSG_TRUNCATE) + '...'}
      <span className="text-[10px] text-white/30 ml-1.5">{expanded ? '[-]' : `[+${text.length - MSG_TRUNCATE}]`}</span>
    </span>
  );
}

interface MawSession {
  name: string;
  windows: { name: string }[];
}

interface TmuxWindow {
  oracle: string;
  target: string; // "session:window"
}

/** Hover popup — appears near mouse cursor with invisible bridge padding */
function HoverPreview({ oracle, target, x, y, onPin, onMouseEnter, onMouseLeave }: {
  oracle: string; target: string; x: number; y: number; onPin: () => void;
  onMouseEnter: () => void; onMouseLeave: () => void;
}) {
  const [content, setContent] = useState('');
  const color = getOracleColor(oracle);
  const W = 440, H = 400;
  const PAD = 24; // invisible bridge zone around popup

  useEffect(() => {
    const load = () => fetch(`${MAW_BASE}/api/capture?target=${encodeURIComponent(target)}`)
      .then(r => r.json()).then(d => { if (d.content) setContent(d.content); }).catch(() => {});
    load();
    const iv = setInterval(load, 1500);
    return () => clearInterval(iv);
  }, [target]);

  // Smart position: prefer right of cursor, flip left if no space. Prefer below, flip above.
  const spaceRight = window.innerWidth - x;
  const left = spaceRight > W + 20 ? x + 16 : x - W - 16;
  const spaceBelow = window.innerHeight - y;
  const top = spaceBelow > H + 20 ? y - 40 : y - H + 40;

  const finalLeft = Math.max(8, left);
  const finalTop = Math.max(8, top);

  return (
    <div
      className="fixed z-50"
      style={{ left: finalLeft - PAD, top: finalTop - PAD, width: W + PAD * 2, height: H + PAD * 2 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div
        className="absolute rounded-xl border overflow-hidden flex flex-col shadow-2xl"
        style={{ left: PAD, top: PAD, width: W, height: H, borderColor: color + '50', background: '#0c0c14' }}
        onClick={(e) => { e.stopPropagation(); onPin(); }}
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.08]">
          <span className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: color }} />
          <span className="text-sm font-mono font-bold" style={{ color }}>{oracle}</span>
          <span className="text-[10px] font-mono text-white/25 ml-auto">click to expand</span>
        </div>
        <div className="flex-1 overflow-auto p-3 font-mono text-[12px] leading-[1.4] text-white/80 whitespace-pre-wrap">
          {content ? (
            <div dangerouslySetInnerHTML={{ __html: ansiToHtml(content) }} />
          ) : (
            <span className="text-white/30">...</span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Full terminal modal — pinned view with input */
function TerminalPreview({ oracle, target, onClose }: { oracle: string; target: string; onClose: () => void }) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const color = getOracleColor(oracle);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchCapture = useCallback(async () => {
    try {
      const res = await fetch(`${MAW_BASE}/api/capture?target=${encodeURIComponent(target)}`);
      const data = await res.json();
      if (data.content) {
        setContent(data.content);
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    fetchCapture();
    intervalRef.current = setInterval(fetchCapture, 1000);
    // Focus input
    setTimeout(() => inputRef.current?.focus(), 100);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchCapture]);

  async function sendCommand(text: string) {
    if (!text.trim()) return;
    setSending(true);
    try {
      await fetch(`${MAW_BASE}/api/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, text: text + '\n' }),
      });
      setInputText('');
      // Quick refresh to see result
      setTimeout(fetchCapture, 300);
    } catch {} finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[90vw] max-w-[800px] h-[80vh] rounded-xl border overflow-hidden flex flex-col shadow-2xl"
        style={{ borderColor: color + '40', background: '#0c0c14' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08]">
          <div className="flex items-center gap-2.5">
            <span className="w-3 h-3 rounded-full animate-pulse" style={{ background: color }} />
            <span className="text-base font-mono font-bold" style={{ color }}>{oracle}</span>
            <span className="text-xs font-mono text-white/30">{target}</span>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white text-lg px-2 cursor-pointer bg-transparent border-none"
          >x</button>
        </div>

        {/* Terminal content */}
        <div ref={scrollRef} className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-[1.4] text-white/90 whitespace-pre-wrap">
          {loading ? (
            <span className="text-white/30">Connecting to terminal...</span>
          ) : content ? (
            <div dangerouslySetInnerHTML={{ __html: ansiToHtml(content) }} />
          ) : (
            <span className="text-white/30">No output</span>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={(e) => { e.preventDefault(); sendCommand(inputText); }}
          className="flex items-center gap-2 px-4 py-3 border-t border-white/[0.08]"
        >
          <span className="text-sm font-mono" style={{ color }}>{'>'}</span>
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            placeholder={`Send to ${oracle}...`}
            className="flex-1 bg-transparent border-none outline-none text-sm font-mono text-white placeholder:text-white/20 [&::-webkit-search-cancel-button]:hidden [&::-webkit-clear-button]:hidden [&::-ms-clear]:hidden"
            style={{ WebkitAppearance: 'none' } as React.CSSProperties}
            inputMode="text"
            enterKeyHint="send"
            autoFocus
            disabled={sending}
          />
          <button
            type="submit"
            disabled={sending || !inputText.trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all disabled:opacity-20"
            style={{ borderColor: color + '40', color, background: color + '15' }}
          >
            {sending ? '...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Convert basic ANSI escape codes to HTML spans */
function ansiToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold
    .replace(/\x1b\[1m/g, '<b>')
    .replace(/\x1b\[0m/g, '</b>')
    // 256-color: \x1b[38;2;R;G;Bm
    .replace(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g, '<span style="color:rgb($1,$2,$3)">')
    // Basic colors
    .replace(/\x1b\[3(\d)m/g, (_, c) => {
      const colors = ['#000', '#e55', '#5e5', '#ee5', '#55e', '#e5e', '#5ee', '#eee'];
      return `<span style="color:${colors[parseInt(c)] || '#eee'}">`;
    })
    .replace(/\x1b\[39m/g, '</span>')
    // Strip remaining escapes
    .replace(/\x1b\[[0-9;]*m/g, '');
}

export function Pulse() {
  const feed = useFeedPoll();
  const [filterOracle, setFilterOracle] = useState<string | null>(null);
  const [tmuxWindows, setTmuxWindows] = useState<TmuxWindow[]>([]);
  const [terminalTarget, setTerminalTarget] = useState<{ oracle: string; target: string } | null>(null);
  const [hoverPreview, setHoverPreview] = useState<{ oracle: string; target: string; x: number; y: number } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set());
  const hoverTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  // the oracle filter runs client-side (the server's oracle= matches the sender only)
  const visibleRaw = useMemo(
    () => (filterOracle ? feed.raw.filter(e => e.oracle === filterOracle) : feed.raw),
    [feed.raw, filterOracle],
  );
  // Pair PreToolUse with PostToolUse to calculate duration, filter noise
  const { events, collapsedGroups } = useMemo(() => pairEvents(visibleRaw), [visibleRaw]);
  const activeOracles = feed.activeOracles;
  const total = feed.total;
  const loading = feed.lastOkAt == null && !feed.lastErr;

  useEffect(() => {
    if (!TERMINAL_OK) return;
    // Load tmux windows
    const ac = new AbortController();
    fetch(`${MAW_BASE}/api/sessions`, { signal: ac.signal }).then(r => r.json()).then((sessions: MawSession[]) => {
      const windows: TmuxWindow[] = [];
      for (const s of sessions) {
        for (const w of s.windows) {
          const oracle = w.name.replace(/-oracle$/, '');
          windows.push({ oracle, target: `${s.name}:${w.name}` });
        }
      }
      setTmuxWindows(windows);
    }).catch(() => {});
    return () => ac.abort();
  }, []);

  // Unique oracles from events for filter
  const allOracles = [...new Set(feed.raw.map(e => e.oracle))].sort();

  function openTerminal(oracleName: string) {
    const win = tmuxWindows.find(w => w.oracle === oracleName);
    if (win) setTerminalTarget({ oracle: oracleName, target: win.target });
  }

  return (
    <div className="min-h-[calc(100vh-64px)] bg-[#0a0a0f]">
      {/* Active Oracles bar */}
      <div className="border-b border-white/[0.06] px-6 py-5">
        <div className="max-w-[960px] mx-auto">
          <div className="flex items-center gap-4 mb-4">
            <h1 className="text-2xl font-bold text-white">Oracle Pulse</h1>
            <span className="text-sm font-mono text-white/50">{total} events</span>
            <div className="ml-auto flex items-center gap-3">
              <LiveDot lastOkAt={feed.lastOkAt} lastErr={feed.lastErr} hidden={feed.hidden} nextAt={feed.nextAt} />
              {/* freeze stops applying new data; polling (and the dot) keep going */}
              <button
                onClick={() => feed.setFrozen(!feed.frozen)}
                aria-pressed={feed.frozen}
                className={`px-4 py-1.5 rounded-md text-sm font-mono font-bold border transition-all ${
                  feed.frozen
                    ? 'border-amber-500/40 text-amber-400 bg-amber-500/10'
                    : 'border-white/15 text-white/60 bg-white/[0.04] hover:bg-white/[0.08]'
                }`}
              >
                {feed.frozen ? 'FROZEN' : 'FREEZE'}
              </button>
            </div>
          </div>

          {/* Active oracle pills */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-xs font-mono uppercase tracking-wider text-white/40 mr-1">Active:</span>
            {activeOracles.length === 0 && (
              <span className="text-sm text-white/30 font-mono">none</span>
            )}
            {activeOracles.map(name => (
              <button
                key={name}
                onClick={() => setFilterOracle(filterOracle === name ? null : name)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-mono font-medium transition-all cursor-pointer border ${
                  filterOracle === name
                    ? 'border-white/25 bg-white/10'
                    : 'border-transparent bg-white/[0.05] hover:bg-white/[0.1]'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full animate-pulse"
                  style={{ background: getOracleColor(name) }}
                />
                <span style={{ color: getOracleColor(name) }}>{name}</span>
              </button>
            ))}

            {/* Inactive oracles from events */}
            {allOracles.filter(o => !activeOracles.includes(o)).map(name => (
              <button
                key={name}
                onClick={() => setFilterOracle(filterOracle === name ? null : name)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-mono transition-all cursor-pointer border ${
                  filterOracle === name
                    ? 'border-white/25 bg-white/10'
                    : 'border-transparent bg-white/[0.03] hover:bg-white/[0.07]'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-white/25" />
                <span className="text-white/40">{name}</span>
              </button>
            ))}

            {filterOracle && (
              <button
                onClick={() => setFilterOracle(null)}
                className="text-[10px] text-white/40 hover:text-white/60 ml-1 cursor-pointer"
              >
                clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Event stream */}
      <div className="max-w-[960px] mx-auto px-6 max-sm:px-2 py-4">
        {loading && (
          <div className="text-center text-white/30 py-12 font-mono text-sm">Loading feed...</div>
        )}

        <div className="flex flex-col">
          {events.flatMap((ev, i) => {
            const rows: React.ReactNode[] = [];
            const color = getOracleColor(ev.oracle);
            const hasDuration = ev.session_id.includes('|');
            const duration = hasDuration ? ev.session_id.split('|')[1] : null;

            const isToolDone = ev.event === 'ToolDone';
            const isToolFailed = ev.event === 'ToolFailed';
            const isCollapsed = ev.event === 'Collapsed';
            const icon = isCollapsed ? '~~' : isToolDone ? 'ok' : isToolFailed ? 'XX' : (EVENT_ICONS[ev.event] || '??');
            const isHumanMsg = ev.event === 'UserPromptSubmit';
            const isStop = ev.event === 'Stop';
            const isError = isToolFailed || ev.event === 'PostToolUseFailure';
            const isSession = ev.event === 'SessionStart' || ev.event === 'SessionEnd';
            const isExpanded = isCollapsed && expandedGroups.has(i);
            const group = isCollapsed ? collapsedGroups.get(i) : undefined;

            rows.push(
              <div
                key={`${ev.timestamp}-${i}`}
                className={`flex items-start gap-3 max-sm:gap-x-2 max-sm:gap-y-1 max-sm:flex-wrap py-2.5 px-4 max-sm:px-2 rounded-lg transition-colors ${
                  isHumanMsg ? 'bg-blue-500/[0.06]' : 'hover:bg-white/[0.03]'
                } ${isSession ? 'border-l-2 border-emerald-500/30' : ''} ${isCollapsed ? 'cursor-pointer' : ''}`}
                onClick={isCollapsed && group ? () => {
                  setExpandedGroups(prev => {
                    const next = new Set(prev);
                    if (next.has(i)) next.delete(i); else next.add(i);
                    return next;
                  });
                } : undefined}
              >
                {/* Time */}
                <span className="text-xs font-mono text-white/35 w-[36px] shrink-0 pt-0.5 text-right tabular-nums">
                  {relativeTime(ev.timestamp)}
                </span>

                {/* Oracle dot + name (hover=preview, click=full terminal) */}
                <div
                  className="flex items-center gap-2 w-[90px] shrink-0 cursor-pointer hover:opacity-80"
                  onClick={(e) => { if (!isCollapsed) { e.stopPropagation(); setHoverPreview(null); openTerminal(ev.oracle); } }}
                  onMouseEnter={!isCollapsed ? (e) => {
                    const win = tmuxWindows.find(w => w.oracle === ev.oracle);
                    if (!win) return;
                    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                    hoverTimeout.current = setTimeout(() => {
                      setHoverPreview({ oracle: ev.oracle, target: win.target, x: e.clientX, y: e.clientY });
                    }, 300);
                  } : undefined}
                  onMouseLeave={!isCollapsed ? () => {
                    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                    hoverTimeout.current = setTimeout(() => setHoverPreview(null), 200);
                  } : undefined}
                >
                  <span
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${activeOracles.includes(ev.oracle) ? 'animate-pulse' : ''}`}
                    style={{ background: color }}
                  />
                  <span className="text-sm font-mono font-medium truncate" style={{ color }}>
                    {ev.oracle}
                  </span>
                </div>

                {/* Event badge */}
                <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded w-[32px] text-center shrink-0 ${
                  isError ? 'bg-red-500/25 text-red-400'
                  : isHumanMsg ? 'bg-blue-500/25 text-blue-300'
                  : isStop ? 'bg-purple-500/25 text-purple-300'
                  : isSession ? 'bg-emerald-500/25 text-emerald-300'
                  : isToolDone ? 'bg-emerald-500/15 text-emerald-400'
                  : isCollapsed ? 'bg-white/[0.04] text-white/25'
                  : 'bg-white/[0.08] text-white/40'
                }`}>
                  {isCollapsed ? (isExpanded ? '▾' : '▸') : icon}
                </span>

                {/* Message (hover on AI responses to preview terminal) */}
                <div
                  className="min-w-0 flex-1 max-sm:order-last max-sm:basis-full max-sm:pl-[44px]"
                  onMouseEnter={isStop ? (e) => {
                    const win = tmuxWindows.find(w => w.oracle === ev.oracle);
                    if (!win) return;
                    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                    hoverTimeout.current = setTimeout(() => {
                      setHoverPreview({ oracle: ev.oracle, target: win.target, x: e.clientX, y: e.clientY });
                    }, 300);
                  } : undefined}
                  onMouseLeave={isStop ? () => {
                    if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
                    hoverTimeout.current = setTimeout(() => setHoverPreview(null), 200);
                  } : undefined}
                  onClick={isStop ? (e) => { e.stopPropagation(); setHoverPreview(null); openTerminal(ev.oracle); } : undefined}
                  style={isStop ? { cursor: 'pointer' } : undefined}
                >
                  {ev.event === 'MessageSend' && recipientOf(ev.message) && (
                    <span className="text-xs font-mono mr-2 whitespace-nowrap" style={{ color: getOracleColor(recipientOf(ev.message)!) }}>
                      → {recipientOf(ev.message)}
                    </span>
                  )}
                  <MessageCell
                    text={ev.message || ev.event}
                    className={
                      isCollapsed ? 'text-white/25 italic' : isHumanMsg ? 'text-blue-200' : isStop ? 'text-white/70 hover:text-white/90' : isError ? 'text-red-300' : 'text-white/45'
                    }
                  />
                </div>

                {/* Duration badge */}
                {duration && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                    isToolFailed ? 'bg-red-500/20 text-red-400' : 'bg-white/[0.06] text-white/40'
                  }`}>
                    {duration}
                  </span>
                )}

                {/* Project */}
                <span className="text-[10px] font-mono text-white/20 ml-auto shrink-0 hidden sm:block">
                  {ev.project}
                </span>
              </div>
            );

            {/* Expanded hidden events */}
            if (isExpanded && group) {
              for (const [j, hidden] of group.hidden.entries()) {
                const hColor = getOracleColor(hidden.oracle);
                const hDuration = hidden.session_id.includes('|') ? hidden.session_id.split('|')[1] : null;
                const hDone = hidden.event === 'ToolDone';
                const hFailed = hidden.event === 'ToolFailed';
                rows.push(
                  <div
                    key={`${ev.timestamp}-${i}-exp-${j}`}
                    className="flex items-start gap-3 py-1.5 px-4 pl-8 rounded-lg bg-white/[0.02]"
                  >
                    <span className="text-xs font-mono text-white/25 w-[36px] shrink-0 pt-0.5 text-right tabular-nums">
                      {relativeTime(hidden.timestamp)}
                    </span>
                    <div className="flex items-center gap-2 w-[90px] shrink-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: hColor + '60' }} />
                      <span className="text-xs font-mono text-white/30 truncate">{hidden.oracle}</span>
                    </div>
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded w-[32px] text-center shrink-0 ${
                      hFailed ? 'bg-red-500/20 text-red-400' : hDone ? 'bg-emerald-500/10 text-emerald-400/60' : 'bg-white/[0.05] text-white/30'
                    }`}>
                      {hDone ? 'ok' : hFailed ? 'XX' : '...'}
                    </span>
                    <span className="text-sm font-mono text-white/35 min-w-0 flex-1 truncate">{hidden.message}</span>
                    {hDuration && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 bg-white/[0.04] text-white/30">{hDuration}</span>
                    )}
                  </div>
                );
              }
            }

            return rows;
          })}
        </div>

        {events.length === 0 && !loading && (
          <div className="text-center text-white/20 py-12 font-mono text-sm">
            No activity yet. Oracles are sleeping.
          </div>
        )}
      </div>

      {/* Hover popup */}
      {TERMINAL_OK && hoverPreview && !terminalTarget && (
        <HoverPreview
          oracle={hoverPreview.oracle}
          target={hoverPreview.target}
          x={hoverPreview.x}
          y={hoverPreview.y}
          onPin={() => {
            setHoverPreview(null);
            setTerminalTarget({ oracle: hoverPreview.oracle, target: hoverPreview.target });
          }}
          onMouseEnter={() => { if (hoverTimeout.current) clearTimeout(hoverTimeout.current); }}
          onMouseLeave={() => setHoverPreview(null)}
        />
      )}

      {/* Terminal preview modal */}
      {TERMINAL_OK && terminalTarget && (
        <TerminalPreview
          oracle={terminalTarget.oracle}
          target={terminalTarget.target}
          onClose={() => setTerminalTarget(null)}
        />
      )}
    </div>
  );
}
