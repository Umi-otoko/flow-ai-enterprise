/**
 * Background Service Worker — "The Brain"
 *
 * Responsibilities (and ONLY these):
 *   1. Persist and serve ExtensionState (chrome.storage.local)
 *   2. Orchestrate the queue: decide which scene to process next, send
 *      INJECT_PROMPT commands to the content script via the keepalive port
 *   3. Execute chrome.downloads (content scripts can't trigger downloads)
 *   4. Manage exponential backoff for rate limits
 *   5. Stay alive via chrome.alarms + long-lived port connections
 *
 * It does NOT touch the DOM. All DOM operations happen in content.ts.
 */

import { browser } from 'wxt/browser';
import { ExtensionState, QueueItem, GeneratedImage, BotEvent } from '../utils/types';
import { QueueStore, DEFAULT_STATE, idbPushGallery, idbPushLog } from '../lib/store/QueueStore';
import { BackoffManager } from '../lib/automation/BackoffManager';
import { SemanticNamer } from '../lib/naming/SemanticNamer';
import { transition } from '../lib/stateMachine/index';
import {
  registerAlarm,
  handleAlarm,
  PortRegistry,
  ALARM_NAME,
  PORT_NAME,
} from '../lib/keepAlive/index';

const IMAGES_PER_SCENE = 2;

// ─── Runtime singletons ───────────────────────────────────────────────────────

let state: ExtensionState = { ...DEFAULT_STATE };
const backoff   = new BackoffManager();
const ports     = new PortRegistry();
const downloadedIds = new Set<string>();
const mediaMap  = new Map<string, { sceneNumber: number; imageIndex: number }>();
let cooldownTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Entry point ──────────────────────────────────────────────────────────────

export default defineBackground(async () => {
  console.log('[FLOW BG] Service Worker started');

  // 1 — Register keep-alive alarm (fires every ~20s)
  registerAlarm();

  // 2 — Register the MAIN-world injector script
  chrome.scripting.registerContentScripts([{
    id: 'flow-injector',
    matches: ['*://*.google.com/*', '*://labs.google/*'],
    js: ['injector.js'],
    world: 'MAIN',
    runAt: 'document_start',
  }]).catch(() => {
    chrome.scripting.updateContentScripts([{
      id: 'flow-injector',
      matches: ['*://*.google.com/*', '*://labs.google/*'],
      js: ['injector.js'],
      world: 'MAIN',
      runAt: 'document_start',
    }]).catch((e) => console.error('[FLOW BG] Injector update failed:', e));
  });

  // 3 — Restore persisted state (crash / SW-kill recovery)
  state = await QueueStore.load();
  state.isRunning = false; // never auto-resume on SW restart — require explicit user action
  state.botState  = 'IDLE';
  for (const img of state.gallery) downloadedIds.add(img.id);

  // 4 — Alarm handler: keeps SW alive + re-triggers queue on resurrection
  chrome.alarms.onAlarm.addListener((alarm) => {
    handleAlarm(alarm, () => {
      if (state.isRunning && !state.isPaused) tryProcessNext();
    });
  });

  // 5 — Long-lived port connections (second keep-alive strategy)
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== PORT_NAME) return;
    ports.register(port);

    port.onMessage.addListener((msg: Record<string, unknown>) => {
      switch (msg['type']) {
        case 'HEARTBEAT': break; // keeping SW alive via active port
        case 'FSM_EVENT': applyEvent(msg['event'] as BotEvent, msg['payload']); break;
      }
    });
  });

  // 6 — Standard one-shot messages (from popup and content script)
  browser.runtime.onMessage.addListener((msg, _sender, reply) => {
    handleMessage(msg as Record<string, unknown>, reply as (r: unknown) => void);
    return true;
  });
});

// ─── Message router ───────────────────────────────────────────────────────────

