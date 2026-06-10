/**
 * ARIA/text-based DOM selectors.
 * Never relies on class names or deeply nested paths — those break when
 * the target platform ships a CSS-in-JS update. These survive structural
 * refactors as long as the semantic markup stays consistent.
 */
export const DOM = {
  /** The Slate rich-text editor where prompts are typed. */
  editor(): HTMLElement | null {
    return document.querySelector<HTMLElement>('[data-slate-editor="true"]');
  },

  /** Send / Generate button — tries ARIA label first, falls back to icon text. */
  sendButton(): HTMLElement | null {
    const byAria = document.querySelector<HTMLElement>(
      'button[aria-label*="send" i], button[aria-label*="generate" i], button[aria-label*="submit" i]',
    );
    if (byAria) return byAria;

    return (
      Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => {
        const icon = b.querySelector('i.google-symbols, [class*="icon"]');
        return icon?.textContent?.trim() === 'arrow_forward';
      }) ?? null
    );
  },

  /** All image tile containers currently in the DOM. */
  allTiles(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('[data-tile-id]'));
  },

  /** Tiles that have a fully-loaded image URL (not a data: placeholder). */
  readyTiles(): Array<{ tileId: string; src: string }> {
    return DOM.allTiles()
      .map((t) => {
        const img = t.querySelector<HTMLImageElement>('img');
        const tileId = t.getAttribute('data-tile-id');
        if (!tileId || !img?.src || img.src.startsWith('data:')) return null;
        const src = img.src.startsWith('/') ? location.origin + img.src : img.src;
        return { tileId, src };
      })
      .filter(Boolean) as Array<{ tileId: string; src: string }>;
  },

  /** Any tile showing a rate-limit / "too quickly" error message. */
  rateLimitTile(): HTMLElement | null {
    return (
      DOM.allTiles().find(
        (t) =>
          t.textContent?.toLowerCase().includes('too quickly') ||
          t.textContent?.toLowerCase().includes('rate limit') ||
          t.querySelector('[role="alert"]') !== null,
      ) ?? null
    );
  },

  /** Returns true if the page still shows an active generation spinner/loader. */
  isGenerating(): boolean {
    return (
      document.querySelector('[aria-busy="true"], [data-loading="true"]') !== null ||
      DOM.allTiles().some((t) => {
        const img = t.querySelector<HTMLImageElement>('img');
        return !img || img.src.startsWith('data:');
      })
    );
  },
};
