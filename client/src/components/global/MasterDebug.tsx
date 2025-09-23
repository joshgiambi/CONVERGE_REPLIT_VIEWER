import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface MasterDebugProps {
  placement?: 'top-right' | 'bottom-right';
}

export default function MasterDebug({ placement = 'top-right' }: MasterDebugProps) {
  const [open, setOpen] = useState(false);
  const [testText, setTestText] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const storageKey = 'master-debug-tests';

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) setTestText(saved);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, testText);
    } catch {}
  }, [testText]);

  const runTests = useCallback(async () => {
    if (!testText.trim()) {
      setStatus('Enter a test to run.');
      return;
    }
    setBusy(true);
    setStatus('Running…');
    try {
      const payload = { text: testText, ts: Date.now(), agent: 'master-debug' };
      let resp: Response | null = null;
      try {
        resp = await fetch('/api/agents/tests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {}
      if (resp && resp.ok) {
        const j = await resp.json().catch(() => ({}));
        setStatus(j?.message || 'Completed.');
      } else {
        // Fallback: emit a window event for agents listening
        try {
          const evt = new CustomEvent('agents:run-tests', { detail: payload });
          window.dispatchEvent(evt);
          setStatus('Dispatched to agents.');
        } catch {
          setStatus('Dispatched.');
        }
      }
    } catch (e: any) {
      setStatus(e?.message || 'Failed.');
    } finally {
      setBusy(false);
    }
  }, [testText]);

  const posClass = placement === 'bottom-right'
    ? 'bottom-4 right-4'
    : 'top-4 right-4';

  return (
    <div className={`fixed ${posClass} z-[1000]`}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Debug"
        className="rounded-full bg-slate-900/90 border border-slate-700 text-slate-200 shadow-md shadow-black/40 hover:bg-slate-800 px-3 py-2 text-xs"
      >
        Debug
      </button>

      {open && (
        <div className="mt-2 w-[320px] max-h-[70vh] overflow-auto rounded-lg border border-slate-700 bg-slate-950/95 p-3 text-[12px] text-slate-200 shadow-xl shadow-black/50 backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold">Master Debug</div>
            <button
              className="text-slate-400 hover:text-slate-200"
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>
          <div className="mb-2 text-slate-400">
            Agents can paste tests or commands here. They will be sent to `/api/agents/tests` if available, otherwise broadcast as `agents:run-tests` event.
          </div>
          <textarea
            className="w-full h-40 rounded border border-slate-700 bg-black/60 p-2 text-slate-200 outline-none focus:border-slate-500"
            value={testText}
            onChange={(e) => setTestText(e.target.value)}
            placeholder="Describe the test or paste instructions…"
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              disabled={busy}
              onClick={runTests}
              className="rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 px-3 py-1.5 text-xs text-white"
            >
              {busy ? 'Running…' : 'Run'}
            </button>
            <div className="text-[11px] text-slate-400">{status}</div>
          </div>
        </div>
      )}
    </div>
  );
}

