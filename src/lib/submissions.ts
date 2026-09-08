/**
 * The submission contract, exactly as the control plane defines it.
 *
 * The request carries a **content identifier**, never source. The client writes
 * its source to the data plane first and submits the resulting CID, so a
 * submission of any size never travels through the control-plane API
 * (invariant D). The API's 64 KiB body limit enforces that from the other side.
 */

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
  idempotency_key: string;
}

/** The submission resource. */
export interface SubmissionResponse {
  submission_id: string;
  job_id: string;
  trial: string;
  trial_version: number;
  created_at: string;
  idempotent_replay: boolean;
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
