/**
 * The submission contract, exactly as the control plane defines it.
 *
 * The request carries a **content identifier**, never source. The client writes
 * its source to the data plane first and submits the resulting CID, so a
 * submission of any size never travels through the control-plane API
 * (invariant D). The API's 64 KiB body limit enforces that from the other side.
 */

import { blake3 } from '@noble/hashes/blake3.js';
import { bytesToHex } from '@noble/hashes/utils.js';

/** Verdicts, matching the judge. */
export type Verdict = 'AC' | 'CE' | 'WA' | 'TLE' | 'MLE' | 'OLE' | 'RTE' | 'JE' | 'IE' | 'SE';

/** Submission lifecycle, as streamed over SSE. */
export type SubmissionState =
  | { state: 'queued' }
  | { state: 'dispatched'; worker_id: string }
  | { state: 'compiling' }
  | { state: 'running'; completed: number; total: number }
  | { state: 'finished'; verdict: Verdict };

/** `POST /api/v1/submissions`. */
export interface CreateSubmissionRequest {
  trial: string;
  source_cid: string;
  source_receipt: string;
  idempotency_key: string;
}

/** The submission resource. */
export type SubmissionResponse = SubmissionState & {
  submission_id: string;
  job_id: string;
  trial: string;
  trial_version: number;
  created_at: string;
  idempotent_replay: boolean;
};

interface GuestSession {
  access_token: string;
  expires_at: number;
  username: string;
}

interface UploadGrant {
  upload_url: string;
  grant: string;
  expires_at: number;
}

interface UploadReceipt {
  cid: string;
  size: number;
  receipt: string;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
  request_id?: string;
}

/** Error returned by the hosted submission path. */
export class SubmissionUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubmissionUnavailable';
  }
}

const SESSION_KEY = 'rustly:guest-session:v1';

/** Compute Rustly's canonical source identifier in the browser. */
export function sourceCid(source: string): string {
  return `b3:${bytesToHex(blake3(new TextEncoder().encode(source)))}`;
}

/** Browser client for authenticated upload, submission, and verdict streaming. */
export class HostedSubmissionClient {
  private readonly apiBase: string;

  constructor(
    apiBase: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly sessionStore:
      Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage === 'undefined'
      ? undefined
      : localStorage,
  ) {
    this.apiBase = apiBase.replace(/\/$/, '');
  }

