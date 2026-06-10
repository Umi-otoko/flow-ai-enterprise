import { ImagePrompt } from './types';

export function parseImagePromptToText(prompt: ImagePrompt): string {
  const subjects = prompt.subjects.map(s => `${s.description} ${s.action}`).join(', ');
  return `Subjects: ${subjects}. Environment: ${prompt.environment}. Lighting: ${prompt.lighting}. Composition: ${prompt.composition}. Style: ${prompt.style}`.trim();
}

export function promptToSlug(text: string, maxLength = 45): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, maxLength)
    .replace(/^_|_$/g, '');
}
