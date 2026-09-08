import { describe, expect, it } from 'vitest';
import { BackendUnavailable, defaultBackend, MockBackend, RemoteBackend } from '../compiler';

const MOVE_ERROR = `fn main() {
    let a = String::from("hello");
    let b = a;
    println!("{a}");
    println!("{b}");
}`;

const COPY_OK = `fn main() {
    let a = 5;
    let b = a;
    println!("{a} {b}");
}`;

describe('MockBackend', () => {
  it('never claims to be a real compiler', async () => {
    const backend = new MockBackend();
    expect(backend.isReal).toBe(false);

    const result = await backend.check(COPY_OK);
    expect(result.provenance.kind).toBe('mock');
    expect(result.provenance).toHaveProperty('note');
  });

  it('recognises use-after-move and reports E0382', async () => {
    const result = await new MockBackend().check(MOVE_ERROR);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]?.code).toBe('E0382');
    expect(result.rawOutput).toContain('E0382');
    expect(result.rawOutput).toContain('does not implement the `Copy` trait');
  });

  it('does not flag a Copy type, because copying is not a move', async () => {
    const result = await new MockBackend().check(COPY_OK);
    expect(result.ok).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('reports a missing main', async () => {
    const result = await new MockBackend().check('fn helper() {}');
    expect(result.diagnostics[0]?.code).toBe('E0601');
  });

  it('refuses to pretend it executed anything', async () => {
    const result = await new MockBackend().run(COPY_OK, '');
    expect(result.exitCode).toBeNull();
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('cannot execute');
  });

  it('surfaces the compile error when running code that does not compile', async () => {
    const result = await new MockBackend().run(MOVE_ERROR, '');
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('E0382');
  });
});

describe('backend selection', () => {
  it('uses the mock when no endpoint is configured', () => {
    expect(defaultBackend()).toBeInstanceOf(MockBackend);
    expect(defaultBackend('')).toBeInstanceOf(MockBackend);
  });

  it('uses the remote backend when an endpoint is configured', () => {
    const backend = defaultBackend('https://api.rustly.tech');
    expect(backend).toBeInstanceOf(RemoteBackend);
    expect(backend.isReal).toBe(true);
  });
});

describe('RemoteBackend', () => {
  it('reports an outage as unavailability, never as a compile error', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response('upstream is down', { status: 503 })) as typeof fetch;

    try {
      const backend = new RemoteBackend({ endpoint: 'https://api.example' });
      await expect(backend.check('fn main() {}')).rejects.toBeInstanceOf(BackendUnavailable);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('reports a network failure as unavailability too', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError('network error');
    }) as typeof fetch;

    try {
      const backend = new RemoteBackend({ endpoint: 'https://api.example' });
      await expect(backend.run('fn main() {}', '')).rejects.toBeInstanceOf(BackendUnavailable);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('labels results with where they came from', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ ok: true, rawOutput: 'Finished', diagnostics: [], durationMs: 1 }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    try {
      const result = await new RemoteBackend({ endpoint: 'https://api.example' }).check(
        'fn main() {}',
      );
      expect(result.provenance).toEqual({ kind: 'remote', endpoint: 'https://api.example' });
    } finally {
      globalThis.fetch = original;
    }
  });
});
