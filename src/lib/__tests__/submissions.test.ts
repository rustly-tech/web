import { describe, expect, it } from 'vitest';
import {
  describeState,
  describeVerdict,
  idempotencyKey,
  isSystemFault,
  isUserFault,
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
