import { Link, useLocation } from 'react-router-dom';
import { useState, useEffect, useReducer, useRef } from 'react';
import { toolsMenuReducer, TOOLS_CLOSED } from '../lib/ui/tools-menu';
import { useAuth } from '../contexts/AuthContext';
import { API_BASE } from '../api/oracle';
import { activeHost, apiUrl, hostLabel, isDefault, setStoredHost, clearStoredHost } from '../api/host';
import { cached } from '../lib/cache';

type NavItem = { path: string; label: string; studio?: string };

const FALLBACK_NAV: NavItem[] = [
  { path: '/', label: 'Overview' },
  { path: '/feed', label: 'Feed' },
  { path: '/map', label: 'Memory' },
  { path: '/search', label: 'Search' },
  { path: '/forum', label: 'Forum' },
  { path: '/pulse', label: 'Pulse' },
  { path: '/sessions', label: 'Sessions' },
  { path: '/plugins', label: 'Plugins' },
  { path: '/activity?tab=searches', label: 'Activity' },
];

const FALLBACK_TOOLS: NavItem[] = [
  { path: '/playground', label: 'Playground' },
  { path: '/compare', label: 'Compare' },
  { path: '/evolution', label: 'Evolution' },
  { path: '/traces', label: 'Traces' },
  { path: '/schedule', label: 'Schedule' },
];

/**
 * Menus hidden on our arra fork (applied to both /api/menu items and the fallback lists):
 * - /sessions: /api/sessions exists in neither fork nor upstream
 * - /canvas:   redirects to canvas.buildwithoracle.com, which doesn't resolve
 * - /menu:     Menu Editor needs arra's menu admin API (/api/menu/items…), not ported yet
 * - /pulse:    needs maw at http://<host>:3456 — only reachable when the page is on localhost
 *              (iOS blocks http from an https page; maw listens on 127.0.0.1)
 */
const HIDDEN_NAV_PATHS = ['/sessions', '/canvas', '/menu'];
const LOCAL_ONLY_NAV_PATHS = ['/pulse'];

function isLocalPage(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

function isNavVisible(item: NavItem): boolean {
  const clean = item.path.split('?')[0];
  if (HIDDEN_NAV_PATHS.includes(clean)) return false;
  if (LOCAL_ONLY_NAV_PATHS.includes(clean) && !isLocalPage()) return false;
  return true;
}

const MENU_CACHE_KEY = 'header:menu';
const MENU_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const VECTOR_ORIGIN = 'https://vector.buildwithoracle.com';

/** True when the current page is served from the studio bundle's prod hosts (studio.* or local.*). */
export function isStudioHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h.startsWith('studio.') || h.startsWith('local.');
}

/** Paths that should jump cross-origin to vector.* from the studio bundle. */
function isVectorPath(path: string): boolean {
  const clean = path.split('?')[0];
  return (
    clean === '/playground' ||
    clean.startsWith('/playground/') ||
    clean === '/compare' ||
    clean.startsWith('/compare/')
  );
}

type NavSet = { main: NavItem[]; tools: NavItem[] };

type MenuApiItem = {
  path: string;
  label: string;
  group?: string;
  order?: number;
  studio?: string;
};

function buildNavSet(items: MenuApiItem[]): NavSet {
  const main: Array<NavItem & { order: number }> = [];
  const tools: Array<NavItem & { order: number }> = [];
  for (const item of items) {
    if (!item || typeof item.path !== 'string' || typeof item.label !== 'string') continue;
    const bucket = item.group === 'tools' ? tools : item.group === 'main' ? main : null;
    if (!bucket) continue;
    const entry: NavItem & { order: number } = {
      path: item.path,
      label: item.label,
      order: typeof item.order === 'number' ? item.order : 999,
    };
    if (typeof item.studio === 'string' && item.studio) entry.studio = item.studio;
    bucket.push(entry);
  }
  const byOrder = (a: { order: number }, b: { order: number }) => a.order - b.order;
  main.sort(byOrder);
  tools.sort(byOrder);
  const strip = ({ path, label, studio }: NavItem & { order: number }): NavItem =>
    studio ? { path, label, studio } : { path, label };
  const mainItems = main.map(strip);
  return {
    main: mainItems.some((n) => n.path === '/' && !n.studio)
      ? mainItems
      : [{ path: '/', label: 'Overview' }, ...mainItems],
    tools: tools.map(strip),
  };
}

