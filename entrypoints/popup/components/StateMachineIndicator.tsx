import type { BotState } from '../../../utils/types';
import { STATE_LABELS, STATE_COLOR } from '../../../lib/stateMachine/index';

interface Props {
  state: BotState;
  nextRetryAt: number;
  backoffAttempt: number;
}

export function StateMachineIndicator({ state, nextRetryAt, backoffAttempt }: Props) {
  const isCoolingDown = nextRetryAt > Date.now();
  const cooldownSec   = isCoolingDown ? Math.ceil((nextRetryAt - Date.now()) / 1000) : 0;

  const ALL_STATES: BotState[] = [
    'AWAITING_EDITOR', 'INJECTING', 'GENERATING', 'DOWNLOADING',
  ];

  return (
    <div className="space-y-2">
      {/* Current state badge */}
      <div className="flex items-center gap-2">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATE_COLOR[state]}`} />
        <span className="text-xs font-semibold text-slate-200">{STATE_LABELS[state]}</span>
        {isCoolingDown && (
          <span className="ml-auto text-[10px] font-mono text-amber-400">
            cooldown {cooldownSec}s (×{backoffAttempt})
          </span>
        )}
      </div>

      {/* Pipeline track — shows active step highlighted */}
      <div className="flex gap-1">
        {ALL_STATES.map((s, i) => {
          const isActive = state === s;
          const isDone   = ALL_STATES.indexOf(state) > i;
          return (
            <div
              key={s}
              className="flex-1 flex flex-col items-center gap-1"
              title={STATE_LABELS[s]}
            >
              <div
                className={`h-1 w-full rounded-full transition-colors duration-300 ${
                  isActive ? 'bg-violet-500' : isDone ? 'bg-emerald-600' : 'bg-slate-700'
                }`}
              />
              <span className="text-[8px] text-slate-600 truncate w-full text-center">
                {STATE_LABELS[s].replace('…', '')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}