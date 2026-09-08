import { describe, expect, it } from 'vitest';
import { explain, explainedCodes } from '../explain';

describe('explain', () => {
  it('explains the ownership error the first lesson teaches', () => {
    const explanation = explain('E0382');
    expect(explanation).not.toBeNull();
    expect(explanation?.summary).toContain('one owner');
    expect(explanation?.reference).toBe('https://doc.rust-lang.org/error_codes/E0382.html');
  });

  it('offers borrowing before cloning, in that order', () => {
    const fixes = explain('E0382')?.fixes ?? [];
    const borrow = fixes.findIndex((f) => f.toLowerCase().includes('borrow'));
    const clone = fixes.findIndex((f) => f.toLowerCase().includes('clone'));
    expect(borrow).toBeGreaterThanOrEqual(0);
    expect(clone).toBeGreaterThan(borrow);
  });

  it('returns null rather than restating an error it cannot improve on', () => {
    expect(explain('E9999')).toBeNull();
    expect(explain(undefined)).toBeNull();
  });

  it('gives every explanation a summary, at least one fix, and a reference', () => {
    for (const code of explainedCodes()) {
      const explanation = explain(code);
      expect(explanation, code).not.toBeNull();
      expect(explanation!.summary.length, code).toBeGreaterThan(20);
      expect(explanation!.fixes.length, code).toBeGreaterThan(0);
      expect(explanation!.reference, code).toContain('doc.rust-lang.org');
    }
  });

  it('never tells the reader to simply clone', () => {
    for (const code of explainedCodes()) {
      const fixes = explain(code)!.fixes;
      // A single "just clone it" fix would teach a habit rather than a model.
      if (fixes.length === 1) {
        expect(fixes[0]!.toLowerCase(), code).not.toContain('clone');
      }
    }
  });
});
