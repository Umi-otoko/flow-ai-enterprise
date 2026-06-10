/**
 * Runs in ISOLATED world — bridges postMessage events from the injector
 * (MAIN world) to the background service worker via chrome.runtime.sendMessage.
 */
export default defineContentScript({
  matches: ['*://*.google.com/*', '*://labs.google/*'],
  main() {
    console.log('[FLOW] Content bridge active (isolated world)');

    window.addEventListener('message', ({ source, data }) => {
      if (source !== window || !data?.type) return;

      switch (data.type) {
        case 'FLOW_BATCH_RESPONSE':
          chrome.runtime.sendMessage({ type: 'BATCH_DETECTED', payload: data.data }).catch(() => {});
          break;

        case 'FLOW_TILE_APPEARED':
          chrome.runtime.sendMessage({ type: 'IMAGE_TILE_APPEARED', payload: data.payload }).catch(() => {});
          break;

        case 'FLOW_RATE_LIMIT':
          chrome.runtime.sendMessage({ type: 'RATE_LIMIT_DETECTED', payload: data.payload }).catch(() => {});
          break;
      }
    });
  },
});
