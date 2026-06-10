interface Props {
  total: number;
  downloaded: number;
  inProgress: number;
  nextRetryAt: number;
}

export function ProgressBar({ total, downloaded, inProgress, nextRetryAt }: Props) {
  const pct = total > 0 ? Math.round((downloaded / total) * 100) : 0;
  const isCoolingDown = nextRetryAt > Date.now();
  const cooldownSec = isCoolingDown ? Math.ceil((nextRetryAt - Date.now()) / 1000) : 0;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-xs text-slate-400">
        <span className="font-medium tracking-wide uppercase">Progress</span>
        <span className="tabular-nums font-mono">
          {downloaded}/{total} scenes &middot; {pct}%
        </span>
      </div>

      <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            background: pct === 100
              ? 'linear-gradient(90deg, #22c55e, #16a34a)'
              : 'linear-gradient(90deg, #6366f1, #8b5cf6)',
          }}
        />
      </div>

      <div className="flex justify-between text-xs">
        <span className="text-slate-500">
          {inProgress > 0 && (
            <span className="text-violet-400 animate-pulse">{inProgress} generating…</span>
          )}
        </span>
        {isCoolingDown && (
          <span className="text-amber-400 font-mono">Rate limit cooldown: {cooldownSec}s</span>
        )}
      </div>
    </div>
  );
}
