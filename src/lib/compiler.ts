/**
 * The `CompilerBackend` abstraction.
 *
 * # Status
 *
 * | Backend | Status | What it actually does |
 * | --- | --- | --- |
 * | {@link MockBackend} | **IMPLEMENTED** | Pattern-matches a small corpus. Development only. |
 * | {@link RemoteBackend} | **IMPLEMENTED** | Calls the Rustly API. Real `rustc`, real judge. |
 * | Browser WASM execution | **PLANNED** | `rustly-tech/toolchain` |
 * | Browser Rust compiler | **PLANNED**, unqualified | See the toolchain repository |
 *
 * There is no in-browser Rust compiler here, and the UI never claims there is.
 * {@link CheckResult.provenance} travels with every result so the interface can
 * say plainly where a diagnostic came from — a mocked diagnostic labelled as
 * real would teach people to distrust the tool, which is the one thing a
 * teaching compiler cannot afford.
 */

/** Where a result came from. */
export type Provenance =
  | { kind: 'mock'; note: string }
  | { kind: 'remote'; endpoint: string }
  | { kind: 'browser'; engine: string };

/** A single compiler diagnostic, close to `rustc --error-format=json`. */
export interface Diagnostic {
  level: 'error' | 'warning' | 'note' | 'help';
  /** `rustc` error code, e.g. `E0382`, when there is one. */
  code?: string;
  message: string;
  /** 1-based line in the submitted source, when known. */
  line?: number;
  /** 1-based column, when known. */
  column?: number;
}

/** The result of checking or compiling. */
export interface CheckResult {
  ok: boolean;
  /**
   * Raw compiler output, byte for byte.
   *
   * Never rewritten, never summarised, never truncated for tidiness. Learning
   * to read a real diagnostic is the skill; a friendlier paraphrase alongside
   * it is help, a friendlier paraphrase instead of it is a disservice.
   */
  rawOutput: string;
  diagnostics: Diagnostic[];
  provenance: Provenance;
  durationMs: number;
}

/** The result of running a program. */
export interface RunResult extends CheckResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
}

/** A backend that can check and run Rust. */
export interface CompilerBackend {
  readonly id: string;
  /** Whether results from this backend reflect a real Rust toolchain. */
  readonly isReal: boolean;
  /** Type-check without producing a binary. */
  check(source: string, signal?: AbortSignal): Promise<CheckResult>;
  /** Compile and run, feeding `stdin`. */
  run(source: string, stdin: string, signal?: AbortSignal): Promise<RunResult>;
}

/**
 * A development backend that recognises a handful of teaching errors.
 *
 * It exists so the interface can be built and tested with no network and no
 * toolchain. It is **not** a compiler, it says so in its provenance, and the UI
 * shows that to the reader.
 */
export class MockBackend implements CompilerBackend {
  readonly id = 'mock';
  readonly isReal = false;

  async check(source: string): Promise<CheckResult> {
    const started = performance.now();
    const diagnostic = this.recognise(source);

    return {
      ok: diagnostic === null,
      rawOutput: diagnostic?.raw ?? '    Checking playground v0.0.0\n    Finished in 0.21s\n',
      diagnostics: diagnostic ? [diagnostic.parsed] : [],
      provenance: {
        kind: 'mock',
        note: 'Pattern-matched locally. Not a real compiler; submit to see real rustc output.',
      },
      durationMs: Math.round(performance.now() - started),
    };
  }

  async run(source: string, _stdin: string): Promise<RunResult> {
    const check = await this.check(source);
    if (!check.ok) {
      return { ...check, stdout: '', stderr: check.rawOutput, exitCode: 1, timedOut: false };
    }
    return {
      ...check,
      // The mock cannot execute anything, and pretending otherwise would be the
      // worst kind of lie: a plausible wrong answer.
      stdout: '',
      stderr: 'the mock backend cannot execute programs; use Submit for a real run\n',
      exitCode: null,
      timedOut: false,
    };
  }

