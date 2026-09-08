import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor from './Editor';
import { Explanation, ProvenanceNote, RawDiagnostics } from './DiagnosticPanels';
import {
  BackendUnavailable,
  defaultBackend,
  type CheckResult,
  type RunResult,
} from '../lib/compiler';
import { clearDraft, createStore, loadDraft, recordProgress, saveDraft } from '../lib/local-store';

/**
 * The coding workspace: editor, Hard Check, Run, and Submit.
 *
 * # Hard Check
 *
 * Before running anything, the reader states what they expect to happen. The
 * commitment is the point — a prediction you have made is one you care about
 * being wrong, and being wrong on purpose is how a mental model gets corrected.
 * Skipping is allowed and takes one click; nagging would just teach people to
 * click through it.
 *
 * # What talks to the network
 *
 * Typing does not. Checking and running do not with the mock backend. A remote
 * backend may send code to its configured compiler endpoint. Submission remains
 * disabled until the data-plane upload and authenticated control-plane flow are
 * wired; inventing a CID without uploading bytes would violate invariant D.
 */

/** One public test, shown to the reader. */
export interface PublicTest {
  id: string;
  stdin: string;
  expected_stdout: string;
}

interface Props {
  /** Local storage slot, e.g. `trial:ownership-move-or-borrow`. */
  slot: string;
  starterCode: string;
  ariaLabel: string;
  publicTests?: PublicTest[];
  /** Trial slug, when this workspace belongs to a Trial. */
  trial?: string;
  /** API origin. Empty means no backend is configured and Submit is disabled. */
  apiBase?: string;
  /** Progress key to record against. */
  progressKey?: string;
}

type Phase = 'idle' | 'checking' | 'running';

const DRAFT_DEBOUNCE_MS = 600;

