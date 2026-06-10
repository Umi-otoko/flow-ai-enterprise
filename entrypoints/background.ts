import { browser } from 'wxt/browser';
import { ExtensionState, QueueItem, GeneratedImage } from '../utils/types';
import { QueueStore, DEFAULT_STATE } from '../lib/store/QueueStore';
import { BackoffManager } from '../lib/automation/BackoffManager';
import { SemanticNamer } from '../lib/naming/SemanticNamer';

const MAX_CONCURRENT = 3;
const IMAGES_PER_SCENE = 2;
const POST_INJECT_DELAY_MS = 2_000;

// Runtime state — also persisted to chrome.storage after every mutation
let state: ExtensionState = { ...DEFAULT_STATE };
const backoff = new BackoffManager();

// Download dedup guards
const downloadedIds = new Set<string>();
// mediaId (UUID from URL) → { sceneNumber, imageIndex }
const mediaMap = new Map<string, { sceneNumber: number; imageIndex: number }>();

let isInjecting = false;
let rateLimitTimer: ReturnType<typeof setTimeout> | null = null;
let isInitialized = false;

// ─── Entry point ──────────────────────────────────────────────────────────────

export default defineBackground(async () => {
  console.log('[FLOW] Background orchestrator v2 started');

  // Register the MAIN-world injector (WXT doesn't auto-register non-matches-based scripts)
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
    }]).catch((e) => console.error('[INJECTOR] update failed:', e));
  });

  // Restore persisted state (fault tolerance on reload/crash)
  const saved = await QueueStore.load();
  state = { ...saved, isRunning: false, isPaused: false }; // never auto-resume

  // Re-hydrate download guard from gallery
  for (const img of state.gallery) downloadedIds.add(img.id);

  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handleMessage(msg, sendResponse);
    return true; // keep async channel open
  });
});

// ─── Message router ───────────────────────────────────────────────────────────

