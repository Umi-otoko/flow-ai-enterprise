import { QueueItem } from '../../../utils/types';

interface Props {
  queue: QueueItem[];
}

const statusRing: Record<string, string> = {
  PENDING:      'border-slate-500',
  IN_PROGRESS:  'border-violet-500',
  DOWNLOADED:   'border-emerald-500',
  ERROR:        'border-red-500',
  RATE_LIMITED: 'border-amber-500',
  RETRYING:     'border-amber-400',
};

const statusDot: Record<string, string> = {
  PENDING:      'bg-slate-500',
  IN_PROGRESS:  'bg-violet-500 animate-pulse',
  DOWNLOADED:   'bg-emerald-500',
  ERROR:        'bg-red-500',
  RATE_LIMITED: 'bg-amber-500',
  RETRYING:     'bg-amber-400 animate-pulse',
};

const statusLabel: Record<string, string> = {
  PENDING:      'Pending',
  IN_PROGRESS:  'Generating',
  DOWNLOADED:   'Done',
  ERROR:        'Error',
  RATE_LIMITED: 'Rate limited',
  RETRYING:     'Retrying',
};

export function QueueList({ queue }: Props) {
  if (queue.length === 0) {
    return (
      <p className="text-xs text-slate-600 italic">Queue is empty — load a JSON or connect the local API.</p>
    );
  }

  return (
    <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1 scrollbar-thin">
      {queue.map((item) => (
        <div
          key={item.id}
          className={`flex items-start gap-2 p-2 rounded-md bg-slate-800/60 border-l-2 ${statusRing[item.status]}`}
        >
          <span className={`mt-1.5 shrink-0 w-2 h-2 rounded-full ${statusDot[item.status]}`} />
          <div className="flex-1 min-w-0">
            <div className="flex justify-between items-center gap-2">
              <span className="text-[10px] font-bold text-slate-300">
                Scene {String(item.scene_number).padStart(2, '0')}
              </span>
              <span className="text-[9px] font-mono text-slate-500 uppercase tracking-wide">
                {statusLabel[item.status]}
                {item.retryCount > 0 && ` ×${item.retryCount}`}
              </span>
            </div>
            <p className="text-[10px] text-slate-500 truncate mt-0.5">{item.prompt}</p>
            {item.errorMessage && (
              <p className="text-[9px] text-amber-400 mt-0.5 leading-tight">{item.errorMessage}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
