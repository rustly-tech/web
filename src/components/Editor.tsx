import { useEffect, useRef } from 'react';

/**
 * Monaco, loaded lazily.
 *
 * Monaco is large. A reader who never opens an editor never downloads it, which
 * is why it is imported inside an effect rather than at module scope and lives
 * in its own Rollup chunk.
 *
 * The `<textarea>` fallback is not a placeholder: it is what a reader gets if
 * Monaco fails to load, if JavaScript is limited, or if they simply prefer it.
 * The workspace stays usable either way.
 */

interface Props {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  readOnly?: boolean;
  heightRem?: number;
}

export default function Editor({
  value,
  onChange,
  ariaLabel,
  readOnly = false,
  heightRem = 22,
}: Props) {
  const host = useRef<HTMLDivElement | null>(null);
  const fallback = useRef<HTMLTextAreaElement | null>(null);
  // Kept in a ref so the Monaco listener always sees the current handler
  // without re-creating the editor on every render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let disposed = false;
    let editor: {
      dispose: () => void;
      getValue: () => string;
      setValue: (v: string) => void;
    } | null = null;

    async function mount() {
      if (!host.current) return;
      try {
        const monaco = await import('monaco-editor');
        if (disposed || !host.current) return;

        editor = monaco.editor.create(host.current, {
          value,
          language: 'rust',
          automaticLayout: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          readOnly,
          renderLineHighlight: 'none',
          padding: { top: 12, bottom: 12 },
          theme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs',
          // Screen-reader users get a real accessible surface rather than a
          // canvas they cannot read.
          accessibilitySupport: 'auto',
          ariaLabel,
        });

        editor.getValue();
        const model = monaco.editor.getModels()[0];
        model?.onDidChangeContent(() => {
          onChangeRef.current(model.getValue());
        });

        if (fallback.current) fallback.current.hidden = true;
      } catch (error) {
        // Falling back is normal, not exceptional. Log for us, carry on for them.
        console.warn('Monaco failed to load; using the plain editor', error);
      }
    }

    void mount();
    return () => {
      disposed = true;
      editor?.dispose();
    };
    // Mount once, deliberately. `value` is the initial document; later updates
    // flow through Monaco's own model, and re-running this effect on every
    // change would tear down the editor mid-keystroke.
  }, []);

  return (
    <div className="editor">
      <div ref={host} className="editor__monaco" style={{ height: `${heightRem}rem` }} />
      <textarea
        ref={fallback}
        className="editor__fallback"
        aria-label={ariaLabel}
        defaultValue={value}
        readOnly={readOnly}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        style={{ height: `${heightRem}rem` }}
      />
      <style>{`
        .editor { border: 1px solid var(--rule); border-radius: var(--radius); overflow: hidden; }
        .editor__monaco:empty { display: none; }
        .editor__fallback {
          display: block;
          width: 100%;
          border: 0;
          padding: var(--space-3);
          font-family: var(--mono);
          font-size: 0.8125rem;
          line-height: 1.55;
          background: var(--paper-sunken);
          color: var(--ink);
          resize: vertical;
        }
      `}</style>
    </div>
  );
}