export default function Workspace({
  slot,
  starterCode,
  ariaLabel,
  publicTests = [],
  trial,
  apiBase = '',
  progressKey,
}: Props) {
  const store = useMemo(() => createStore(), []);
  const backend = useMemo(() => defaultBackend(apiBase), [apiBase]);

  const [source, setSource] = useState(starterCode);
  const [restored, setRestored] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [prediction, setPrediction] = useState<'compiles' | 'fails' | null>(null);
  const [committed, setCommitted] = useState(false);
  const [result, setResult] = useState<CheckResult | RunResult | null>(null);
  const [outage, setOutage] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Restore a draft on mount. Doing it in an effect rather than in the initial
  // state keeps the server-rendered HTML identical for every reader.
  useEffect(() => {
    const draft = loadDraft(store, slot);
    if (draft) {
      setSource(draft.source);
      setSavedAt(draft.savedAt);
    }
    setRestored(true);
  }, [store, slot]);

  // Debounced save. Typing must not produce a write per keystroke, let alone a
  // request per keystroke.
  useEffect(() => {
    if (!restored || source === starterCode) return;
    const timer = setTimeout(() => {
      saveDraft(store, slot, source);
      setSavedAt(new Date().toISOString());
    }, DRAFT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, restored, store, slot, starterCode]);

  const predictionWasRight =
    committed && result !== null && prediction !== null
      ? (prediction === 'compiles') === result.ok
      : null;

  const check = useCallback(async () => {
    setPhase('checking');
    setOutage(null);
    try {
      const outcome = await backend.check(source);
      setResult(outcome);
      if (progressKey) recordProgress(store, progressKey, 'started');
    } catch (error) {
      // An outage is our failure. It must never be rendered as a compile error.
      setOutage(error instanceof BackendUnavailable ? error.message : 'the check could not run');
      setResult(null);
    } finally {
      setPhase('idle');
    }
  }, [backend, source, progressKey, store]);

  const run = useCallback(
    async (stdin: string) => {
      setPhase('running');
      setOutage(null);
      try {
        const outcome = await backend.run(source, stdin);
        setResult(outcome);
      } catch (error) {
        setOutage(error instanceof BackendUnavailable ? error.message : 'the run could not start');
        setResult(null);
      } finally {
        setPhase('idle');
      }
    },
    [backend, source],
  );

  const busy = phase !== 'idle';

  return (
    <div className="workspace stack">
      <div className="workspace__toolbar cluster">
        <button type="button" onClick={check} disabled={busy || !committed}>
          {phase === 'checking' ? 'Checking…' : 'Hard Check'}
        </button>
        <button
          type="button"
          onClick={() => run(publicTests[0]?.stdin ?? '')}
          disabled={busy || !committed}
        >
          {phase === 'running' ? 'Running…' : 'Run'}
        </button>
        {trial && (
          <button
            type="button"
            data-variant="primary"
            disabled
            title="Submission needs authenticated artifact upload and judge streaming, which are not connected yet"
          >
            Submit
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setSource(starterCode);
            clearDraft(store, slot);
            setSavedAt(null);
            setResult(null);
          }}
          disabled={busy}
        >
          Reset
        </button>
        <span className="workspace__saved" aria-live="polite">
          {savedAt ? `Draft saved locally ${relative(savedAt)}` : 'No local draft'}
        </span>
      </div>

      {!committed && (
        <section className="panel hard-check" aria-labelledby="hard-check-title">
          <div className="panel__header">
            <span id="hard-check-title">Hard Check</span>
            <span className="tag">before you run</span>
          </div>
          <div className="panel__body stack">
            <p style={{ margin: 0 }}>
              What do you think happens when this compiles? Commit to an answer first — being wrong
              on purpose is how the model gets fixed.
            </p>
            <div className="cluster">
              <label className="hard-check__option">
                <input
                  type="radio"
                  name="prediction"
                  checked={prediction === 'compiles'}
                  onChange={() => setPrediction('compiles')}
                />
                It compiles
              </label>
              <label className="hard-check__option">
                <input
                  type="radio"
                  name="prediction"
                  checked={prediction === 'fails'}
                  onChange={() => setPrediction('fails')}
                />
                It fails to compile
              </label>
            </div>
            <div className="cluster">
              <button
                type="button"
                data-variant="primary"
                onClick={() => setCommitted(true)}
                disabled={prediction === null}
              >
                Commit and unlock
              </button>
              {/* Skipping is one click. Nagging teaches people to click through. */}
              <button
                type="button"
                onClick={() => {
                  setPrediction(null);
                  setCommitted(true);
                }}
              >
                Skip
              </button>
            </div>
          </div>
        </section>
      )}

      <Editor value={source} onChange={setSource} ariaLabel={ariaLabel} heightRem={24} />

      {predictionWasRight !== null && (
        <p
          className={predictionWasRight ? 'notice notice--info' : 'notice notice--warning'}
          role="status"
        >
          {predictionWasRight
            ? 'Your prediction was right.'
            : 'Your prediction was wrong — this is the useful part. Read the diagnostic below.'}
        </p>
      )}

      {outage && (
        <p className="notice notice--warning" role="alert">
          <strong>We could not run that.</strong> {outage}. This is a problem on our side, not with
          your code.
        </p>
      )}

      {result && (
        <>
          <ProvenanceNote provenance={result.provenance} />
          <div className="workspace__panels">
            <RawDiagnostics result={result} />
            <Explanation result={result} />
          </div>
          {'stdout' in result && result.stdout.length > 0 && (
            <section className="panel">
              <div className="panel__header">Program output</div>
              <div className="panel__body">
                <pre style={{ margin: 0 }}>
                  <code>{result.stdout}</code>
                </pre>
              </div>
            </section>
          )}
        </>
      )}

      {publicTests.length > 0 && (
        <section className="panel" aria-labelledby="tests-title">
          <div className="panel__header">
            <span id="tests-title">Public tests</span>
            <span className="tag">{publicTests.length}</span>
          </div>
          <div className="panel__body">
            <p style={{ marginTop: 0, color: 'var(--ink-muted)', fontSize: '0.875rem' }}>
              Hidden tests also run when you submit. They probe cases these do not.
            </p>
            <table>
              <thead>
                <tr>
                  <th scope="col">Test</th>
                  <th scope="col">Input</th>
                  <th scope="col">Expected output</th>
                </tr>
              </thead>
              <tbody>
                {publicTests.map((test) => (
                  <tr key={test.id}>
                    <td>
                      <code>{test.id}</code>
                    </td>
                    <td>
                      <pre className="cell">
                        <code>{test.stdin}</code>
                      </pre>
                    </td>
                    <td>
                      <pre className="cell">
                        <code>{test.expected_stdout}</code>
                      </pre>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <style>{`
        .workspace__toolbar { padding-bottom: var(--space-2); }
        .workspace__saved { margin-left: auto; color: var(--ink-muted); font-size: 0.8125rem; }
        .workspace__panels { display: grid; gap: var(--space-4); }
        @media (min-width: 900px) { .workspace__panels { grid-template-columns: 1fr 1fr; } }
        .hard-check__option { display: inline-flex; align-items: center; gap: var(--space-2); cursor: pointer; }
        .cell { margin: 0; padding: var(--space-2); font-size: 0.75rem; background: var(--paper-sunken); border: 0; }
      `}</style>
    </div>
  );
}

/** A short relative time, without pulling in a formatting library. */
function relative(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}
