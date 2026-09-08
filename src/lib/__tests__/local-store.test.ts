import { describe, expect, it } from 'vitest';
import {
  acknowledgeCheckpoint,
  buildCheckpoint,
  clearDraft,
  createStore,
  deviceId,
  loadDraft,
  MAX_ENTRIES_PER_BATCH,
  pendingEntries,
  readProgress,
  recordProgress,
  saveDraft,
  type KeyValueStore,
} from '../local-store';

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
  };
}

describe('drafts', () => {
  it('round-trips a draft', () => {
    const store = memoryStore();
    saveDraft(store, 'trial:x', 'fn main() {}');
    expect(loadDraft(store, 'trial:x')?.source).toBe('fn main() {}');
  });

  it('returns null for a slot that was never written', () => {
    expect(loadDraft(memoryStore(), 'trial:missing')).toBeNull();
  });

  it('discards corrupt local data rather than surfacing it', () => {
    const store = memoryStore();
    store.set('rustly:draft:trial:x', 'not json at all');
    expect(loadDraft(store, 'trial:x')).toBeNull();

    store.set('rustly:draft:trial:y', JSON.stringify({ source: 42 }));
    expect(loadDraft(store, 'trial:y')).toBeNull();
  });

  it('clears a draft when the reader resets', () => {
    const store = memoryStore();
    saveDraft(store, 'trial:x', 'code');
    clearDraft(store, 'trial:x');
    expect(loadDraft(store, 'trial:x')).toBeNull();
  });

  it('keeps drafts for different slots separate', () => {
    const store = memoryStore();
    saveDraft(store, 'a', 'first');
    saveDraft(store, 'b', 'second');
    expect(loadDraft(store, 'a')?.source).toBe('first');
    expect(loadDraft(store, 'b')?.source).toBe('second');
  });
});

describe('progress', () => {
  it('never regresses, even if a caller asks it to', () => {
    const store = memoryStore();
    recordProgress(store, 'learn/ownership', 'completed');
    recordProgress(store, 'learn/ownership', 'started');
    expect(readProgress(store)['learn/ownership']?.completion).toBe('completed');
  });

  it('advances to a deeper completion', () => {
    const store = memoryStore();
    recordProgress(store, 'k', 'started');
    recordProgress(store, 'k', 'mastered');
    expect(readProgress(store)['k']?.completion).toBe('mastered');
  });

  it('increments the revision on every record, so the server can order them', () => {
    const store = memoryStore();
    expect(recordProgress(store, 'k', 'started').revision).toBe(1);
    expect(recordProgress(store, 'k', 'completed').revision).toBe(2);
  });

  it('mints a stable device id once', () => {
    const store = memoryStore();
    const first = deviceId(store);
    expect(deviceId(store)).toBe(first);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('checkpoints', () => {
  it('is null when there is nothing to send, so no request is made', () => {
    expect(buildCheckpoint(memoryStore())).toBeNull();
  });

  it('batches many recordings into one payload', () => {
    const store = memoryStore();
    for (let i = 0; i < 10; i += 1) recordProgress(store, `key-${i}`, 'completed');

    const checkpoint = buildCheckpoint(store);
    expect(checkpoint?.entries).toHaveLength(10);
    expect(checkpoint?.format_version).toBe(1);
  });

  it('keeps only the newest entry per key, because progress is monotonic', () => {
    const store = memoryStore();
    recordProgress(store, 'k', 'started');
    recordProgress(store, 'k', 'completed');

    const checkpoint = buildCheckpoint(store);
    expect(checkpoint?.entries).toHaveLength(1);
    expect(checkpoint?.entries[0]?.completion).toBe('completed');
  });

  it('stays inside the batch limit no matter how long the reader was offline', () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_ENTRIES_PER_BATCH + 50; i += 1) {
      recordProgress(store, `key-${i}`, 'completed');
    }
    expect(pendingEntries(store).length).toBeLessThanOrEqual(MAX_ENTRIES_PER_BATCH);
    expect(buildCheckpoint(store)?.entries.length).toBeLessThanOrEqual(MAX_ENTRIES_PER_BATCH);
  });

  it('clears only what was acknowledged', () => {
    const store = memoryStore();
    recordProgress(store, 'a', 'completed');
    const sent = buildCheckpoint(store);
    expect(sent).not.toBeNull();

    // Something happens while the request is in flight.
    recordProgress(store, 'b', 'completed');
    acknowledgeCheckpoint(store, sent!);

    const remaining = pendingEntries(store);
    expect(remaining.map((e) => e.key)).toEqual(['b']);
  });

  it('empties the queue when everything is acknowledged', () => {
    const store = memoryStore();
    recordProgress(store, 'a', 'completed');
    const sent = buildCheckpoint(store)!;
    acknowledgeCheckpoint(store, sent);
    expect(pendingEntries(store)).toHaveLength(0);
  });
});

describe('storage degradation', () => {
  it('always returns a working store, even with no browser storage', () => {
    const store = createStore();
    store.set('probe', 'value');
    expect(store.get('probe')).toBe('value');
    store.remove('probe');
    expect(store.get('probe')).toBeNull();
  });
});
