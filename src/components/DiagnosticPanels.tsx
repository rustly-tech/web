import type { CheckResult, Provenance } from '../lib/compiler';
import { explain } from '../lib/explain';

/**
 * Two panels, side by side and never merged: the raw compiler output exactly as
 * it was produced, and a human explanation next to it.
 *
 * Keeping them separate is the whole point. A learner who only ever sees our
 * paraphrase is helpless the first time they meet a compiler without us.
 */

/** Says where a result came from, so a mocked result can never pass as real. */
export function ProvenanceNote({ provenance }: { provenance: Provenance }) {
  if (provenance.kind === 'mock') {
    return (
      <p className="notice notice--warning" role="note">
        <strong>Not a real compiler.</strong> {provenance.note}
      </p>
    );
  }
  if (provenance.kind === 'browser') {
    return (
      <p className="notice notice--info" role="note">
        Compiled in your browser with {provenance.engine}.
      </p>
    );
  }
  return (
    <p className="notice notice--info" role="note">
      Real <code>rustc</code>, run in the Rustly sandbox.
    </p>
  );
}

/** The raw diagnostic, verbatim. */
export function RawDiagnostics({ result }: { result: CheckResult }) {
  return (
    <section className="panel" aria-labelledby="raw-heading">
      <div className="panel__header">
        <span id="raw-heading">Compiler output</span>
        <span className="tag">{result.durationMs} ms</span>
      </div>
      <div className="panel__body">
        <pre className="raw">
          <code>{result.rawOutput.trimEnd() || '(no output)'}</code>
        </pre>
      </div>
      <style>{`.raw { margin: 0; max-height: 22rem; overflow: auto; }`}</style>
    </section>
  );
}

/** A human explanation, when we have one worth showing. */
export function Explanation({ result }: { result: CheckResult }) {
  const primary = result.diagnostics.find((d) => d.level === 'error') ?? result.diagnostics[0];
  const explanation = explain(primary?.code);

  if (!primary) {
    return (
      <section className="panel" aria-labelledby="explain-heading">
        <div className="panel__header">
          <span id="explain-heading">What this means</span>
        </div>
        <div className="panel__body">
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            {result.ok
              ? 'It compiles. Nothing to explain.'
              : 'No structured diagnostic to explain.'}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel" aria-labelledby="explain-heading">
      <div className="panel__header">
        <span id="explain-heading">What this means</span>
        {primary.code && <span className="badge badge--error">{primary.code}</span>}
      </div>
      <div className="panel__body stack">
        <p style={{ margin: 0, fontWeight: 500 }}>{primary.message}</p>

        {explanation ? (
          <>
            <p style={{ margin: 0 }}>{explanation.summary}</p>
            <div>
              <h4
                style={{
                  margin: '0 0 var(--space-2)',
                  fontSize: '0.875rem',
                  color: 'var(--ink-muted)',
                }}
              >
                What to consider, in order
              </h4>
              <ol style={{ margin: 0, paddingLeft: '1.2rem' }}>
                {explanation.fixes.map((fix) => (
                  <li key={fix} style={{ marginBottom: 'var(--space-2)' }}>
                    {fix}
                  </li>
                ))}
              </ol>
            </div>
            {explanation.reference && (
              <p style={{ margin: 0 }}>
                <a href={explanation.reference} target="_blank" rel="noreferrer">
                  Official explanation of {primary.code} →
                </a>
              </p>
            )}
          </>
        ) : (
          /* Nothing useful to add, so we say so rather than padding the page. */
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            We do not have a written explanation for this one yet. The compiler output on the left
            is the authoritative description.
          </p>
        )}
      </div>
    </section>
  );
}
