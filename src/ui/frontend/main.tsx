import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

interface Database {
  name: string;
  engine: 'postgres' | 'mysql';
  host: string;
  port: number;
  database: string;
  schedule: string;
}

interface StatusRow {
  name: string;
  engine: string;
  schedule: string;
  encrypted: boolean;
  lastDump: { path: string; mtime: string; size: number } | null;
  nextRun: string | null;
}

interface HistoryEntry {
  path: string;
  timestamp: string;
  size: number;
  sha256: string | null;
}

interface VerifyResult {
  path: string;
  shaOk: boolean;
  gunzipOk: boolean;
  pgRestoreOk: boolean | null;
  ok: boolean;
  errors: string[];
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)}MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)}GB`;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) {
    const future = -ms;
    if (future < 60_000) return 'in <1min';
    if (future < 3_600_000) return `in ${Math.round(future / 60_000)}min`;
    if (future < 86_400_000) return `in ${Math.round(future / 3_600_000)}h`;
    return `in ${Math.round(future / 86_400_000)}d`;
  }
  if (ms < 60_000) return '<1min ago';
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}min ago`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h ago`;
  return `${Math.round(ms / 86_400_000)}d ago`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // body wasn't JSON
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

function Dashboard({ onSelectDb }: { onSelectDb: (name: string) => void }) {
  const [rows, setRows] = useState<StatusRow[] | null>(null);
  const [running, setRunning] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const data = await fetchJson<StatusRow[]>('/api/status');
      setRows(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh is stable for the dashboard's lifetime
  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, []);

  const runDump = async (name: string) => {
    setRunning((prev) => ({ ...prev, [name]: true }));
    setError(null);
    setFlash(null);
    try {
      await fetchJson<{ ok: true }>(`/api/run/${encodeURIComponent(name)}`, { method: 'POST' });
      setFlash(`dump for "${name}" completed`);
      await refresh();
    } catch (err) {
      setError(`run "${name}": ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning((prev) => ({ ...prev, [name]: false }));
    }
  };

  if (rows === null) {
    return <div className="empty">Loading…</div>;
  }

  return (
    <div>
      {error && <div className="error">{error}</div>}
      {flash && <div className="success">{flash}</div>}
      {rows.length === 0 ? (
        <div className="empty">
          No databases configured. Edit your <code>dumpvault.yaml</code> and restart.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Engine</th>
              <th>Schedule</th>
              <th>Last Dump</th>
              <th>Size</th>
              <th>Next Run</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>
                  <a
                    href={`#/db/${encodeURIComponent(r.name)}`}
                    onClick={(e) => {
                      e.preventDefault();
                      onSelectDb(r.name);
                    }}
                  >
                    <strong>{r.name}</strong>
                  </a>
                  {r.encrypted && <span className="badge badge-encrypted gap-2">encrypted</span>}
                </td>
                <td>
                  <code>{r.engine}</code>
                </td>
                <td>
                  <code>{r.schedule}</code>
                </td>
                <td>
                  {r.lastDump ? (
                    <span title={r.lastDump.mtime}>{relativeTime(r.lastDump.mtime)}</span>
                  ) : (
                    <span className="badge badge-danger">never</span>
                  )}
                </td>
                <td>{r.lastDump ? humanSize(r.lastDump.size) : '—'}</td>
                <td>
                  {r.nextRun ? <span title={r.nextRun}>{relativeTime(r.nextRun)}</span> : '—'}
                </td>
                <td>
                  <button
                    type="button"
                    className="btn"
                    disabled={running[r.name]}
                    onClick={() => void runDump(r.name)}
                  >
                    {running[r.name] ? (
                      <>
                        <span className="spinner" />
                        Running…
                      </>
                    ) : (
                      'Run now'
                    )}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function DbDetail({ name, onBack }: { name: string; onBack: () => void }) {
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyResults, setVerifyResults] = useState<VerifyResult[] | null>(null);

  const refresh = async () => {
    try {
      const data = await fetchJson<HistoryEntry[]>(`/api/history/${encodeURIComponent(name)}`);
      setHistory(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh closure tracks `name` directly
  useEffect(() => {
    void refresh();
  }, [name]);

  const runVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      const data = await fetchJson<VerifyResult[]>(`/api/verify/${encodeURIComponent(name)}`, {
        method: 'POST',
      });
      setVerifyResults(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifying(false);
    }
  };

  const latestVerify = verifyResults?.[0];

  return (
    <div>
      <div className="title-row">
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← Dashboard
        </button>
        <h2>{name}</h2>
        <div style={{ marginLeft: 'auto' }}>
          <button
            type="button"
            className="btn"
            disabled={verifying}
            onClick={() => void runVerify()}
          >
            {verifying ? (
              <>
                <span className="spinner" />
                Verifying…
              </>
            ) : (
              'Verify latest'
            )}
          </button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      {latestVerify && (
        <div className={latestVerify.ok ? 'success' : 'error'}>
          {latestVerify.ok ? (
            <>verify OK — sha256 + gunzip + pg_restore -l all green for the latest dump</>
          ) : (
            <>verify failed: {latestVerify.errors.join('; ')}</>
          )}
        </div>
      )}

      {history === null ? (
        <div className="empty">Loading…</div>
      ) : history.length === 0 ? (
        <div className="empty">No dumps yet. Trigger one from the dashboard.</div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Size</th>
              <th>SHA-256 (prefix)</th>
              <th>Path</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.path}>
                <td title={h.timestamp}>{relativeTime(h.timestamp)}</td>
                <td>{humanSize(h.size)}</td>
                <td>
                  <code>{h.sha256 ? h.sha256.slice(0, 16) : '(missing)'}</code>
                </td>
                <td>
                  <code>{h.path}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

type View = { kind: 'dashboard' } | { kind: 'detail'; name: string };

function viewFromHash(): View {
  const m = /^#\/db\/(.+)$/.exec(window.location.hash);
  if (m?.[1]) return { kind: 'detail', name: decodeURIComponent(m[1]) };
  return { kind: 'dashboard' };
}

function App() {
  const [view, setView] = useState<View>(viewFromHash);

  useEffect(() => {
    const onHash = () => setView(viewFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const goDetail = (name: string) => {
    window.location.hash = `#/db/${encodeURIComponent(name)}`;
  };
  const goDashboard = () => {
    window.location.hash = '';
  };

  return (
    <div className="container">
      <header>
        <div>
          <h1>DumpVault</h1>
          <div className="muted">Local dashboard — listens on 127.0.0.1, no auth</div>
        </div>
        <div className="muted">v0.5</div>
      </header>
      {view.kind === 'dashboard' ? (
        <Dashboard onSelectDb={goDetail} />
      ) : (
        <DbDetail name={view.name} onBack={goDashboard} />
      )}
    </div>
  );
}

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root element missing from index.html');
createRoot(rootEl).render(<App />);
