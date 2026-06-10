import { BotState, BotEvent } from '../../utils/types';

// ─── Transition table ─────────────────────────────────────────────────────────

interface Row {
  from: BotState | BotState[];
  on: BotEvent;
  to: BotState;
}

const ACTIVE: BotState[] = ['AWAITING_EDITOR', 'INJECTING', 'GENERATING', 'DOWNLOADING'];

const TABLE: Row[] = [
  // Normal flow
  { from: 'IDLE',           on: 'START',           to: 'AWAITING_EDITOR' },
  { from: 'AWAITING_EDITOR',on: 'EDITOR_FOUND',    to: 'INJECTING' },
  { from: 'INJECTING',      on: 'INJECTED',        to: 'GENERATING' },
  { from: 'GENERATING',     on: 'ALL_IMAGES_READY',to: 'DOWNLOADING' },
  { from: 'DOWNLOADING',    on: 'DOWNLOAD_COMPLETE',to: 'IDLE' },

  // Rate limiting
  { from: 'GENERATING',     on: 'RATE_LIMIT',      to: 'RATE_LIMITED' },
  { from: 'RATE_LIMITED',   on: 'COOLDOWN_DONE',   to: 'AWAITING_EDITOR' },

  // Pause / Resume (from any active state)
  { from: [...ACTIVE, 'IDLE', 'RATE_LIMITED'], on: 'PAUSE', to: 'PAUSED' },
  { from: 'PAUSED',         on: 'RESUME',          to: 'IDLE' },

  // Errors
  { from: ACTIVE,           on: 'FATAL_ERROR',     to: 'ERROR' },
  { from: 'ERROR',          on: 'RESET',           to: 'IDLE' },
];

// ─── Pure transition function ─────────────────────────────────────────────────

/**
 * Returns the next BotState given the current state and an incoming event.
 * Returns `current` unchanged when no transition is defined (defensive default).
 */
export function transition(current: BotState, event: BotEvent): BotState {
  for (const row of TABLE) {
    const froms = Array.isArray(row.from) ? row.from : [row.from];
    if (froms.includes(current) && row.on === event) return row.to;
  }
  return current;
}

/** True while the bot is actively working (not idle, paused, or errored). */
export function isProcessing(state: BotState): boolean {
  return ACTIVE.includes(state);
}

/** Human-readable label for each state (used in the popup UI). */
export const STATE_LABELS: Record<BotState, string> = {
  IDLE:            'Idle',
  AWAITING_EDITOR: 'Locating editor…',
  INJECTING:       'Injecting prompt',
  GENERATING:      'Generating…',
  DOWNLOADING:     'Downloading',
  RATE_LIMITED:    'Rate limited',
  PAUSED:          'Paused',
  ERROR:           'Error',
};

/** Tailwind color class for each state dot in the UI. */
export const STATE_COLOR: Record<BotState, string> = {
  IDLE:            'bg-slate-500',
  AWAITING_EDITOR: 'bg-blue-400 animate-pulse',
  INJECTING:       'bg-violet-400 animate-pulse',
  GENERATING:      'bg-indigo-400 animate-pulse',
  DOWNLOADING:     'bg-emerald-400 animate-pulse',
  RATE_LIMITED:    'bg-amber-400',
  PAUSED:          'bg-yellow-400',
  ERROR:           'bg-red-500',
};
