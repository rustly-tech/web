import { describe, expect, it, vi } from 'vitest';
import {
  describeState,
  describeVerdict,
  idempotencyKey,
  isSystemFault,
  isUserFault,
  HostedSubmissionClient,
  sourceCid,
  type CreateSubmissionRequest,
  type Verdict,
} from '../submissions';

const ALL: Verdict[] = ['AC', 'CE', 'WA', 'TLE', 'MLE', 'OLE', 'RTE', 'JE', 'IE', 'SE'];

describe('verdict classification', () => {
  it('never treats an infrastructure failure as a mistake by the submitter', () => {
    for (const verdict of ['JE', 'IE'] as Verdict[]) {
      expect(isSystemFault(verdict)).toBe(true);
      expect(isUserFault(verdict)).toBe(false);
    }
  });

  it('treats every real failure as belonging to the submitter', () => {
    for (const verdict of ['CE', 'WA', 'TLE', 'MLE', 'OLE', 'RTE', 'SE'] as Verdict[]) {
      expect(isUserFault(verdict)).toBe(true);
      expect(isSystemFault(verdict)).toBe(false);
    }
  });

  it('treats acceptance as neither', () => {
    expect(isUserFault('AC')).toBe(false);
    expect(isSystemFault('AC')).toBe(false);
  });

  it('describes every verdict without blaming the reader for our outage', () => {
    for (const verdict of ALL) {
      const { label, detail } = describeVerdict(verdict);
      expect(label.length).toBeGreaterThan(0);
      expect(detail.length).toBeGreaterThan(0);
    }
    expect(describeVerdict('IE').detail).toContain('our side');
    expect(describeVerdict('JE').detail).toContain('Your submission is fine');
  });
});

describe('idempotency', () => {
  it('is stable for the same Trial and source, so a retry cannot double-submit', () => {
    const a = idempotencyKey('ownership-move-or-borrow', 'fn main() {}');
    const b = idempotencyKey('ownership-move-or-borrow', 'fn main() {}');
    expect(a).toBe(b);
  });

  it('differs when the source changes', () => {
    expect(idempotencyKey('t', 'fn main() {}')).not.toBe(idempotencyKey('t', 'fn main() { }'));
  });

  it('differs across Trials, so one solution submitted twice is two attempts', () => {
    expect(idempotencyKey('a', 'src')).not.toBe(idempotencyKey('b', 'src'));
  });

  it('stays inside the 128-character limit the API enforces', () => {
    const key = idempotencyKey('a'.repeat(90), 'x'.repeat(10_000));
    expect(key.length).toBeLessThanOrEqual(128);
  });
});

describe('state descriptions', () => {
  it('describes each state a reader can be shown', () => {
    expect(describeState({ state: 'queued' })).toBe('Queued');
    expect(describeState({ state: 'compiling' })).toBe('Compiling');
    expect(describeState({ state: 'running', completed: 2, total: 5 })).toContain('2/5');
    expect(describeState({ state: 'finished', verdict: 'AC' })).toBe('Accepted');
  });
});

describe('hosted submission path', () => {
  it('hashes, uploads, submits a receipt, and consumes the terminal SSE event', async () => {
    expect(sourceCid('abc')).toBe(
      'b3:6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85',
    );
    const states: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/auth/guest')) {
        return Response.json({
          access_token: 'user-token',
          expires_at: 4_000_000_000,
          username: 'guest-a',
        });
      }
      if (url.endsWith('/uploads/source')) {
        return Response.json({
          upload_url: 'https://artifacts.test/upload',
          grant: 'upload-grant',
          expires_at: 4_000_000_000,
        });
      }
      if (url === 'https://artifacts.test/upload') {
        expect(init?.method).toBe('PUT');
        expect(new TextDecoder().decode(init?.body as Uint8Array)).toBe('abc');
        return Response.json({ cid: sourceCid('abc'), size: 3, receipt: 'storage-receipt' });
      }
      if (url.endsWith('/submissions') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string) as CreateSubmissionRequest;
        expect(body.source_receipt).toBe('storage-receipt');
        expect(body.source_cid).toBe(sourceCid('abc'));
        return Response.json({
          submission_id: 'submission-1',
          job_id: 'job-1',
          trial: body.trial,
          trial_version: 2,
          created_at: '2026-09-09T00:00:00Z',
          idempotent_replay: false,
          state: 'queued',
        });
      }
      if (url.endsWith('/submissions/submission-1/events')) {
        return new Response(
          'event: submission\ndata: {"state":"compiling"}\n\n' +
            'event: submission\ndata: {"state":"finished","verdict":"AC"}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      }
      throw new Error(`unexpected request ${url}`);
    });
    const memory = new Map<string, string>();
    const client = new HostedSubmissionClient('https://api.test', fetcher as typeof fetch, {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, value),
    });
    const result = await client.submit('ownership-move-or-borrow', 'abc', (state) =>
      states.push(state.state),
    );
    expect(result).toEqual({ state: 'finished', verdict: 'AC' });
    expect(states).toEqual(['queued', 'compiling', 'finished']);
  });

  it('recovers a persisted terminal verdict after the SSE stream disconnects', async () => {
    const session = JSON.stringify({
      access_token: 'existing-token',
      expires_at: 4_000_000_000,
      username: 'guest-existing',
    });
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      if (url.endsWith('/uploads/source')) {
        return Response.json({
          upload_url: 'https://store/upload',
          grant: 'g',
          expires_at: 4_000_000_000,
        });
      }
      if (url === 'https://store/upload') {
        return Response.json({ cid: sourceCid('x'), size: 1, receipt: 'r' });
      }
      if (url.endsWith('/submissions') && init?.method === 'POST') {
        return Response.json({
          submission_id: 's',
          job_id: 'j',
          trial: 't',
          trial_version: 2,
          created_at: '2026-09-09T00:00:00Z',
          idempotent_replay: false,
          state: 'queued',
        });
      }
      if (url.endsWith('/events')) return new Response('', { status: 200 });
      if (url.endsWith('/submissions/s')) {
        return Response.json({
          submission_id: 's',
          job_id: 'j',
          trial: 't',
          trial_version: 2,
          created_at: '2026-09-09T00:00:00Z',
          idempotent_replay: false,
          state: 'finished',
          verdict: 'WA',
        });
      }
      throw new Error(`unexpected request ${url}`);
    });
    const client = new HostedSubmissionClient('https://api.test', fetcher as typeof fetch, {
      getItem: () => session,
      setItem: () => undefined,
    });
    await expect(client.submit('t', 'x', () => undefined)).resolves.toMatchObject({
      state: 'finished',
      verdict: 'WA',
    });
  });
});
