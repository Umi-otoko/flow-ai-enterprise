import { ScriptScene } from '../../utils/types';
import { parseImagePromptToText } from '../../utils/parser';

export type ApiPrompt = { scene_number: number; prompt: string };
export type PromptsCallback = (prompts: ApiPrompt[]) => void;
export type StatusCallback = (connected: boolean, error?: string) => void;

export class LocalApiClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onPromptsCb: PromptsCallback | null = null;
  private onStatusCb: StatusCallback | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;

  constructor(url = 'ws://localhost:8000/ws/prompts') {
    this.url = url;
  }

  onPrompts(cb: PromptsCallback): this {
    this.onPromptsCb = cb;
    return this;
  }

  onStatus(cb: StatusCallback): this {
    this.onStatusCb = cb;
    return this;
  }

  connect(url?: string): void {
    if (url) this.url = url;
    this.shouldReconnect = true;
    this.initSocket();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  /** One-shot HTTP fetch for REST-style FastAPI endpoints. */
  async fetchOnce(httpUrl: string): Promise<ApiPrompt[]> {
    const res = await fetch(httpUrl, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return this.normalize(await res.json());
  }

  private initSocket(): void {
    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => this.onStatusCb?.(true);

      this.ws.onmessage = ({ data }) => {
        try {
          const parsed = JSON.parse(data as string);
          const prompts = this.normalize(parsed);
          if (prompts.length) this.onPromptsCb?.(prompts);
        } catch {
          console.warn('[LocalApiClient] Malformed message', data);
        }
      };

      this.ws.onerror = () =>
        this.onStatusCb?.(false, `Cannot reach ${this.url}`);

      this.ws.onclose = () => {
        this.onStatusCb?.(false);
        if (this.shouldReconnect) {
          this.reconnectTimer = setTimeout(() => this.initSocket(), 5_000);
        }
      };
    } catch (e) {
      this.onStatusCb?.(false, String(e));
    }
  }

  private normalize(data: unknown): ApiPrompt[] {
    if (Array.isArray(data)) {
      if ((data[0] as any)?.image_prompt) {
        return (data as ScriptScene[]).map(s => ({
          scene_number: s.scene_number,
          prompt: parseImagePromptToText(s.image_prompt),
        }));
      }
      if ((data[0] as any)?.prompt) return data as ApiPrompt[];
    }
    const obj = data as any;
    if (obj?.scenes) {
      return (obj.scenes as ScriptScene[]).map(s => ({
        scene_number: s.scene_number,
        prompt: parseImagePromptToText(s.image_prompt),
      }));
    }
    return [];
  }
}
