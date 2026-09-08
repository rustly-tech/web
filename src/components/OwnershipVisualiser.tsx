import { useCallback, useEffect, useState } from 'react';
import type { Visualisation, BindingState } from '../lib/content';

/**
 * Steps through an authored ownership visualisation.
 *
 * Authored, not inferred: inferring binding state would need a borrow checker,
 * and an approximate one teaching an exact rule is worse than no diagram.
 *
 * The whole thing is operable from the keyboard, and every state is described in
 * words as well as position and shading — a diagram that only works if you can
 * see it teaches only the people who can see it.
 */

const STATE_LABEL: Record<BindingState, string> = {
  owns: 'owns the value',
  moved: 'moved out — no longer usable',
  borrowed_shared: 'holds a shared reference',
  borrowed_unique: 'holds a unique reference',
  dropped: 'out of scope — value dropped',
  uninitialised: 'declared, not yet initialised',
};

const STATE_SHORT: Record<BindingState, string> = {
  owns: 'owns',
  moved: 'moved',
  borrowed_shared: '&shared',
  borrowed_unique: '&mut',
  dropped: 'dropped',
  uninitialised: 'uninit',
};

interface Props {
  visualisation: Visualisation;
  /** Called the first time the reader reaches the last step. */
  onComplete?: () => void;
}

export default function OwnershipVisualiser({ visualisation, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [announced, setAnnounced] = useState(false);
  const steps = visualisation.steps;
  const step = steps[index];
  const lines = visualisation.code.replace(/\n$/, '').split('\n');

  useEffect(() => {
    if (index === steps.length - 1 && !announced) {
      setAnnounced(true);
      onComplete?.();
    }
  }, [index, steps.length, announced, onComplete]);

  const go = useCallback(
    (delta: number) =>
      setIndex((current) => Math.min(steps.length - 1, Math.max(0, current + delta))),
    [steps.length],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        go(1);
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        go(-1);
      }
    },
    [go],
  );

  if (!step) return null;

  return (
    <section className="viz panel" aria-labelledby="viz-title" onKeyDown={onKeyDown}>
      <div className="panel__header">
        <span id="viz-title">Ownership, step by step</span>
        <span className="tag">
          {index + 1} / {steps.length}
        </span>
      </div>

      <div className="panel__body viz__body">
        <ol
          className="viz__code list-reset"
          aria-label="Program, with the current line highlighted"
        >
          {lines.map((line, lineIndex) => {
            const isCurrent = lineIndex + 1 === step.line;
            return (
              <li
                key={lineIndex}
                className={isCurrent ? 'viz__line viz__line--current' : 'viz__line'}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="viz__gutter" aria-hidden="true">
                  {lineIndex + 1}
                </span>
                <code>{line === '' ? ' ' : line}</code>
              </li>
            );
          })}
        </ol>

        <div className="viz__state">
          <h3 className="viz__heading">After line {step.line}</h3>
          <p className="viz__note">{step.note}</p>

          <ul className="list-reset viz__bindings">
            {step.bindings.map((binding) => (
              <li key={binding.name} className={`viz__binding viz__binding--${binding.state}`}>
                <code className="viz__name">{binding.name}</code>
                <span className="viz__short" aria-hidden="true">
                  {STATE_SHORT[binding.state]}
                </span>
                <span className="visually-hidden">{STATE_LABEL[binding.state]}</span>
                <span className="viz__desc">{STATE_LABEL[binding.state]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="panel__header viz__controls">
        <div className="cluster">
          <button type="button" onClick={() => go(-1)} disabled={index === 0}>
            ← Previous
          </button>
          <button
            type="button"
            data-variant="primary"
            onClick={() => go(1)}
            disabled={index === steps.length - 1}
          >
            Next →
          </button>
        </div>
        <span className="tag">Arrow keys work too</span>
      </div>

      {/* Announced to assistive technology on every step change. */}
      <p aria-live="polite" className="visually-hidden">
        Step {index + 1} of {steps.length}. After line {step.line}: {step.note}
      </p>

      <style>{`
        .viz__body { display: grid; gap: var(--space-4); }
        @media (min-width: 760px) {
          .viz__body { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); }
        }
        .viz__code {
          font-family: var(--mono);
          font-size: 0.875rem;
          background: var(--paper-sunken);
          border: 1px solid var(--rule);
          border-radius: var(--radius);
          padding: var(--space-2) 0;
          overflow-x: auto;
        }
        .viz__line { display: flex; gap: var(--space-3); padding: 0.1rem var(--space-3); white-space: pre; }
        .viz__line--current { background: var(--paper-raised); box-shadow: inset 3px 0 0 var(--accent); }
        .viz__gutter { color: var(--ink-faint); min-width: 1.5rem; text-align: right; user-select: none; }
        .viz__heading { margin: 0 0 var(--space-2); font-size: 0.875rem; color: var(--ink-muted); }
        .viz__note { margin: 0 0 var(--space-3); }
        .viz__bindings { display: flex; flex-direction: column; gap: var(--space-2); }
        .viz__binding {
          display: grid;
          grid-template-columns: auto auto 1fr;
          gap: var(--space-3);
          align-items: baseline;
          border: 1px solid var(--rule);
          border-left-width: 3px;
          border-radius: var(--radius);
          padding: var(--space-2) var(--space-3);
        }
        .viz__binding--owns { border-left-color: var(--success); }
        .viz__binding--moved { border-left-color: var(--error); }
        .viz__binding--dropped { border-left-color: var(--ink-faint); }
        .viz__binding--borrowed_shared,
        .viz__binding--borrowed_unique { border-left-color: var(--warning); }
        .viz__name { font-weight: 600; background: none; padding: 0; }
        .viz__short { font-family: var(--mono); font-size: 0.75rem; color: var(--ink-muted); }
        .viz__desc { font-size: 0.875rem; color: var(--ink-muted); }
        .viz__controls { border-top: 1px solid var(--rule); border-bottom: 0; }
      `}</style>
    </section>
  );
}
