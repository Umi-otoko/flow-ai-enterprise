/**
 * Content Script — "The Arms" (isolated world)
 *
 * Exactly three responsibilities:
 *   1. Maintain a long-lived port to the Service Worker (MV3 keepalive strategy #2)
 *   2. Bridge postMessage events from the injector (MAIN world) → SW
 *   3. Forward DOM commands from the SW to the injector via postMessage
 *
 * Zero business logic. No queue awareness. No state management.
 * All DOM mutations happen in injector.ts (MAIN world).
 */

import { maintainPort } from '../lib/keepAlive/index';

export default defineContentScript({
  matches: ['*://*.google.com/*', '*://labs.google/*'],
  main() {
    console.log('[FLOW CS] Content script active (isolated world)');

    // ── 1. Keepalive port — prevents Chrome from killing the SW ───────────────
    maintainPort((msg: any) => {
      // Commands sent by SW via the port (faster than one-shot messages)
      if (msg.type === 'INJECT_PROMPT') {
        window.postMessage({ type: 'FLOW_DO_INJECT', prompt: msg.prompt }, '*');
      }
    });

    // ── 2. Bridge: injector (MAIN world) → SW ─────────────────────────────────
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

        case 'FLOW_INJECT_DONE':
          chrome.runtime.sendMessage({ type: 'FSM_EVENT', event: 'INJECTED' }).catch(() => {});
          break;
      }
    });

    // ── 3. One-shot message fallback (when port isn't ready yet) ──────────────
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (msg.type === 'INJECT_PROMPT') {
        window.postMessage({ type: 'FLOW_DO_INJECT', prompt: msg.prompt }, '*');
        reply({ ok: true });
      }
    });
  },
});