  /** Recognise the small corpus of errors this backend knows. */
  private recognise(source: string): { raw: string; parsed: Diagnostic } | null {
    const lines = source.split('\n');

    // Use-after-move: a binding assigned from another and then read again.
    for (let index = 0; index < lines.length; index += 1) {
      const move = /^\s*let\s+(\w+)\s*=\s*(\w+)\s*;\s*$/.exec(lines[index] ?? '');
      if (!move) continue;
      const [, , from] = move;
      if (!from) continue;

      const ownsHeap = lines.some((l) =>
        new RegExp(`let\\s+(mut\\s+)?${from}\\s*=\\s*(String::|vec!|Vec::|Box::)`).test(l),
      );
      if (!ownsHeap) continue;

      const laterUse = lines.findIndex((l, i) => i > index && new RegExp(`\\b${from}\\b`).test(l));
      if (laterUse === -1) continue;

      const raw =
        `error[E0382]: borrow of moved value: \`${from}\`\n` +
        ` --> src/main.rs:${laterUse + 1}\n` +
        `  |\n` +
        `  = note: move occurs because \`${from}\` has type \`String\`, ` +
        `which does not implement the \`Copy\` trait\n`;
      return {
        raw,
        parsed: {
          level: 'error',
          code: 'E0382',
          message: `borrow of moved value: \`${from}\``,
          line: laterUse + 1,
        },
      };
    }

    if (!/fn\s+main\s*\(/.test(source)) {
      return {
        raw: 'error[E0601]: `main` function not found in crate `playground`\n',
        parsed: { level: 'error', code: 'E0601', message: '`main` function not found' },
      };
    }
    return null;
  }
}

/** Options for {@link RemoteBackend}. */
export interface RemoteBackendOptions {
  endpoint: string;
  /** Bearer token, when the reader is signed in. */
  token?: string;
  /** Abort a request that takes longer than this. */
  timeoutMs?: number;
}

/**
 * Calls the Rustly API, which dispatches to the sandboxed judge.
 *
 * This is the only path that produces genuine `rustc` output today.
 */
export class RemoteBackend implements CompilerBackend {
  readonly id = 'remote';
  readonly isReal = true;

  constructor(private readonly options: RemoteBackendOptions) {}

  async check(source: string, signal?: AbortSignal): Promise<CheckResult> {
    return this.post<CheckResult>('/api/v1/playground/check', { source }, signal);
  }

  async run(source: string, stdin: string, signal?: AbortSignal): Promise<RunResult> {
    return this.post<RunResult>('/api/v1/playground/run', { source, stdin }, signal);
  }

  private async post<T extends CheckResult>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    const started = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000);
    signal?.addEventListener('abort', () => controller.abort(), { once: true });

    try {
      const response = await fetch(`${this.options.endpoint}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.options.token ? { authorization: `Bearer ${this.options.token}` } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        // An outage is our failure, not the reader's mistake. It must never be
        // presented as if their code were wrong.
        throw new BackendUnavailable(`the compiler service returned ${response.status}`);
      }
      const result = (await response.json()) as T;
      return {
        ...result,
        provenance: { kind: 'remote', endpoint: this.options.endpoint },
        durationMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      if (error instanceof BackendUnavailable) throw error;
      throw new BackendUnavailable(
        controller.signal.aborted
          ? 'the compiler service timed out'
          : 'the compiler service is unreachable',
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

/**
 * The compiler service could not be reached.
 *
 * A distinct type so the UI cannot accidentally render an outage as a compile
 * error. That distinction matters more here than almost anywhere: a learner
 * shown a fabricated error learns to distrust every real one.
 */
export class BackendUnavailable extends Error {
  override readonly name = 'BackendUnavailable';
}

/** Choose a backend from the environment. */
export function defaultBackend(endpoint?: string, token?: string): CompilerBackend {
  if (endpoint && endpoint.length > 0) {
    return new RemoteBackend(token !== undefined ? { endpoint, token } : { endpoint });
  }
  return new MockBackend();
}
