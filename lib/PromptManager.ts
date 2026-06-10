import { ScriptScene } from '../utils/types';
import { parseImagePromptToText } from '../utils/parser';

export interface RawPrompt {
  scene_number: number;
  prompt: string;
}

/**
 * In-memory prompt queue.
 * Accepts JSON (scenes object, ScriptScene[], RawPrompt[], string[])
 * or plain text (one prompt per line). Stateless between loadFromText calls.
 */
export class PromptManager {
  private queue: RawPrompt[] = [];
  private cursor = 0;

  loadFromText(rawText: string): number {
    const text = rawText.trim();
    if (!text) {
      this.clear();
      return 0;
    }

    try {
      this.queue = this.normalize(JSON.parse(text) as unknown);
    } catch {
      // Plain text: one prompt per non-empty line
      this.queue = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((prompt, i) => ({ scene_number: i + 1, prompt }));
    }

    this.cursor = 0;
    return this.queue.length;
  }

  getNextPrompt(): RawPrompt | null {
    const item = this.queue[this.cursor];
    if (item === undefined) return null;
    this.cursor++;
    return item;
  }

  peekNext(): RawPrompt | null {
    return this.queue[this.cursor] ?? null;
  }

  getAll(): RawPrompt[] {
    return [...this.queue];
  }

  count(): number {
    return this.queue.length;
  }

  remaining(): number {
    return this.queue.length - this.cursor;
  }

  clear(): void {
    this.queue = [];
    this.cursor = 0;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private normalize(data: unknown): RawPrompt[] {
    if (
      data !== null &&
      typeof data === 'object' &&
      !Array.isArray(data) &&
      'scenes' in data &&
      Array.isArray((data as Record<string, unknown>)['scenes'])
    ) {
      return this.fromScenes((data as { scenes: ScriptScene[] }).scenes);
    }

    if (!Array.isArray(data) || data.length === 0) {
      throw new Error('Unrecognized prompt format');
    }

    const first = data[0] as unknown;

    if (first !== null && typeof first === 'object' && 'image_prompt' in (first as object)) {
      return this.fromScenes(data as ScriptScene[]);
    }

    if (first !== null && typeof first === 'object' && 'prompt' in (first as object)) {
      return (data as RawPrompt[]).map((item, i) => ({
        scene_number: item.scene_number ?? i + 1,
        prompt: String(item.prompt),
      }));
    }

    if (typeof first === 'string') {
      return (data as string[]).map((prompt, i) => ({ scene_number: i + 1, prompt }));
    }

    throw new Error('Unrecognized prompt format');
  }

  private fromScenes(scenes: ScriptScene[]): RawPrompt[] {
    return scenes.map((s) => ({
      scene_number: s.scene_number,
      prompt: parseImagePromptToText(s.image_prompt),
    }));
  }
}
