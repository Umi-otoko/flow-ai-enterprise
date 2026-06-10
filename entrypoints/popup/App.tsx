import { useState, useEffect, useCallback } from 'react';
import { browser } from 'wxt/browser';
import { ExtensionState } from '../../utils/types';
import { DEFAULT_STATE } from '../../lib/store/QueueStore';
import { ProgressBar } from './components/ProgressBar';
import { MiniGallery } from './components/MiniGallery';
import { ErrorLog } from './components/ErrorLog';
import { QueueList } from './components/QueueList';
import { SourcePanel, ParsedPrompt } from './components/SourcePanel';
import { StateMachineIndicator } from './components/StateMachineIndicator';

export default function App() {
  const [state, setState] = useState<ExtensionState>(DEFAULT_STATE);
  const [activeTab, setActiveTab] = useState<'queue' | 'gallery' | 'log'>('queue');

  // ── Sync state from background ──────────────────────────────────────────────
  useEffect(() => {
    browser.runtime.sendMessage({ type: 'GET_STATE' }).then((res: any) => {
      if (res?.state) setState(res.state);
    });

    const listener = (msg: any) => {
      if (msg.type === 'STATE_UPDATED') setState(msg.payload as ExtensionState);
    };
    browser.runtime.onMessage.addListener(listener);
    return () => browser.runtime.onMessage.removeListener(listener);
  }, []);

  // ── Actions ─────────────────────────────────────────────────────────────────
  const handleStart = useCallback(async (prompts: ParsedPrompt[], projectName: string) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    await browser.runtime.sendMessage({
      type: 'START_QUEUE',
      payload: { prompts, tabId: tab.id, projectName },
    });
  }, []);

  const handlePause = useCallback(() => {
    browser.runtime.sendMessage({ type: 'PAUSE_QUEUE' });
  }, []);

  const handleResume = useCallback(() => {
    browser.runtime.sendMessage({ type: 'RESUME_QUEUE' });
  }, []);

  const handleClear = useCallback(() => {
    browser.runtime.sendMessage({ type: 'CLEAR_QUEUE' });
  }, []);

  const handleSourceChange = useCallback((src: 'json' | 'local_api', url?: string) => {
    setState((s) => ({ ...s, apiSource: src, ...(url ? { localApiUrl: url } : {}) }));
  }, []);

  const handleFetchFromApi = useCallback(async (httpUrl: string) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    try {
      const res = await fetch(httpUrl, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // Background normalizes payload when START_QUEUE is called — pass raw
      await browser.runtime.sendMessage({
        type: 'START_QUEUE',
        payload: { prompts: data?.scenes ? data.scenes.map((s: any) => ({
          scene_number: s.scene_number,
          prompt: `Subjects: ${s.image_prompt?.subjects?.map((x: any) => `${x.description} ${x.action}`).join(', ')}. Environment: ${s.image_prompt?.environment}. Lighting: ${s.image_prompt?.lighting}. Composition: ${s.image_prompt?.composition}. Style: ${s.image_prompt?.style}`,
        })) : data, tabId: tab.id },
      });
    } catch (e) {
      console.error('[API fetch]', e);
    }
  }, []);

  // ── Derived stats ────────────────────────────────────────────────────────────
  const total = state.queue.length;
  const downloaded = state.queue.filter((q) => q.status === 'DOWNLOADED').length;
  const inProgress = state.queue.filter((q) => q.status === 'IN_PROGRESS').length;
  const errors = state.queue.filter((q) => q.status === 'ERROR').length;
  const errorLogs = state.logs.filter((l) => l.level === 'error');

  const tabClass = (t: typeof activeTab) =>
    `flex-1 py-1.5 text-[11px] font-medium rounded transition-colors ${
      activeTab === t
        ? 'bg-slate-700 text-white'
        : 'text-slate-500 hover:text-slate-300'
    }`;

  return (
    <div className="w-[460px] min-h-screen bg-slate-900 text-slate-100 p-4 space-y-4 font-sans">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-bold text-white tracking-tight">Flow AI Generator</h1>
          <p className="text-[10px] text-slate-500 uppercase tracking-widest">Enterprise Automation</p>
        </div>
        <div className="flex items-center gap-1.5">
          {state.isRunning && !state.isPaused && (
            <span className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping inline-block" />
              Running
            </span>
          )}
          {state.isPaused && (
            <span className="text-[10px] text-amber-400 font-medium">Paused</span>
          )}
          {errors > 0 && (
            <span className="text-[10px] text-red-400 font-medium">{errors} error{errors > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {/* FSM state machine indicator — always visible */}
      <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
        <StateMachineIndicator
          state={state.botState ?? 'IDLE'}
          nextRetryAt={state.nextRetryAt}
          backoffAttempt={state.backoffAttempt}
        />
      </div>

      {/* Progress bar (only when queue active) */}
      {total > 0 && (
        <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
          <ProgressBar
            total={total}
            downloaded={downloaded}
            inProgress={inProgress}
            nextRetryAt={state.nextRetryAt}
          />
        </div>
      )}

      {/* Source / controls panel */}
      <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
        <SourcePanel
          apiSource={state.apiSource}
          localApiUrl={state.localApiUrl}
          isRunning={state.isRunning}
          isPaused={state.isPaused}
          onStart={handleStart}
          onPause={handlePause}
          onResume={handleResume}
          onClear={handleClear}
          onSourceChange={handleSourceChange}
          onFetchFromApi={handleFetchFromApi}
        />
      </div>

      {/* Tab switcher */}
      <div className="flex bg-slate-800/50 rounded-lg p-0.5 gap-0.5 border border-slate-700">
        <button className={tabClass('queue')} onClick={() => setActiveTab('queue')}>
          Queue {total > 0 && `(${total})`}
        </button>
        <button className={tabClass('gallery')} onClick={() => setActiveTab('gallery')}>
          Gallery {state.gallery.length > 0 && `(${state.gallery.length})`}
        </button>
        <button className={tabClass('log')} onClick={() => setActiveTab('log')}>
          Log {errorLogs.length > 0 && <span className="text-red-400">({errorLogs.length})</span>}
        </button>
      </div>

      {/* Tab content */}
      <div className="bg-slate-800 rounded-xl p-3 border border-slate-700">
        {activeTab === 'queue' && <QueueList queue={state.queue} />}
        {activeTab === 'gallery' && <MiniGallery images={state.gallery} />}
        {activeTab === 'log' && <ErrorLog logs={state.logs} />}
      </div>
    </div>
  );
}