export function Header() {
  const location = useLocation();
  const { isAuthenticated, authEnabled, logout } = useAuth();
  const [tools, toolsDispatch] = useReducer(toolsMenuReducer, TOOLS_CLOSED);
  const toolsOpen = tools.open;
  const toolsBtn = useRef<HTMLButtonElement>(null);
  const toolsWrap = useRef<HTMLDivElement>(null);
  const toolsMenu = useRef<HTMLDivElement>(null);
  const [stats, setStats] = useState({ searches: 0, learnings: 0 });
  const [backendVersion, setBackendVersion] = useState<string | null>(null);
  const [nav, setNav] = useState<NavSet>({ main: FALLBACK_NAV, tools: FALLBACK_TOOLS });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(apiUrl('/api/health'));
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (!cancelled && typeof data.version === 'string') setBackendVersion(data.version);
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Cached via the shared client cache — 24h TTL, tag='menu'.
        // MenuEditor / GistSourceConfig call `cacheBus.invalidate('menu')` on write,
        // so edits bust this immediately instead of waiting for the old 5-min TTL.
        const data = await cached<{ items?: MenuApiItem[] }>(
          MENU_CACHE_KEY,
          MENU_CACHE_TTL_MS,
          async () => {
            const res = await fetch(apiUrl('/api/menu'));
            if (!res.ok) throw new Error(`menu ${res.status}`);
            return res.json();
          },
          { tag: 'menu' },
        );
        const items: MenuApiItem[] = Array.isArray(data?.items) ? data.items : [];
        if (cancelled || items.length === 0) return;
        setNav(buildNavSet(items));
      } catch {
        // Backend unreachable — keep fallback nav.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Tools menu: Esc + outside tap close it; a route change closes it; Esc returns focus
  useEffect(() => {
    if (!toolsOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); toolsDispatch({ type: 'escape' }); } };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (toolsWrap.current?.contains(t) || toolsMenu.current?.contains(t)) return;
      toolsDispatch({ type: 'outside' });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('pointerdown', onDown, true); };
  }, [toolsOpen]);
  useEffect(() => {
    if (!tools.refocus) return;
    toolsBtn.current?.focus();
    toolsDispatch({ type: 'refocused' });
  }, [tools.refocus]);
  useEffect(() => { toolsDispatch({ type: 'navigate' }); }, [location.pathname]);

  const navItems = nav.main.filter(isNavVisible);
  const toolsItems = nav.tools.filter(isNavVisible);
  const [sessionStart] = useState(() => {
    const stored = localStorage.getItem('oracle_session_start');
    if (stored) return parseInt(stored);
    const now = Date.now();
    localStorage.setItem('oracle_session_start', String(now));
    return now;
  });

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 30000);
    return () => clearInterval(interval);
  }, [sessionStart]);

  async function loadStats() {
    try {
      const res = await fetch(`${API_BASE}/session/stats?since=${sessionStart}`);
      if (res.ok) {
        const data = await res.json();
        setStats({ searches: data.searches, learnings: data.learnings });
      }
    } catch {}
  }

  const mins = Math.floor((Date.now() - sessionStart) / 60000);
  const duration = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;

  const isActive = (path: string) => location.pathname === path.split('?')[0];

  // Host passed to cross-origin studio links as ?host= (same-origin → this page's origin).
  const currentHost = activeHost || window.location.origin;

  function crossOriginHref(item: NavItem): string | null {
    if (item.studio) {
      return `https://${item.studio}${item.path}?host=${encodeURIComponent(currentHost)}`;
    }
    if (isStudioHost() && isVectorPath(item.path)) {
      return `${VECTOR_ORIGIN}${item.path}?host=${encodeURIComponent(currentHost)}`;
    }
    return null;
  }

  return (
    <header className="bg-bg-secondary border-b border-border sticky top-0 z-50" style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}>
      {/* Top row: logo + stats */}
      <div className="flex justify-between items-center px-4 py-2 max-sm:py-1.5">
        {/* phones: a 44 px tall hit area; -my-1.5 keeps the row (and the header) the same height */}
        <Link to="/" className="text-lg font-bold text-accent shrink-0 max-sm:flex max-sm:min-h-11 max-sm:items-center max-sm:-my-1.5">
          ARRA 🔮Racle
          <span
            className="text-[10px] font-medium text-text-muted bg-bg-card px-1.5 py-0.5 rounded ml-2 align-middle max-sm:hidden"
            title={backendVersion ? `ui ${__APP_VERSION__} · api ${backendVersion}` : `ui ${__APP_VERSION__}`}
          >
            {__APP_VERSION__}
            {backendVersion && <span className="text-text-muted/60"> · </span>}
            {backendVersion && <span className="text-accent/80">{backendVersion}</span>}
          </span>
        </Link>

        {/* Session stats - moved here */}
        <div className="flex items-center gap-3 max-sm:gap-2 text-xs text-text-muted font-mono min-w-0 ml-2">
          <button
            type="button"
            onClick={() => {
              const next = window.prompt(
                `Oracle host (leave empty to use the default: ${import.meta.env.DEV ? 'localhost:47778' : "this page's own origin"}):\n\nExamples:\n  localhost:47778\n  http://mba.wg:47778\n  https://oracle.example.com`,
                isDefault ? '' : hostLabel().replace(' (default)', '')
              );
              if (next === null) return;
              if (next.trim() === '') clearStoredHost();
              else setStoredHost(next.trim());
              window.location.reload();
            }}
            title={`Click to change host. Currently: ${hostLabel()}`}
            // the button is the (44 px tall on phones) hit area; the chip inside keeps its look
            className="group flex min-w-0 max-w-[260px] items-center rounded-md border-none bg-transparent p-0 font-[inherit] text-inherit cursor-pointer max-sm:max-w-[120px] max-sm:min-h-11 max-sm:-my-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            <span
              className={`flex min-w-0 items-center gap-1.5 px-2 py-0.5 rounded-md border transition-all duration-150 ${
                isDefault
                  ? 'border-border text-text-muted group-hover:bg-bg-card'
                  : 'border-accent/40 bg-accent/10 text-accent group-hover:bg-accent/20'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isDefault ? 'bg-text-muted' : 'bg-accent animate-pulse'}`} />
              <span className="truncate">{hostLabel()}</span>
            </span>
          </button>
          <span className="max-sm:hidden">{duration}</span>
          <span className="max-sm:hidden">{stats.searches}s</span>
          <span className="max-sm:hidden">{stats.learnings}l</span>
          <span className="w-px h-3 bg-border mx-1 max-sm:hidden" />
          <Link to="/settings" aria-label="Settings" className="p-1.5 rounded-md text-text-muted hover:text-accent hover:bg-bg-card transition-all duration-150 max-sm:flex max-sm:h-11 max-sm:w-11 max-sm:items-center max-sm:justify-center max-sm:-my-1.5" title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>
          {authEnabled && isAuthenticated && (
            <button onClick={logout} aria-label="Sign out" className="p-1.5 rounded-md text-text-muted hover:text-red-500 hover:bg-red-500/10 bg-transparent border-none cursor-pointer transition-all duration-150 max-sm:flex max-sm:h-11 max-sm:w-11 max-sm:items-center max-sm:justify-center max-sm:-my-1.5" title="Sign out">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Nav row: wraps on wide screens; one horizontally scrollable row on phones with
          an edge fade, Tools pinned outside the scroller (S3) */}
      <nav className="flex items-center gap-0.5 px-4 pb-2 max-sm:pb-1 max-sm:pr-2">
        <div className="web-nav-scroll flex min-w-0 flex-1 items-center gap-0.5 sm:flex-wrap max-sm:overflow-x-auto max-sm:overscroll-x-contain">
        {navItems.map(item => {
          const href = crossOriginHref(item);
          if (href) {
            return (
              <a
                key={href}
                href={href}
                className="px-2.5 py-1.5 rounded-lg text-[13px] whitespace-nowrap transition-all duration-150 text-text-secondary hover:bg-bg-card hover:text-accent border border-transparent max-sm:flex max-sm:min-h-11 max-sm:items-center max-sm:text-[14px]"
              >
                {item.label}
              </a>
            );
          }
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`px-2.5 py-1.5 rounded-lg text-[13px] whitespace-nowrap transition-all duration-150 max-sm:flex max-sm:min-h-11 max-sm:items-center max-sm:text-[14px] ${
                isActive(item.path)
                  ? 'bg-accent/15 text-accent font-semibold border border-accent/20'
                  : 'text-text-secondary hover:bg-bg-card hover:text-accent border border-transparent'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
        </div>

        <span className="w-px h-4 bg-border mx-2 max-sm:mx-1 shrink-0" />

        {/* Tools menu: tap / click / keyboard (never hover-only); a bottom sheet on phones */}
        <div ref={toolsWrap} className="relative shrink-0">
          <button
            ref={toolsBtn}
            type="button"
            aria-expanded={toolsOpen}
            aria-controls="header-tools-menu"
            onClick={() => toolsDispatch({ type: 'toggle' })}
            className={`px-2.5 py-1.5 rounded-lg text-[13px] whitespace-nowrap transition-all duration-150 bg-transparent border-none cursor-pointer font-[inherit] max-sm:flex max-sm:min-h-11 max-sm:items-center max-sm:text-[14px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
              toolsItems.some(t => isActive(t.path)) || toolsOpen
                ? 'bg-bg-card text-accent'
                : 'text-text-secondary hover:bg-bg-card hover:text-accent'
            }`}
          >
            Tools <span aria-hidden>▾</span>
          </button>
          {toolsOpen && (
            <>
              {/* phones: dim the page behind the sheet; a tap on it closes (outside-tap handler) */}
              <div aria-hidden className="tools-backdrop sm:hidden fixed inset-0 z-[190] bg-black/45" />
              <div
                ref={toolsMenu}
                id="header-tools-menu"
                aria-label="Tools"
                className="tools-menu z-[200] bg-bg-card border border-border p-1 shadow-lg sm:absolute sm:top-[calc(100%+4px)] sm:right-0 sm:min-w-[160px] sm:rounded-xl max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:max-h-[70vh] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:rounded-t-[20px] max-sm:px-3 max-sm:pt-3"
                style={{ paddingBottom: 'max(4px, env(safe-area-inset-bottom, 0px))' }}
              >
                <div className="sm:hidden px-2 pb-2 text-[12px] font-semibold uppercase tracking-[0.14em] text-text-secondary">Tools</div>
                {toolsItems.map(item => {
                  const href = crossOriginHref(item);
                  if (href) {
                    return (
                      <a
                        key={href}
                        href={href}
                        className="block px-3 py-2 rounded-lg text-[13px] whitespace-nowrap transition-all duration-150 text-text-secondary hover:bg-white/5 hover:text-accent max-sm:flex max-sm:min-h-11 max-sm:items-center max-sm:text-[15px]"
                        onClick={() => toolsDispatch({ type: 'navigate' })}
                      >
                        {item.label}
                      </a>
                    );
                  }
                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`block px-3 py-2 rounded-lg text-[13px] whitespace-nowrap transition-all duration-150 max-sm:flex max-sm:min-h-11 max-sm:items-center max-sm:text-[15px] ${
                        isActive(item.path)
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-secondary hover:bg-white/5 hover:text-accent'
                      }`}
                      onClick={() => toolsDispatch({ type: 'navigate' })}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </nav>

    </header>
  );
}