function handleMessage(msg: any, reply: (r: any) => void) {
  switch (msg.type as string) {
    case 'GET_STATE':
      reply({ state });
      break;

    case 'START_QUEUE': {
      const { prompts, tabId, projectName } = msg.payload as {
        prompts: { scene_number: number; prompt: string }[];
        tabId: number;
        projectName?: string;
      };

      state.activeTabId = tabId;
      state.isRunning = true;
      state.isPaused = false;
      if (projectName) state.projectName = projectName;

      const newItems: QueueItem[] = prompts.map((p) => ({
        id: crypto.randomUUID(),
        scene_number: p.scene_number,
        prompt: p.prompt,
        status: 'PENDING',
        retryCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));

      state.queue = [...state.queue, ...newItems];
      log('info', `Queue loaded: ${newItems.length} scene(s) added`);
      persistAndBroadcast();
      initAndProcess(tabId);
      reply({ success: true });
      break;
    }

    case 'PAUSE_QUEUE':
      state.isRunning = false;
      state.isPaused = true;
      log('info', 'Queue paused by user');
      persistAndBroadcast();
      reply({ success: true });
      break;

    case 'RESUME_QUEUE':
      state.isRunning = true;
      state.isPaused = false;
      log('info', 'Queue resumed by user');
      persistAndBroadcast();
      processQueue();
      reply({ success: true });
      break;

    case 'CLEAR_QUEUE':
      state = {
        ...DEFAULT_STATE,
        apiSource: state.apiSource,
        localApiUrl: state.localApiUrl,
        projectName: state.projectName,
      };
      mediaMap.clear();
      downloadedIds.clear();
      backoff.reset();
      if (rateLimitTimer) { clearTimeout(rateLimitTimer); rateLimitTimer = null; }
      isInitialized = false;
      isInjecting = false;
      QueueStore.clear().catch(() => {});
      broadcastState();
      reply({ success: true });
      break;

    case 'BATCH_DETECTED':
      handleBatchDetected(msg.payload);
      break;

    case 'IMAGE_TILE_APPEARED':
      handleTileAppeared(msg.payload as { tileId: string; src: string });
      break;

    case 'RATE_LIMIT_DETECTED':
      handleRateLimit();
      break;

    default:
      reply({ error: 'Unknown message type' });
  }
}

// ─── tRPC batch response handler ─────────────────────────────────────────────

function handleBatchDetected(raw: unknown) {
  try {
    const data = unwrapTrpc(raw) as any;
    const workflows: any[] = data?.workflows ?? [];
    const mediaItems: any[] = data?.media ?? [];

    for (const workflow of workflows) {
      const workflowId: string = workflow?.name ?? '';
      const batchId: string | undefined = workflow?.metadata?.batchId;
      if (!batchId) continue;

      const batchMedia = mediaItems.filter(
        (m) =>
          m?.image?.generatedImage?.workflowId === workflowId ||
          m?.workflowId === workflowId,
      );

      const promptFromResponse: string | undefined =
        batchMedia[0]?.image?.generatedImage?.requestData?.promptInputs?.[0]?.textInput ??
        workflow?.metadata?.displayName;

      const target = promptFromResponse
        ? state.queue.find(
            (q) => q.status === 'IN_PROGRESS' && q.prompt === promptFromResponse,
          )
        : undefined;

      if (!target) continue;

      const alreadyMapped = [...mediaMap.values()].filter(
        (v) => v.sceneNumber === target.scene_number,
      ).length;

      batchMedia.forEach((m: any, idx: number) => {
        const mediaId: string | undefined =
          m?.image?.generatedImage?.mediaId ?? m?.name;
        if (mediaId && !mediaMap.has(mediaId)) {
          mediaMap.set(mediaId, {
            sceneNumber: target.scene_number,
            imageIndex: alreadyMapped + idx + 1,
          });
        }
      });
    }
  } catch (e) {
    console.error('[BATCH] parse error', e);
  }
}

// ─── Reactive tile handler (replaces setInterval polling) ────────────────────

function handleTileAppeared({ tileId, src }: { tileId: string; src: string }) {
  if (downloadedIds.has(tileId)) return;

  const uuidFromUrl =
    src.match(/[?&]name=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1];

  if (uuidFromUrl && downloadedIds.has(uuidFromUrl)) return;

  const mapping = uuidFromUrl ? mediaMap.get(uuidFromUrl) : undefined;
  if (!mapping) return; // batch response not yet processed — will re-fire if tile reappears

  const sceneItem = state.queue.find(
    (q) => q.scene_number === mapping.sceneNumber && q.status === 'IN_PROGRESS',
  );
  if (!sceneItem) return;

  // Mark as downloading immediately to prevent duplicate triggers
  downloadedIds.add(tileId);
  if (uuidFromUrl) downloadedIds.add(uuidFromUrl);

  const filename = SemanticNamer.buildFilename(
    state.projectName,
    mapping.sceneNumber,
    sceneItem.prompt,
    mapping.imageIndex,
  );

  browser.downloads
    .download({ url: src, filename, saveAs: false })
    .then(() => {
      const img: GeneratedImage = {
        id: uuidFromUrl ?? tileId,
        sceneNumber: mapping.sceneNumber,
        imageIndex: mapping.imageIndex,
        url: src,
        filename,
        downloadedAt: Date.now(),
      };
      state.gallery = [...state.gallery.slice(-59), img];
      QueueStore.pushGalleryImage(img).catch(() => {});
      log('info', `Downloaded: ${filename}`);
      checkSceneComplete(mapping.sceneNumber, sceneItem);
    })
    .catch((err) => {
      log('error', `Download failed for scene ${mapping.sceneNumber}: ${err}`);
      downloadedIds.delete(tileId);
      if (uuidFromUrl) downloadedIds.delete(uuidFromUrl);
    });
}

function checkSceneComplete(sceneNumber: number, sceneItem: QueueItem) {
  const sceneMediaIds = [...mediaMap.entries()]
    .filter(([, v]) => v.sceneNumber === sceneNumber)
    .map(([k]) => k);

  const allDone =
    sceneMediaIds.length >= IMAGES_PER_SCENE &&
    sceneMediaIds.every((mid) => downloadedIds.has(mid));

  if (allDone) {
    sceneItem.status = 'DOWNLOADED';
    sceneItem.updatedAt = Date.now();
    backoff.reset();
    persistAndBroadcast();
    processQueue(); // immediately pull next pending item
  }
}

// ─── Exponential backoff rate-limit handler ───────────────────────────────────

function handleRateLimit() {
  const delay = backoff.nextDelay();
  const attempt = backoff.getAttempt();
  const readableDelay = delay >= 60_000 ? `${Math.round(delay / 60_000)}m` : `${Math.round(delay / 1000)}s`;

  log('warn', `Rate limited (attempt ${attempt}) — cooling down ${readableDelay}`);

  state.queue.forEach((q) => {
    if (q.status === 'IN_PROGRESS') {
      q.status = 'RATE_LIMITED';
      q.retryCount += 1;
      q.updatedAt = Date.now();
      q.errorMessage = `Rate limited — retry #${q.retryCount} in ${readableDelay}`;
    }
  });

  state.nextRetryAt = Date.now() + delay;
  state.backoffAttempt = attempt;

  if (rateLimitTimer) clearTimeout(rateLimitTimer);
  rateLimitTimer = setTimeout(() => {
    state.queue.forEach((q) => {
      if (q.status === 'RATE_LIMITED') {
        q.status = 'PENDING';
        q.updatedAt = Date.now();
        delete q.errorMessage;
      }
    });
    state.nextRetryAt = 0;
    log('info', 'Cooldown complete — resuming queue');
    persistAndBroadcast();
    processQueue();
  }, delay);

  persistAndBroadcast();
}

// ─── Queue processing ─────────────────────────────────────────────────────────

async function initAndProcess(tabId: number) {
  if (!isInitialized) {
    isInitialized = true;
    try {
      const [{ result: existingIds }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () =>
          Array.from(document.querySelectorAll('[data-tile-id]'))
            .filter((t) => {
              const img = t.querySelector('img') as HTMLImageElement;
              return img?.src && !img.src.startsWith('data:');
            })
            .map((el) => el.getAttribute('data-tile-id')),
      });
      (existingIds ?? []).forEach((id: string | null) => {
        if (id) downloadedIds.add(id);
      });
    } catch (e) {
      log('error', `Init scan failed: ${e}`);
    }
  }
  processQueue();
}

