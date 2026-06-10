import { ExtensionState, QueueItem, GeneratedImage, LogEntry } from '../../utils/types';

const STATE_KEY = 'flow_ext_state_v2';
const MAX_GALLERY = 60;
const MAX_LOGS = 100;

export const DEFAULT_STATE: ExtensionState = {
  queue: [],
  gallery: [],
  logs: [],
  isRunning: false,
  isPaused: false,
  activeTabId: null,
  apiSource: 'json',
  localApiUrl: 'ws://localhost:8000/ws/prompts',
  projectName: 'Campaign',
  backoffAttempt: 0,
  nextRetryAt: 0,
  lastUpdated: Date.now(),
};

export class QueueStore {
  static async load(): Promise<ExtensionState> {
    const result = await chrome.storage.local.get(STATE_KEY);
    const stored = result[STATE_KEY] as Partial<ExtensionState> | undefined;
    if (!stored) return { ...DEFAULT_STATE };
    return { ...DEFAULT_STATE, ...stored };
  }

  static async save(patch: Partial<ExtensionState>): Promise<void> {
    const current = await QueueStore.load();
    const next: ExtensionState = {
      ...current,
      ...patch,
      lastUpdated: Date.now(),
    };
    await chrome.storage.local.set({ [STATE_KEY]: next });
  }

  static async pushLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): Promise<void> {
    const current = await QueueStore.load();
    const log: LogEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      ...entry,
    };
    const logs = [...current.logs, log].slice(-MAX_LOGS);
    await QueueStore.save({ logs });
  }

  static async pushGalleryImage(image: GeneratedImage): Promise<void> {
    const current = await QueueStore.load();
    const gallery = [...current.gallery, image].slice(-MAX_GALLERY);
    await QueueStore.save({ gallery });
  }

  static async clear(): Promise<void> {
    await chrome.storage.local.remove(STATE_KEY);
  }
}
