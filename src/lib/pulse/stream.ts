// Pulse stream list — event pairing + collapse (moved from pages/Pulse.tsx, pure).

import type { FeedEvent } from '../../api/oracle';

export interface CollapsedGroup {
  placeholder: FeedEvent;
  hidden: FeedEvent[];
}

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

/** Shorten file paths and bash commands for display */
export function shortenMsg(msg: string): string {
  // Shorten absolute paths: keep last 2 segments
  return msg.replace(/\/(?:home\/\w+\/)?(?:Code\/)?(?:github\.com\/)?[\w-]+\/[\w-]+\/([\w/.@-]+)/g, (_, rest) => {
    const parts = rest.split('/');
    return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : rest;
  }).replace(/cd\s+~\/Code\/github\.com\/[\w-]+\/[\w-]+\s*&&\s*/g, '');
}

/** Merge PostToolUse into PreToolUse as duration, drop noise, collapse repeats */
export function pairEvents(events: FeedEvent[]): { events: FeedEvent[]; collapsedGroups: Map<number, CollapsedGroup> } {
  const result: FeedEvent[] = [];
  const pendingPre = new Map<string, number>();

  // Events are newest-first, iterate reverse (oldest first) to pair
  const reversed = [...events].reverse();
  for (const ev of reversed) {
    const key = `${ev.session_id}:${ev.oracle}`;

    if (ev.event === 'PreToolUse') {
      result.push({ ...ev, message: shortenMsg(ev.message) });
      pendingPre.set(key, result.length - 1);
    } else if (ev.event === 'PostToolUse' || ev.event === 'PostToolUseFailure') {
      const preIdx = pendingPre.get(key);
      if (preIdx !== undefined) {
        const pre = result[preIdx];
        const durationMs = parseTs(ev.timestamp) - parseTs(pre.timestamp);
        if (durationMs > 0 && durationMs < 300_000) {
          const durLabel = durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
          result[preIdx] = {
            ...pre,
            event: ev.event === 'PostToolUseFailure' ? 'ToolFailed' : 'ToolDone',
            session_id: pre.session_id + '|' + durLabel,
          };
        }
        pendingPre.delete(key);
      }
    } else {
      result.push({ ...ev, message: shortenMsg(ev.message) });
      pendingPre.delete(key);
    }
  }

  result.reverse();

  // Collapse consecutive same-tool events from same oracle (e.g. 8x Edit → "Edit x8")
  const collapsed: FeedEvent[] = [];
  const collapsedGroups = new Map<number, CollapsedGroup>();
  for (let i = 0; i < result.length; i++) {
    const ev = result[i];
    // maw relays are messages, not tool calls: every one starts with "<node>:", so they would
    // all collapse as "… N more mac-tor calls" (bug B). Never collapse them.
    if (ev.event === 'MessageSend') {
      collapsed.push(ev);
      continue;
    }
    const tool = ev.message.split(':')[0];
    // Count consecutive same oracle + same tool
    let count = 1;
    while (
      i + count < result.length &&
      result[i + count].oracle === ev.oracle &&
      result[i + count].message.split(':')[0] === tool &&
      (result[i + count].event === ev.event || result[i + count].event === 'ToolDone' || result[i + count].event === 'PreToolUse')
    ) {
      count++;
    }

    if (count >= 3) {
      // Collapse: show first, skip middle, show last
      collapsed.push(ev);
      const last = result[i + count - 1];
      const hidden = result.slice(i + 1, i + count - 1).map(e => ({ ...e, message: shortenMsg(e.message) }));
      const placeholder: FeedEvent = {
        ...ev,
        event: 'Collapsed',
        message: `... ${count - 2} more ${tool} calls`,
        session_id: ev.session_id,
      };
      collapsed.push(placeholder);
      collapsedGroups.set(collapsed.length - 1, { placeholder, hidden });
      collapsed.push(last);
      i += count - 1;
    } else {
      collapsed.push(ev);
    }
  }

  return { events: collapsed, collapsedGroups };
}
