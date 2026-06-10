/**
 * Runs in MAIN world — has direct DOM and window access.
 * Intercepts fetch/XHR to capture tRPC batch responses and
 * uses MutationObserver to detect image tiles reactively.
 */
export default defineContentScript({
  matches: ['*://*.google.com/*', '*://labs.google/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    console.log('[FLOW] Injector active (MAIN world)');
    installFetchInterceptor();
    installXHRInterceptor();
    scheduleMutationObserver();
    installCommandListener();
  },
});

// ─── Fetch interceptor ────────────────────────────────────────────────────────

function installFetchInterceptor() {
  const _fetch = window.fetch;

  window.fetch = async function (...args: Parameters<typeof fetch>) {
    const url =
      typeof args[0] === 'string' ? args[0] : (args[0] as Request)?.url ?? '';

    const response = await _fetch.apply(this, args);

    if (url.includes('/fx/api/trpc/') || url.includes('batchGenerateImages')) {
      response
        .clone()
        .text()
        .then((text) => {
          if (!text.includes('batchId') && !text.includes('mediaId')) return;
          try {
            window.postMessage({ type: 'FLOW_BATCH_RESPONSE', data: JSON.parse(text) }, '*');
          } catch {
            // NDJSON streaming
            text
              .split('\n')
              .filter((l) => l.trim())
              .forEach((line) => {
                try {
                  const data = JSON.parse(line);
                  if (JSON.stringify(data).includes('batchId')) {
                    window.postMessage({ type: 'FLOW_BATCH_RESPONSE', data }, '*');
                  }
                } catch {}
              });
          }
        })
        .catch(() => {});
    }

    return response;
  };
}

// ─── XHR interceptor ─────────────────────────────────────────────────────────

