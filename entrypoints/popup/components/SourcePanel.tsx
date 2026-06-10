import { useRef, useState } from 'react';
import { ScriptData } from '../../../utils/types';
import { parseImagePromptToText } from '../../../utils/parser';
import { PromptManager, RawPrompt } from '../../../lib/PromptManager';

export type ParsedPrompt = RawPrompt;

type SourceTab = 'paste' | 'json' | 'local_api';

interface Props {
  apiSource: 'json' | 'local_api';
  localApiUrl: string;
  isRunning: boolean;
  isPaused: boolean;
  onStart: (prompts: ParsedPrompt[], projectName: string) => void;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  onSourceChange: (src: 'json' | 'local_api', url?: string) => void;
  onFetchFromApi: (url: string) => void;
}

export function SourcePanel({
  apiSource,
  localApiUrl,
  isRunning,
  isPaused,
  onStart,
  onPause,
  onResume,
  onClear,
  onSourceChange,
  onFetchFromApi,
}: Props) {
  const [tab, setTab] = useState<SourceTab>('paste');
  const [projectName, setProjectName] = useState('Campaign');
  const [parsedScenes, setParsedScenes] = useState<ParsedPrompt[]>([]);
  const [fileName, setFileName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [pasteCount, setPasteCount] = useState(0);
  const [apiUrl, setApiUrl] = useState(localApiUrl);
  const [error, setError] = useState('');

  const fileRef = useRef<HTMLInputElement>(null);
  const managerRef = useRef(new PromptManager());

  function handleTabChange(t: SourceTab) {
    setTab(t);
    setParsedScenes([]);
    setError('');
    if (t === 'json') onSourceChange('json');
    else if (t === 'local_api') onSourceChange('local_api');
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const json = JSON.parse(ev.target?.result as string) as ScriptData;
        if (!Array.isArray(json.scenes)) throw new Error('Missing "scenes" array');
        setParsedScenes(
          json.scenes.map((s) => ({
            scene_number: s.scene_number,
            prompt: parseImagePromptToText(s.image_prompt),
          })),
        );
        setError('');
      } catch (err) {
        setError(`Parse error: ${err}`);
        setParsedScenes([]);
      }
    };
    reader.readAsText(file);
  }

  function handlePasteChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    setPasteText(text);
    setError('');
    if (!text.trim()) {
      setPasteCount(0);
      return;
    }
    try {
      const count = managerRef.current.loadFromText(text);
      setPasteCount(count);
    } catch {
      setPasteCount(0);
      setError('Could not parse input — try JSON or plain text (one prompt per line).');
    }
  }

  function handleStart() {
    setError('');
    if (tab === 'paste') {
      if (pasteCount === 0) { setError('Paste at least one prompt.'); return; }
      const prompts = managerRef.current.getAll();
      managerRef.current.clear();
      setPasteText('');
      setPasteCount(0);
      onStart(prompts, projectName);
    } else if (tab === 'json') {
      if (!parsedScenes.length) { setError('Load a JSON file first.'); return; }
      onStart(parsedScenes, projectName);
      setParsedScenes([]);
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
    } else {
      onFetchFromApi(apiUrl.replace(/^ws/, 'http'));
    }
  }

  const canStart =
    (!isRunning || isPaused) &&
    (tab === 'paste' ? pasteCount > 0 : tab === 'json' ? parsedScenes.length > 0 : true);

  const TABS: { key: SourceTab; label: string }[] = [
    { key: 'paste', label: 'Paste' },
    { key: 'json',  label: 'JSON File' },
    { key: 'local_api', label: 'Local API' },
  ];

  return (
    <div className="space-y-3">
      {/* Project name */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-400 shrink-0">Project</label>
        <input
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="Campaign name"
          className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-violet-500"
        />
      </div>

      {/* Source tabs */}
      <div className="flex rounded-md overflow-hidden border border-slate-600 text-xs">
        {TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => handleTabChange(key)}
            className={`flex-1 py-1.5 font-medium transition-colors ${
              tab === key
                ? 'bg-violet-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Paste tab — large textarea */}
      {tab === 'paste' && (
        <div className="space-y-1.5">
          <textarea
            value={pasteText}
            onChange={handlePasteChange}
            placeholder={[
              'Paste prompts here. Accepted formats:',
              '',
              '• Plain text — one prompt per line',
              '• JSON array  — ["prompt 1", "prompt 2"]',
              '• Scenes JSON — {"scenes": [...]}',
              '• RawPrompt[] — [{"scene_number":1,"prompt":"..."}]',
            ].join('\n')}
            rows={10}
            spellCheck={false}
            className={[
              'w-full resize-y bg-slate-900 border rounded px-3 py-2.5',
              'text-[11px] text-slate-200 font-mono leading-relaxed',
              'placeholder:text-slate-600 focus:outline-none transition-colors',
              pasteCount > 0
                ? 'border-emerald-600 focus:border-emerald-400'
                : 'border-slate-600 focus:border-violet-500',
            ].join(' ')}
          />
          {pasteCount > 0 && (
            <p className="text-[11px] text-emerald-400">
              ✓ {pasteCount} prompt{pasteCount !== 1 ? 's' : ''} ready
            </p>
          )}
        </div>
      )}

      {/* JSON file tab */}
      {tab === 'json' && (
        <div className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept=".json"
            onChange={handleFile}
            className="w-full text-[11px] text-slate-400 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-violet-600 file:text-white hover:file:bg-violet-500 cursor-pointer"
          />
          {fileName && parsedScenes.length > 0 && (
            <p className="text-[11px] text-emerald-400">
              ✓ {fileName} &middot; {parsedScenes.length} scenes
            </p>
          )}
        </div>
      )}

      {/* Local API tab */}
      {tab === 'local_api' && (
        <div className="space-y-1.5">
          <input
            value={apiUrl}
            onChange={(e) => {
              setApiUrl(e.target.value);
              onSourceChange('local_api', e.target.value);
            }}
            placeholder="ws://localhost:8000/ws/prompts"
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-violet-500"
          />
          <p className="text-[10px] text-slate-500">
            Expects JSON: <code>{'{"scenes": [...]}'}</code> or array of prompts
          </p>
        </div>
      )}

      {error && <p className="text-[11px] text-red-400">{error}</p>}

      {/* Action buttons */}
      <div className="flex gap-2">
        {!isRunning || isPaused ? (
          <button
            onClick={isPaused ? onResume : handleStart}
            disabled={!canStart}
            className="flex-1 bg-violet-600 hover:bg-violet-500 disabled:bg-slate-700 disabled:text-slate-500 text-white disabled:cursor-not-allowed py-2 rounded-md text-xs font-semibold transition-colors"
          >
            {isPaused ? '▶ Resume' : '▶ Start Generation'}
          </button>
        ) : (
          <button
            onClick={onPause}
            className="flex-1 bg-amber-600 hover:bg-amber-500 text-white py-2 rounded-md text-xs font-semibold transition-colors"
          >
            ⏸ Pause
          </button>
        )}
        <button
          onClick={onClear}
          className="px-3 py-2 rounded-md text-xs font-semibold border border-red-800 text-red-400 hover:bg-red-900/30 transition-colors"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