async function processQueue() {
  if (!state.isRunning || state.isPaused || isInjecting || !state.activeTabId) return;

  const inProgress = state.queue.filter((q) => q.status === 'IN_PROGRESS').length;
  if (inProgress >= MAX_CONCURRENT) return;

  const next = state.queue.find((q) => q.status === 'PENDING');
  if (!next) return;

  isInjecting = true;
  next.status = 'IN_PROGRESS';
  next.updatedAt = Date.now();
  persistAndBroadcast();

  try {
    await injectPrompt(state.activeTabId, next.prompt);
    await sleep(POST_INJECT_DELAY_MS);
  } catch (e) {
    log('error', `Injection failed for scene ${next.scene_number}: ${e}`);
    next.status = 'ERROR';
    next.errorMessage = String(e);
    next.updatedAt = Date.now();
    persistAndBroadcast();
  } finally {
    isInjecting = false;
  }
}

// ─── DOM injection (runs in MAIN world of target tab) ─────────────────────────

async function injectPrompt(tabId: number, promptText: string): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (text: string) => {
      const editor = document.querySelector<HTMLElement>('[data-slate-editor="true"]');
      if (!editor) throw new Error('[FLOW] Slate editor not found');

      editor.focus();

      const leaf = editor.querySelector('[data-slate-leaf="true"]') ?? editor;
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(leaf);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);

      const beforeInput = new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: text,
        bubbles: true,
        cancelable: true,
      }) as any;
      beforeInput.getTargetRanges = () => [range];
      editor.dispatchEvent(beforeInput);

      if (!beforeInput.defaultPrevented) {
        document.execCommand('insertText', false, text);
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      }

      setTimeout(() => {
        const sendBtn = Array.from(document.querySelectorAll('button')).find((b) => {
          const icon = b.querySelector('i.google-symbols');
          return icon?.textContent?.trim() === 'arrow_forward';
        });

        if (sendBtn) {
          sendBtn.removeAttribute('disabled');
          sendBtn.removeAttribute('aria-disabled');
          (sendBtn as HTMLElement).style.pointerEvents = 'auto';
          sendBtn.click();

          const rKey = Object.keys(sendBtn).find((k) => k.startsWith('__reactProps$'));
          if (rKey) {
            const rProps = (sendBtn as any)[rKey];
            if (typeof rProps?.onClick === 'function') {
              try { rProps.onClick({ preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { isTrusted: true } }); } catch {}
            }
          }
        }

        editor.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }),
        );

        const eKey = Object.keys(editor).find((k) => k.startsWith('__reactProps$'));
        if (eKey) {
          const eProps = (editor as any)[eKey];
          if (typeof eProps?.onKeyDown === 'function') {
            try { eProps.onKeyDown({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13, preventDefault: () => {}, stopPropagation: () => {}, nativeEvent: { isTrusted: true } }); } catch {}
          }
        }
      }, 800);
    },
    args: [promptText],
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function unwrapTrpc(raw: unknown): unknown {
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const inner = (item as any)?.result?.data?.json ?? (item as any)?.result?.data;
      if ((inner as any)?.workflows || (inner as any)?.media) return inner;
    }
  }
  const r = raw as any;
  if (r?.result?.data?.json?.workflows || r?.result?.data?.json?.media) return r.result.data.json;
  if (r?.result?.data?.workflows || r?.result?.data?.media) return r.result.data;
  return raw;
}

function log(level: 'info' | 'warn' | 'error', message: string) {
  const entry = { id: crypto.randomUUID(), level, message, timestamp: Date.now() };
  state.logs = [...state.logs.slice(-99), entry];
  QueueStore.pushLog({ level, message }).catch(() => {});
  console[level](`[FLOW] ${message}`);
}

function persistAndBroadcast() {
  QueueStore.save({
    queue: state.queue,
    gallery: state.gallery,
    logs: state.logs,
    isRunning: state.isRunning,
    isPaused: state.isPaused,
    projectName: state.projectName,
    backoffAttempt: state.backoffAttempt,
    nextRetryAt: state.nextRetryAt,
  }).catch(() => {});
  broadcastState();
}

function broadcastState() {
  browser.runtime.sendMessage({ type: 'STATE_UPDATED', payload: state }).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
