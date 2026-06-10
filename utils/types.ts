// ─── Finite State Machine ─────────────────────────────────────────────────────

/** States of the automation bot lifecycle */
export type BotState =
  | 'IDLE'            // Queue empty or not started
  | 'AWAITING_EDITOR' // Looking for the Slate editor element in DOM
  | 'INJECTING'       // Writing prompt text + clicking send button
  | 'GENERATING'      // Waiting for AI render (MutationObserver watching tiles)
  | 'DOWNLOADING'     // Images confirmed ready, triggering chrome.downloads
  | 'RATE_LIMITED'    // 429 / "too quickly" — exponential backoff running
  | 'PAUSED'          // User-initiated pause (state preserved)
  | 'ERROR';          // Unrecoverable error on current scene

/** Events that drive FSM transitions */
export type BotEvent =
  | 'START'
  | 'EDITOR_FOUND'
  | 'INJECTED'
  | 'ALL_IMAGES_READY'
  | 'DOWNLOAD_COMPLETE'
  | 'RATE_LIMIT'
  | 'COOLDOWN_DONE'
  | 'PAUSE'
  | 'RESUME'
  | 'FATAL_ERROR'
  | 'RESET';

// ─── Queue ───────────────────────────────────────────────────────────────────

export type PromptStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'DOWNLOADED'
  | 'ERROR'
  | 'RATE_LIMITED';

export interface QueueItem {
  id: string;
  scene_number: number;
  prompt: string;
  status: PromptStatus;
  retryCount: number;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Gallery ─────────────────────────────────────────────────────────────────

export interface GeneratedImage {
  id: string;
  sceneNumber: number;
  imageIndex: number;
  url: string;
  filename: string;
  downloadedAt: number;
}

// ─── Log ─────────────────────────────────────────────────────────────────────

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

// ─── Extension State (persisted to chrome.storage.local after every mutation) ─

export interface ExtensionState {
  botState: BotState;
  queue: QueueItem[];
  gallery: GeneratedImage[];
  logs: LogEntry[];
  isRunning: boolean;
  isPaused: boolean;
  activeTabId: number | null;
  activeSceneId: string | null; // ID of the currently IN_PROGRESS queue item
  projectName: string;
  apiSource: 'json' | 'local_api';
  localApiUrl: string;
  backoffAttempt: number;
  nextRetryAt: number;
  lastUpdated: number;
}

// ─── Script schema ───────────────────────────────────────────────────────────

export interface ImagePrompt {
  subjects: { description: string; action: string }[];
  environment: string;
  lighting: string;
  composition: string;
  style: string;
}

export interface ScriptScene {
  scene_number: number;
  image_prompt: ImagePrompt;
  narration?: string;
}

export interface ScriptData {
  scenes: ScriptScene[];
}
