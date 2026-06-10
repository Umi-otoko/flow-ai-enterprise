export type PromptStatus =
  | 'PENDING'
  | 'IN_PROGRESS'
  | 'DOWNLOADED'
  | 'ERROR'
  | 'RATE_LIMITED'
  | 'RETRYING';

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

export interface GeneratedImage {
  id: string;
  sceneNumber: number;
  imageIndex: number;
  url: string;
  filename: string;
  downloadedAt: number;
}

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
  narration: string;
}

export interface ScriptData {
  scenes: ScriptScene[];
}

export interface LogEntry {
  id: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

export interface ExtensionState {
  queue: QueueItem[];
  gallery: GeneratedImage[];
  logs: LogEntry[];
  isRunning: boolean;
  isPaused: boolean;
  activeTabId: number | null;
  apiSource: 'json' | 'local_api';
  localApiUrl: string;
  projectName: string;
  backoffAttempt: number;
  nextRetryAt: number;
  lastUpdated: number;
}

export type MessageType =
  | 'GET_STATE'
  | 'START_QUEUE'
  | 'PAUSE_QUEUE'
  | 'RESUME_QUEUE'
  | 'CLEAR_QUEUE'
  | 'STATE_UPDATED'
  | 'BATCH_DETECTED'
  | 'IMAGE_TILE_APPEARED'
  | 'RATE_LIMIT_DETECTED'
  | 'CONNECT_LOCAL_API'
  | 'DISCONNECT_LOCAL_API';
