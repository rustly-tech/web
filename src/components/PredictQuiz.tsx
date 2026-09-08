import { useMemo, useState } from 'react';
import type { Quiz } from '../lib/content';
import { createStore, recordProgress } from '../lib/local-store';

/**
 * A predict-before-run quiz.
 *
 * The reader commits to an answer before seeing the result. That commitment is
 * the pedagogy: a prediction you have made is a prediction you care about being
 * wrong, and being wrong on purpose is how the mental model gets corrected.
 *
 * Answering writes to local storage only. No request is made per click
 * (invariant C); progress reaches the control plane later, batched.
 */

interface Props {
  quiz: Quiz;
}

export default function PredictQuiz({ quiz }: Props) {
  const [chosen, setChosen] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const store = useMemo(() => createStore(), []);

  const correctIndex = quiz.options.findIndex((option) => option.correct);
  const isCorrect = chosen !== null && quiz.options[chosen]?.correct === true;

  function commit() {
    if (chosen === null) return;
    setRevealed(true);
    // Answering at all is progress. Getting it right is deeper progress.
    recordProgress(store, `quiz/${quiz.id}`, isCorrect ? 'completed' : 'started');
  }

  function retry() {
    setChosen(null);
    setRevealed(false);
  }

  return (
    <section className="quiz panel" aria-labelledby={`quiz-${quiz.id}`}>
      <div className="panel__header">
        <span id={`quiz-${quiz.id}`}>Predict before you run</span>
        {revealed && (
          <span className={isCorrect ? 'badge badge--success' : 'badge badge--warning'}>
            {isCorrect ? 'Correct' : 'Not quite'}
          </span>
        )}
      </div>

      <div className="panel__body stack">
        <p className="quiz__prompt">{quiz.prompt}</p>

        {quiz.code && (
          <pre className="quiz__code">
            <code>{quiz.code.replace(/\n$/, '')}</code>
          </pre>
        )}

        <fieldset className="quiz__options" disabled={revealed}>
          <legend className="visually-hidden">Answer options</legend>
          {quiz.options.map((option, index) => {
            const id = `${quiz.id}-option-${index}`;
            const state = !revealed
              ? ''
              : option.correct
                ? ' quiz__option--correct'
                : index === chosen
                  ? ' quiz__option--chosen-wrong'
                  : '';
            return (
              <div key={id} className={`quiz__option${state}`}>
                <input
                  type="radio"
                  id={id}
                  name={`quiz-${quiz.id}`}
                  checked={chosen === index}
                  onChange={() => setChosen(index)}
                />
                <label htmlFor={id}>
                  <code>{option.text}</code>
                  {/*
                    A wrong answer is a specific misconception. Naming it is
                    where the teaching happens; "incorrect" addresses nothing.
                  */}
                  {revealed && !option.correct && index === chosen && option.why_wrong && (
                    <span className="quiz__why">{option.why_wrong}</span>
                  )}
                </label>
              </div>
            );
          })}
        </fieldset>

        <div className="cluster">
          {!revealed ? (
            <button
              type="button"
              data-variant="primary"
              onClick={commit}
              disabled={chosen === null}
            >
              Commit answer
            </button>
          ) : (
            <button type="button" onClick={retry}>
              Try again
            </button>
          )}
          {!revealed && chosen === null && (
            <span className="quiz__hint">Choose an answer to commit.</span>
          )}
        </div>

        {revealed && (
          <div className="quiz__explanation" role="status">
            <h4>Why</h4>
            <p>{quiz.explanation}</p>
            {!isCorrect && correctIndex >= 0 && (
              <p>
                The answer was <code>{quiz.options[correctIndex]?.text}</code>.
              </p>
            )}
          </div>
        )}
      </div>

      <style>{`
        .quiz__prompt { font-weight: 500; margin: 0; }
        .quiz__code { margin: 0; }
        .quiz__options { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
        .quiz__option {
          display: grid;
          grid-template-columns: auto 1fr;
          gap: var(--space-3);
          align-items: start;
          border: 1px solid var(--rule);
          border-radius: var(--radius);
          padding: var(--space-3);
        }
        .quiz__option:has(input:checked) { border-color: var(--rule-strong); }
        .quiz__option--correct { border-color: var(--success); background: var(--success-bg); }
        .quiz__option--chosen-wrong { border-color: var(--error); background: var(--error-bg); }
        .quiz__option label { cursor: pointer; display: block; }
        .quiz__option code { background: none; padding: 0; }
        .quiz__why { display: block; margin-top: var(--space-2); font-size: 0.875rem; color: var(--ink-muted); font-family: var(--sans); }
        .quiz__hint { color: var(--ink-muted); font-size: 0.875rem; }
        .quiz__explanation { border-top: 1px solid var(--rule); padding-top: var(--space-3); }
        .quiz__explanation h4 { margin: 0 0 var(--space-2); font-size: 0.875rem; color: var(--ink-muted); }
        .quiz__explanation p { margin: 0 0 var(--space-2); }
      `}</style>
    </section>
  );
}
