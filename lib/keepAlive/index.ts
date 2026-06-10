/**
 * MV3 Service Worker Keep-Alive
 *
 * Chrome aggressively terminates Service Workers after ~30s of inactivity.
 * This module uses two complementary strategies:
 *
 * Strategy 1 — chrome.alarms (background side):
 *   Fires every 20s. Accessing storage is enough to keep the SW awake.
 *   Also re-triggers the queue if the SW was resurrected after a kill.
 *
 * Strategy 2 — Persistent port (content script side):
 *   The content script opens a long-lived chrome.runtime.Port to the SW.
 *   An open port prevents Chrome from terminating the SW while the page is open.
 *   On disconnect (SW killed), the content script auto-reconnects, waking it up.
 */

export const ALARM_NAME = 'flow-ai-keepalive';
export const PORT_NAME  = 'flow-ai-keepalive';
export const ALARM_PERIOD_MIN = 0.33; // ~20 seconds — below the 30s kill threshold

// ─── Background side ─────────────────────────────────────────────────────────

/** Call once inside defineBackground() to register the alarm. */
export function registerAlarm(): void {
  chrome.alarms.get(ALARM_NAME, (existing) => {
    if (!existing) {
      chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MIN });
    }
  });
}

/** Call in chrome.alarms.onAlarm listener. Returns true if it was our alarm. */
export function handleAlarm(
  alarm: chrome.alarms.Alarm,
  onWakeUp: () => void,
): boolean {
  if (alarm.name !== ALARM_NAME) return false;
  // Accessing storage is sufficient to keep / wake the SW
  chrome.storage.local.get('_keepalive_ping', () => onWakeUp());
  return true;
}

/** Track open ports from content scripts. Keeping them open prevents SW kills. */
export class PortRegistry {
  private ports = new Map<number, chrome.runtime.Port>();

  register(port: chrome.runtime.Port): void {
    const tabId = port.sender?.tab?.id;
    if (tabId == null) return;

    this.ports.set(tabId, port);
    port.onDisconnect.addListener(() => this.ports.delete(tabId));
  }

  /** Send a message to a specific tab's content script via its port. */
  postTo(tabId: number, msg: object): boolean {
    const port = this.ports.get(tabId);
    if (!port) return false;
    try { port.postMessage(msg); return true; }
    catch { this.ports.delete(tabId); return false; }
  }

  has(tabId: number): boolean {
    return this.ports.has(tabId);
  }
}

// ─── Content script side ─────────────────────────────────────────────────────

/** Call once in the content script to maintain a persistent port to the SW. */
export function maintainPort(
  onMessage: (msg: Record<string, unknown>) => void,
): void {
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  function connect(): void {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: PORT_NAME });
    } catch {
      setTimeout(connect, 2_000);
      return;
    }

    if (heartbeat) clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      try { port.postMessage({ type: 'HEARTBEAT', ts: Date.now() }); }
      catch { if (heartbeat) clearInterval(heartbeat); connect(); }
    }, 20_000);

    port.onMessage.addListener(onMessage);

    port.onDisconnect.addListener(() => {
      if (heartbeat) clearInterval(heartbeat);
      // Short delay before reconnecting — give the SW time to restart
      setTimeout(connect, 1_500);
    });
  }

  connect();
}
