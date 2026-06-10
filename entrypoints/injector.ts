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

  XMLHttpRequest.prototype.open = function (method: string, url: string, ...rest: any[]) {
    (this as any)._flowUrl = url;
    return _open.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (...args: any[]) {
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
    return _send.apply(this, args as any);
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