  /** Submit source and resolve only when a persisted terminal verdict arrives. */
  async submit(
    trial: string,
    source: string,
    onState: (state: SubmissionState) => void,
    signal?: AbortSignal,
  ): Promise<SubmissionState & { state: 'finished' }> {
    if (!this.apiBase) throw new SubmissionUnavailable('hosted submissions are not configured');
    const session = await this.session(signal);
    const bytes = new TextEncoder().encode(source);
    const cid = sourceCid(source);
    const upload = await this.json<UploadGrant>(
      '/api/v1/uploads/source',
      {
        method: 'POST',
        body: JSON.stringify({ cid, size: bytes.byteLength }),
        ...withSignal(signal),
      },
      session.access_token,
    );
    const stored = await this.fetcher(upload.upload_url, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${upload.grant}`,
        'content-type': 'text/plain; charset=utf-8',
      },
      body: bytes,
      ...withSignal(signal),
    });
    if (!stored.ok) throw await this.failure(stored, 'source upload failed');
    const receipt = (await stored.json()) as UploadReceipt;
    if (receipt.cid !== cid || receipt.size !== bytes.byteLength) {
      throw new SubmissionUnavailable('artifact storage returned an invalid receipt');
    }
    const created = await this.json<SubmissionResponse>(
      '/api/v1/submissions',
      {
        method: 'POST',
        body: JSON.stringify({
          trial,
          source_cid: cid,
          source_receipt: receipt.receipt,
          idempotency_key: idempotencyKey(trial, source),
        } satisfies CreateSubmissionRequest),
        ...withSignal(signal),
      },
      session.access_token,
    );
    onState(created);
    if (created.state === 'finished') return created;
    return this.watch(created.submission_id, session.access_token, onState, signal);
  }

  private async session(signal?: AbortSignal): Promise<GuestSession> {
    const stored = this.sessionStore?.getItem(SESSION_KEY);
    if (stored) {
      try {
        const session = JSON.parse(stored) as GuestSession;
        if (session.access_token && session.expires_at > Date.now() / 1000 + 30) return session;
      } catch {
        // Replace malformed local state with a fresh server-issued session.
      }
    }
    const session = await this.json<GuestSession>('/api/v1/auth/guest', {
      method: 'POST',
      ...withSignal(signal),
    });
    this.sessionStore?.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
  }

  private async watch(
    id: string,
    token: string,
    onState: (state: SubmissionState) => void,
    signal?: AbortSignal,
  ): Promise<SubmissionState & { state: 'finished' }> {
    while (!signal?.aborted) {
      try {
        const response = await this.fetcher(`${this.apiBase}/api/v1/submissions/${id}/events`, {
          headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
          ...withSignal(signal),
        });
        if (!response.ok || !response.body)
          throw await this.failure(response, 'verdict stream failed');
        for await (const state of readSubmissionEvents(response.body)) {
          onState(state);
          if (state.state === 'finished') return state;
        }
      } catch (error) {
        if (signal?.aborted) throw error;
      }

      // The database is authoritative. This read recovers a terminal verdict
      // even when the SSE connection dropped after the server persisted it.
      const current = await this.json<SubmissionResponse>(
        `/api/v1/submissions/${id}`,
        { ...withSignal(signal) },
        token,
      );
      onState(current);
      if (current.state === 'finished') return current;
      await delay(500, signal);
    }
    throw new DOMException('submission cancelled', 'AbortError');
  }

  private async json<T>(path: string, init: RequestInit, token?: string): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('content-type', 'application/json');
    if (token) headers.set('authorization', `Bearer ${token}`);
    const response = await this.fetcher(`${this.apiBase}${path}`, { ...init, headers });
    if (!response.ok) throw await this.failure(response, 'Rustly API request failed');
    return (await response.json()) as T;
  }

  private async failure(response: Response, fallback: string): Promise<SubmissionUnavailable> {
    try {
      const body = (await response.json()) as ApiErrorBody;
      return new SubmissionUnavailable(body.message || fallback);
    } catch {
      return new SubmissionUnavailable(fallback);
    }
  }
}

async function* readSubmissionEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<SubmissionState> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done }).replace(/\r\n/g, '\n');
      let boundary = pending.indexOf('\n\n');
      while (boundary >= 0) {
        const block = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield JSON.parse(data) as SubmissionState;
        boundary = pending.indexOf('\n\n');
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('submission cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}

function withSignal(signal?: AbortSignal): Pick<RequestInit, 'signal'> | Record<string, never> {
  return signal ? { signal } : {};
}

/** Whether a verdict means the submitter did something wrong. */
export function isUserFault(verdict: Verdict): boolean {
  return ['CE', 'WA', 'TLE', 'MLE', 'OLE', 'RTE', 'SE'].includes(verdict);
}

/**
 * Whether a verdict is our failure rather than theirs.
 *
 * `JE` and `IE` mean the platform could not judge the submission. Showing those
 * as a wrong answer would blame someone for our outage, and they would have no
 * way to act on it.
 */
export function isSystemFault(verdict: Verdict): boolean {
  return verdict === 'JE' || verdict === 'IE';
}

/** A short, honest description of a verdict. */
export function describeVerdict(verdict: Verdict): { label: string; detail: string } {
  switch (verdict) {
    case 'AC':
      return { label: 'Accepted', detail: 'Every test passed.' };
    case 'CE':
      return { label: 'Compile error', detail: 'The submission did not compile.' };
    case 'WA':
      return { label: 'Wrong answer', detail: 'A test produced output that did not match.' };
    case 'TLE':
      return {
        label: 'Time limit exceeded',
        detail: 'The program did not finish inside its budget.',
      };
    case 'MLE':
      return {
        label: 'Memory limit exceeded',
        detail: 'The program asked for more memory than allowed.',
      };
    case 'OLE':
      return { label: 'Output limit exceeded', detail: 'The program printed more than allowed.' };
    case 'RTE':
      return { label: 'Runtime error', detail: 'The program panicked or exited non-zero.' };
    case 'SE':
      return { label: 'Security policy', detail: 'The submission tripped a sandbox policy.' };
    case 'JE':
    case 'IE':
      return {
        label: 'We could not judge this',
        detail: 'Something on our side failed. Your submission is fine; please try again.',
      };
  }
}

/** A client-generated idempotency key, so a retry cannot double-submit. */
export function idempotencyKey(trial: string, source: string): string {
  // A stable digest of the attempt: resubmitting identical source for the same
  // Trial replays the original submission rather than creating a second one.
  let hash = 0x811c9dc5;
  const material = `${trial} ${source}`;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const prefix = trial.slice(0, 96);
  return `${prefix}-${hash.toString(16).padStart(8, '0')}`;
}

/** A step in the visible progress of a submission. */
export function describeState(state: SubmissionState): string {
  switch (state.state) {
    case 'queued':
      return 'Queued';
    case 'dispatched':
      return 'Picked up by a judge worker';
    case 'compiling':
      return 'Compiling';
    case 'running':
      return `Running tests (${state.completed}/${state.total})`;
    case 'finished':
      return describeVerdict(state.verdict).label;
  }
}