function handleMessage(msg: Record<string, unknown>, reply: (r: unknown) => void) {
  switch (msg['type'] as string) {

    case 'GET_STATE':
      reply({ state });
      break;

    case 'START_QUEUE': {
      const { prompts, tabId, projectName } = msg['payload'] as { prompts: { scene_number: number; prompt: string }[]; tabId: number; projectName?: string };
      state.activeTabId = tabId;
      state.isRunning   = true;
      state.isPaused    = false;
      if (projectName) state.projectName = projectName;

      const newItems: QueueItem[] = prompts.map((p: { scene_number: number; prompt: string }) => ({
        id:           crypto.randomUUID(),
        scene_number: p.scene_number,
        prompt:       p.prompt,
        status:       'PENDING',
        retryCount:   0,
        createdAt:    Date.now(),
        updatedAt:    Date.now(),
      }));

      state.queue = [...state.queue, ...newItems];
      log('info', `Queue loaded: ${newItems.length} scene(s) added`);
      persistAndBroadcast();
      tryProcessNext();
      reply({ success: true });
      break;
    }

    case 'PAUSE_QUEUE':
      state.isRunning = false;
      state.isPaused  = true;
      applyEvent('PAUSE');
      reply({ success: true });
      break;

    case 'RESUME_QUEUE':
      state.isRunning = true;
      state.isPaused  = false;
      applyEvent('RESUME');
      tryProcessNext();
      reply({ success: true });
      break;

    case 'CLEAR_QUEUE':
      state = {
        ...DEFAULT_STATE,
        apiSource:  state.apiSource,
        localApiUrl: state.localApiUrl,
        projectName: state.projectName,
      };
      mediaMap.clear();
      downloadedIds.clear();
      backoff.reset();
      if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = null; }
      QueueStore.clear().catch(() => {});
      broadcastState();
      reply({ success: true });
      break;

    // From content script bridge (originally from injector MAIN world)
    case 'BATCH_DETECTED':
      handleBatch(msg.payload);
      break;

    case 'IMAGE_TILE_APPEARED':
      handleTile(msg.payload as { tileId: string; src: string });
      break;

    case 'RATE_LIMIT_DETECTED':
      applyEvent('RATE_LIMIT');
      handleRateLimit();
      break;

    default:
      reply({ error: 'Unknown message type' });
  }
}

// ─── FSM ─────────────────────────────────────────────────────────────────────

function applyEvent(event: BotEvent, payload?: unknown): void {
  const next = transition(state.botState, event);
  if (next === state.botState) return;
  console.log(`[FLOW FSM] ${state.botState} --${event}--> ${next}`);
  state.botState = next;
  persistAndBroadcast();
}

// ─── Queue orchestration ─────────────────────────────────────────────────────

function tryProcessNext(): void {
  if (!state.isRunning || state.isPaused) return;
  if (state.botState !== 'IDLE') return; // Already busy
  if (!state.activeTabId) return;

  const next = state.queue.find((q) => q.status === 'PENDING');
  if (!next) return;

  next.status   = 'IN_PROGRESS';
  next.updatedAt = Date.now();
  state.activeSceneId = next.id;
  applyEvent('START');

  // Command the content script to inject the prompt via the keepalive port
  const sent = ports.postTo(state.activeTabId, {
    type:   'INJECT_PROMPT',
    prompt: next.prompt,
    sceneId: next.id,
  });

  if (!sent) {
    // Port not ready yet — try via tabs.sendMessage as fallback
    chrome.tabs.sendMessage(state.activeTabId, {
      type:   'INJECT_PROMPT',
      prompt: next.prompt,
      sceneId: next.id,
    }).catch((e) => {
      log('error', `Could not reach content script: ${e}`);
      next.status = 'ERROR';
      next.errorMessage = 'Content script unreachable';
      state.activeSceneId = null;
      applyEvent('FATAL_ERROR');
    });
  }
}

// ─── Batch / media mapping ────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tRPC response shape is unknown at compile time

function handleBatch(raw: unknown): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = unwrapTrpc(raw) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const workflows: any[] = data?.workflows ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mediaItems: any[] = data?.media ?? [];

  for (const wf of workflows) {
    const wfId   = wf?.name ?? '';
    const batchId: string | undefined = wf?.metadata?.batchId;
    if (!batchId) continue;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const batchMedia = mediaItems.filter(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) => m?.image?.generatedImage?.workflowId === wfId || m?.workflowId === wfId,
    );

    const promptFromResponse: string | undefined =
      batchMedia[0]?.image?.generatedImage?.requestData?.promptInputs?.[0]?.textInput ??
      wf?.metadata?.displayName;

    const target = promptFromResponse
      ? state.queue.find((q) => q.status === 'IN_PROGRESS' && q.prompt === promptFromResponse)
      : undefined;

    if (!target) continue;

    const alreadyMapped = [...mediaMap.values()].filter(
      (v) => v.sceneNumber === target.scene_number,
    ).length;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batchMedia.forEach((m: any, idx: number) => {
      const mediaId: string | undefined = m?.image?.generatedImage?.mediaId ?? m?.name;
      if (mediaId && !mediaMap.has(mediaId)) {
        mediaMap.set(mediaId, { sceneNumber: target.scene_number, imageIndex: alreadyMapped + idx + 1 });
      }
    });
  }
}

// ─── Tile → download ─────────────────────────────────────────────────────────

