import { Link } from 'react-router-dom';

/**
 * Galaxy | Web segmented switch (on /map and /graph). /graph is not in the arra
 * menu yet (follow-up arra story, ต่อ Q3), so this is how people reach it.
 */
export function ViewSwitch({ active, className, style }: { active: 'galaxy' | 'web'; className?: string; style?: React.CSSProperties }) {
  const item = (on: boolean) =>
    `flex min-h-11 items-center rounded-[10px] px-3.5 text-[14px] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${on
      ? 'bg-white/[0.1] font-semibold text-text-primary'
      : 'text-text-secondary hover:text-text-primary'}`;
  return (
    <nav aria-label="Map view" className={`flex gap-0.5 rounded-xl border border-white/[0.09] p-0.5 ${className ?? ''}`} style={style}>
      <Link to="/map" className={item(active === 'galaxy')} aria-current={active === 'galaxy' ? 'page' : undefined}>Galaxy</Link>
      <Link to="/graph" className={item(active === 'web')} aria-current={active === 'web' ? 'page' : undefined}>Web</Link>
    </nav>
  );
}