function installXHRInterceptor() {
  const _open = XMLHttpRequest.prototype.open;
  const _send = XMLHttpRequest.prototype.send;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XMLHttpRequest.prototype.open = function (...args: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (this as any)._flowUrl = args[1] as string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_open as any).apply(this, args);
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  XMLHttpRequest.prototype.send = function (...args: any[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((this as any)._flowUrl?.includes('batchGenerateImages')) {
      this.addEventListener('load', function (this: XMLHttpRequest) {
        try {
          window.postMessage(
            { type: 'FLOW_BATCH_RESPONSE', data: JSON.parse(this.responseText) },
            '*',
          );
        } catch {}
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (_send as any).apply(this, args);
  };
}

// ─── MutationObserver for reactive tile detection ────────────────────────────

function scheduleMutationObserver() {
  const start = () => {
    if (!document.body) return;
    installMutationObserver();
  };

  if (document.body) {
    start();
  } else {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  }
}

function installMutationObserver() {
  const notified = new Set<string>();

  function reportTile(tileId: string, src: string) {
    if (notified.has(tileId)) return;
    notified.add(tileId);
    const fullSrc = src.startsWith('/') ? location.origin + src : src;
    window.postMessage({ type: 'FLOW_TILE_APPEARED', payload: { tileId, src: fullSrc } }, '*');
  }

  function tryReportTile(tile: HTMLElement) {
    const tileId = tile.getAttribute('data-tile-id');
    if (!tileId || notified.has(tileId)) return;

    // Check for rate-limit error text
    if (tile.textContent?.includes('too quickly') || tile.textContent?.includes('rate limit')) {
      window.postMessage({ type: 'FLOW_RATE_LIMIT', payload: { tileId } }, '*');
      return;
    }

    const img = tile.querySelector('img') as HTMLImageElement | null;
    if (!img) return;

    if (img.src && !img.src.startsWith('data:')) {
      reportTile(tileId, img.src);
      return;
    }

    // Image src not set yet — watch the img element for src attribute updates
    const imgObserver = new MutationObserver(() => {
      if (img.src && !img.src.startsWith('data:') && !notified.has(tileId)) {
        reportTile(tileId, img.src);
        imgObserver.disconnect();
      }
    });
    imgObserver.observe(img, { attributes: true, attributeFilter: ['src'] });
  }

  const observer = new MutationObserver((mutations) => {
    for (const mut of mutations) {
      // Attribute change on an img src (catches lazy loads / progressive renders)
      if (mut.type === 'attributes' && mut.target instanceof HTMLImageElement) {
        const img = mut.target as HTMLImageElement;
        const tile = img.closest('[data-tile-id]') as HTMLElement | null;
        if (tile && img.src && !img.src.startsWith('data:')) {
          const tileId = tile.getAttribute('data-tile-id');
          if (tileId) reportTile(tileId, img.src);
        }
        continue;
      }

      // New DOM nodes
      for (const node of mut.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;

        const selfMatch = node.matches('[data-tile-id]');
        const descendants = Array.from(node.querySelectorAll('[data-tile-id]'));
        const tiles: HTMLElement[] = [
          ...(selfMatch ? [node] : []),
          ...(descendants as HTMLElement[]),
        ];

        for (const tile of tiles) tryReportTile(tile);
      }
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src'],
  });

  console.log('[FLOW] MutationObserver active on document.body');
}

// ─── Command listener (receives FLOW_DO_INJECT from content script) ───────────

function installCommandListener() {
  window.addEventListener('message', ({ source, data }) => {
    if (source !== window || data?.type !== 'FLOW_DO_INJECT') return;
    const prompt = data.prompt as string;
    if (!prompt) return;

    doInject(prompt)
      .then(() => window.postMessage({ type: 'FLOW_INJECT_DONE' }, '*'))
      .catch((e) => console.error('[FLOW] Injection failed:', e));
  });
}

async function doInject(promptText: string): Promise<void> {
  const editor = document.querySelector<HTMLElement>('[data-slate-editor="true"]');
  if (!editor) throw new Error('Slate editor not found');

  editor.focus();

  const leaf = editor.querySelector('[data-slate-leaf="true"]') ?? editor;
  const sel  = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(leaf);
  range.collapse(false);
  sel?.removeAllRanges();
  sel?.addRange(range);

  const beforeInput = new InputEvent('beforeinput', {
    inputType: 'insertText', data: promptText, bubbles: true, cancelable: true,
  }) as InputEvent & { getTargetRanges: () => Range[] };
  beforeInput.getTargetRanges = () => [range];
  editor.dispatchEvent(beforeInput);

  if (!beforeInput.defaultPrevented) {
    document.execCommand('insertText', false, promptText);
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Small wait for React state to settle before clicking send
  await new Promise<void>((r) => setTimeout(r, 800));

  const sendBtn = findSendButton();
  if (sendBtn) {
    sendBtn.removeAttribute('disabled');
    sendBtn.removeAttribute('aria-disabled');
    sendBtn.style.pointerEvents = 'auto';
    sendBtn.click();

    // Also fire via React's synthetic event handler
    const rKey = Object.keys(sendBtn).find((k) => k.startsWith('__reactProps$'));
    if (rKey) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rProps = (sendBtn as Record<string, any>)[rKey] as { onClick?: (e: unknown) => void } | undefined;
      if (typeof rProps?.onClick === 'function') {
        try { rProps.onClick({ preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { isTrusted: true } }); } catch {}
      }
    }
  }

  // Enter key via React's onKeyDown handler
  editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
  const eKey = Object.keys(editor).find((k) => k.startsWith('__reactProps$'));
  if (eKey) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const eProps = (editor as Record<string, any>)[eKey] as { onKeyDown?: (e: unknown) => void } | undefined;
    if (typeof eProps?.onKeyDown === 'function') {
      try { eProps.onKeyDown({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13, preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { isTrusted: true } }); } catch {}
    }
  }
}

function findSendButton(): HTMLElement | null {
  // ARIA label first (most resilient)
  const byAria = document.querySelector<HTMLElement>(
    'button[aria-label*="send" i], button[aria-label*="generate" i], button[aria-label*="submit" i]',
  );
  if (byAria) return byAria;

  // Fallback: icon text content
  return Array.from(document.querySelectorAll<HTMLElement>('button')).find((b) => {
    const icon = b.querySelector('i.google-symbols, [class*="icon"]');
    return icon?.textContent?.trim() === 'arrow_forward';
  }) ?? null;
}