function handleTile({ tileId, src }: { tileId: string; src: string }): void {
  if (downloadedIds.has(tileId)) return;

  const uuid = src.match(/[?&]name=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];
  if (uuid && downloadedIds.has(uuid)) return;

  const mapping = uuid ? mediaMap.get(uuid) : undefined;
  if (!mapping) return;

  const sceneItem = state.queue.find(
    (q) => q.scene_number === mapping.sceneNumber && q.status === 'IN_PROGRESS',
  );
  if (!sceneItem) return;

  downloadedIds.add(tileId);
  if (uuid) downloadedIds.add(uuid);

  const filename = SemanticNamer.buildFilename(
    state.projectName,
    mapping.sceneNumber,
    sceneItem.prompt,
    mapping.imageIndex,
  );

  applyEvent('ALL_IMAGES_READY');

  browser.downloads.download({ url: src, filename, saveAs: false })
    .then(() => {
      const img: GeneratedImage = {
        id: uuid ?? tileId,
        sceneNumber:  mapping.sceneNumber,
        imageIndex:   mapping.imageIndex,
        url:          src,
        filename,
        downloadedAt: Date.now(),
      };
      state.gallery = [...state.gallery.slice(-59), img];
      idbPushGallery(img).catch(() => {});
      log('info', `↓ ${filename}`);
      checkSceneDone(mapping.sceneNumber, sceneItem);
    })
    .catch((err) => {
      log('error', `Download failed for scene ${mapping.sceneNumber}: ${err}`);
      downloadedIds.delete(tileId);
      if (uuid) downloadedIds.delete(uuid);
    });
}

function checkSceneDone(sceneNumber: number, sceneItem: QueueItem): void {
  const sceneMediaIds = [...mediaMap.entries()]
    .filter(([, v]) => v.sceneNumber === sceneNumber)
    .map(([k]) => k);

  if (sceneMediaIds.length >= IMAGES_PER_SCENE && sceneMediaIds.every((id) => downloadedIds.has(id))) {
    sceneItem.status   = 'DOWNLOADED';
    sceneItem.updatedAt = Date.now();
    state.activeSceneId = null;
    backoff.reset();
    applyEvent('DOWNLOAD_COMPLETE');
    persistAndBroadcast();
    tryProcessNext();
  }
}

// ─── Rate limit + backoff ─────────────────────────────────────────────────────

function handleRateLimit(): void {
  const delay = backoff.nextDelay();
  const label = delay >= 60_000 ? `${Math.round(delay / 60_000)}m` : `${Math.round(delay / 1000)}s`;

  log('warn', `Rate limited (attempt ${backoff.getAttempt()}) — cooldown ${label}`);

  state.queue.forEach((q) => {
    if (q.status === 'IN_PROGRESS') {
      q.status       = 'RATE_LIMITED';
      q.retryCount   += 1;
      q.updatedAt    = Date.now();
      q.errorMessage = `Rate limited — retry #${q.retryCount} in ${label}`;
    }
  });

  state.nextRetryAt    = Date.now() + delay;
  state.backoffAttempt = backoff.getAttempt();

  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = setTimeout(() => {
    state.queue.forEach((q) => {
      if (q.status === 'RATE_LIMITED') {
        q.status = 'PENDING';
        q.updatedAt = Date.now();
        delete q.errorMessage;
      }
    });
    state.nextRetryAt = 0;
    applyEvent('COOLDOWN_DONE');
    log('info', 'Cooldown complete — resuming');
    persistAndBroadcast();
    tryProcessNext();
  }, delay);

  persistAndBroadcast();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function unwrapTrpc(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const inner = (item as any)?.result?.data?.json ?? (item as any)?.result?.data;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((inner as any)?.workflows || (inner as any)?.media) return inner;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = raw as any;
  if (r?.result?.data?.json?.workflows || r?.result?.data?.json?.media) return r.result.data.json;
  if (r?.result?.data?.workflows || r?.result?.data?.media) return r.result.data;
  return raw;
}

function log(level: 'info' | 'warn' | 'error', message: string): void {
  const entry = { id: crypto.randomUUID(), level, message, timestamp: Date.now() };
  state.logs = [...state.logs.slice(-119), entry];
  idbPushLog({ level, message }).catch(() => {});
  console[level](`[FLOW BG] ${message}`);
}

function persistAndBroadcast(): void {
  QueueStore.save({
    botState:      state.botState,
    queue:         state.queue,
    gallery:       state.gallery,
    logs:          state.logs,
    isRunning:     state.isRunning,
    isPaused:      state.isPaused,
    activeSceneId: state.activeSceneId,
    projectName:   state.projectName,
    backoffAttempt: state.backoffAttempt,
    nextRetryAt:   state.nextRetryAt,
  }).catch(() => {});
  broadcastState();
}

function broadcastState(): void {
  browser.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state }).catch(() => {});
}
