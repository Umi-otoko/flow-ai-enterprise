import { LogEntry } from '../../../utils/types';

interface Props {
  logs: LogEntry[];
}

const levelStyle: Record<LogEntry['level'], string> = {
  info:  'text-slate-400',
  warn:  'text-amber-400',
  error: 'text-red-400',
};

const levelBadge: Record<LogEntry['level'], string> = {
  info:  'bg-slate-700 text-slate-300',
  warn:  'bg-amber-900/60 text-amber-300',
  error: 'bg-red-900/60 text-red-300',
};

export function ErrorLog({ logs }: Props) {
  const visible = [...logs].reverse().slice(0, 30);

  return (
    <div className="space-y-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-400">
        Activity Log
      </h3>
      <div className="h-28 overflow-y-auto space-y-1 pr-1 scrollbar-thin">
        {visible.length === 0 ? (
          <p className="text-xs text-slate-600 italic">No activity yet.</p>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className="flex items-start gap-2 text-[10px] leading-relaxed">
              <span className={`shrink-0 mt-0.5 px-1 rounded font-bold uppercase ${levelBadge[entry.level]}`}>
                {entry.level}
              </span>
              <span className={`font-mono ${levelStyle[entry.level]}`}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
