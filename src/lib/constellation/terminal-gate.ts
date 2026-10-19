// Pulse terminal preview + send (maw :3456) is localhost-only (decision C-D4):
// it can type into tmux, so it never runs against a remote ?host= or from a
// tailnet / public hostname.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

export function canUseTerminal(isRemote: boolean, hostname: string): boolean {
  return !isRemote && LOCAL_HOSTS.has(hostname);
}
