/**
 * Local-first persistence.
 *
 * Invariants B and C: drafts, quiz answers, and editor state live in the
 * browser first and reach the control plane only as compact, batched
 * checkpoints. Nothing here sends a request per keystroke, per quiz click, or
 * per local Run — and the batching is not a politeness, it is the mechanism
 * that keeps the API light enough to run on a free tier.
 *
 * Storage degrades rather than failing: IndexedDB where available, otherwise
 * `localStorage`, otherwise memory for the session. A reader in a private
 * window still gets a working editor; they just do not get their draft back
 * tomorrow.
 */

/** How complete a unit of learning is. Ordered; merging takes the maximum. */
export type Completion = 'not_started' | 'started' | 'completed' | 'mastered';

const COMPLETION_ORDER: Record<Completion, number> = {
  not_started: 0,
  started: 1,
  completed: 2,
  mastered: 3,
};

/** Checkpoint wire-format version, matching the control plane. */
export const CHECKPOINT_FORMAT_VERSION = 1;

/** Maximum entries the API accepts in one batch. */
export const MAX_ENTRIES_PER_BATCH = 256;

/** One progress entry. */
export interface ProgressEntry {
  key: string;
  revision: number;
  completion: Completion;
  recorded_at: string;
}

/** A batch of checkpoints, exactly as the API expects it. */
export interface Checkpoint {
  format_version: number;
  device: string;
  entries: ProgressEntry[];
}

/** The minimal storage surface, so the backend can degrade. */
export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();
  get(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  remove(key: string): void {
    this.map.delete(key);
  }
}

class WebStorageStore implements KeyValueStore {
  constructor(private readonly storage: Storage) {}
  get(key: string): string | null {
    try {
      return this.storage.getItem(key);
    } catch {
      return null;
    }
  }
  set(key: string, value: string): void {
    try {
      this.storage.setItem(key, value);
    } catch {
      // A full or blocked quota must not break the editor.
    }
  }
  remove(key: string): void {
    try {
      this.storage.removeItem(key);
    } catch {
      // Ignore.
    }
  }
}

/** Pick the best available store. */
export function createStore(): KeyValueStore {
  if (typeof globalThis.localStorage !== 'undefined') {
    try {
      const probe = '__rustly_probe__';
      globalThis.localStorage.setItem(probe, '1');
      globalThis.localStorage.removeItem(probe);
      return new WebStorageStore(globalThis.localStorage);
    } catch {
      // Private browsing, or storage disabled.
    }
  }
  return new MemoryStore();
}

const DRAFT_PREFIX = 'rustly:draft:';
const PROGRESS_KEY = 'rustly:progress';
const DEVICE_KEY = 'rustly:device';
const PENDING_KEY = 'rustly:pending-checkpoints';

/** A saved editor draft. */
export interface Draft {
  source: string;
  savedAt: string;
}

/** Persist a draft for a Trial or playground slot. */
export function saveDraft(store: KeyValueStore, slot: string, source: string): void {
  const draft: Draft = { source, savedAt: new Date().toISOString() };
  store.set(DRAFT_PREFIX + slot, JSON.stringify(draft));
}

/** Read a saved draft, if any. */
export function loadDraft(store: KeyValueStore, slot: string): Draft | null {
  const raw = store.get(DRAFT_PREFIX + slot);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.source !== 'string' || typeof parsed.savedAt !== 'string') return null;
    return { source: parsed.source, savedAt: parsed.savedAt };
  } catch {
    // Corrupt local data is discarded, not surfaced. The starter code is right
    // there, so there is nothing to recover and nothing to explain.
    return null;
  }
}

/** Forget a draft, e.g. when the reader resets to the starter code. */
export function clearDraft(store: KeyValueStore, slot: string): void {
  store.remove(DRAFT_PREFIX + slot);
}

/** A stable per-device identifier, minted on first use. */
export function deviceId(store: KeyValueStore): string {
  const existing = store.get(DEVICE_KEY);
  if (existing !== null && existing.length > 0) return existing;
  const minted = crypto.randomUUID();
  store.set(DEVICE_KEY, minted);
  return minted;
}

/** Record local progress for a content key. Monotonic: it never regresses. */
export function recordProgress(
  store: KeyValueStore,
  key: string,
  completion: Completion,
): ProgressEntry {
  const all = readProgress(store);
  const existing = all[key];
  const entry: ProgressEntry = {
    key,
    revision: (existing?.revision ?? 0) + 1,
    completion:
      existing && COMPLETION_ORDER[existing.completion] > COMPLETION_ORDER[completion]
        ? existing.completion
        : completion,
    recorded_at: new Date().toISOString(),
  };
  all[key] = entry;
  store.set(PROGRESS_KEY, JSON.stringify(all));
  queueCheckpoint(store, entry);
  return entry;
}

/** All locally recorded progress. */
export function readProgress(store: KeyValueStore): Record<string, ProgressEntry> {
  const raw = store.get(PROGRESS_KEY);
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as Record<string, ProgressEntry>;
  } catch {
    return {};
  }
}

/** Add an entry to the pending checkpoint batch. */
function queueCheckpoint(store: KeyValueStore, entry: ProgressEntry): void {
  const pending = pendingEntries(store).filter((e) => e.key !== entry.key);
  pending.push(entry);
  // Bounded: if a reader works offline for a long time we keep the most recent
  // entries rather than growing without limit. Progress is monotonic, so the
  // newest entry for a key already subsumes the older ones.
  const trimmed = pending.slice(-MAX_ENTRIES_PER_BATCH);
  store.set(PENDING_KEY, JSON.stringify(trimmed));
}

/** Entries waiting to be synced. */
export function pendingEntries(store: KeyValueStore): ProgressEntry[] {
  const raw = store.get(PENDING_KEY);
  if (raw === null) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ProgressEntry[]) : [];
  } catch {
    return [];
  }
}

/** Build a checkpoint batch, or `null` when there is nothing to send. */
export function buildCheckpoint(store: KeyValueStore): Checkpoint | null {
  const entries = pendingEntries(store);
  if (entries.length === 0) return null;
  return {
    format_version: CHECKPOINT_FORMAT_VERSION,
    device: deviceId(store),
    entries: entries.slice(0, MAX_ENTRIES_PER_BATCH),
  };
}

/**
 * Drop entries the server has accepted.
 *
 * Only the entries actually sent are cleared, so anything recorded while the
 * request was in flight survives.
 */
export function acknowledgeCheckpoint(store: KeyValueStore, sent: Checkpoint): void {
  const sentKeys = new Set(sent.entries.map((e) => `${e.key}@${e.revision}`));
  const remaining = pendingEntries(store).filter((e) => !sentKeys.has(`${e.key}@${e.revision}`));
  if (remaining.length === 0) store.remove(PENDING_KEY);
  else store.set(PENDING_KEY, JSON.stringify(remaining));
}
