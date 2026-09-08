/**
 * Human explanations for compiler diagnostics.
 *
 * # The rule
 *
 * An explanation is shown **alongside** the raw diagnostic, never instead of
 * it. Learning to read real `rustc` output is one of the things Rustly exists
 * to teach; replacing it with a friendlier paraphrase would produce learners
 * who are helpless the first time they meet a compiler without us.
 *
 * When we have nothing useful to add, we say so and get out of the way. A
 * generic restatement of the error is worse than silence, because it looks like
 * help.
 */

/** A human explanation of one diagnostic. */
export interface Explanation {
  /** One sentence: what the compiler is actually objecting to. */
  summary: string;
  /** What to consider doing, in the order to consider it. */
  fixes: string[];
  /** Link to the official error index entry, when there is one. */
  reference?: string;
}

const EXPLANATIONS: Record<string, Explanation> = {
  E0382: {
    summary:
      'A value was moved to a new owner, and then used through the old name. Rust allows exactly one owner, so the old name stopped being usable at the move.',
    fixes: [
      'Borrow instead: if the second user only reads the value, take `&T` or `&str`.',
      'Clone, if you genuinely need two independent values. It costs an allocation, and writing it makes that cost visible.',
      'Restructure: often the move is telling you two pieces of code both want to own one thing, and only one should.',
    ],
    reference: 'https://doc.rust-lang.org/error_codes/E0382.html',
  },
  E0502: {
    summary:
      'A unique borrow overlapped a shared one. While something is being read, nothing may modify it.',
    fixes: [
      'Narrow the scope of the shared borrow so it ends before the mutation begins.',
      'Finish reading into an owned value first, then mutate.',
      'Use an index or a split borrow so the two borrows touch different parts.',
    ],
    reference: 'https://doc.rust-lang.org/error_codes/E0502.html',
  },
  E0499: {
    summary: 'The same value was borrowed mutably twice at once. Only one unique borrow may exist.',
    fixes: [
      'End the first borrow before starting the second — often a smaller block is enough.',
      'Use `split_at_mut` or an equivalent when you need two disjoint pieces.',
    ],
    reference: 'https://doc.rust-lang.org/error_codes/E0499.html',
  },
  E0308: {
    summary: 'The type found is not the type expected at that position.',
    fixes: [
      'Read the "expected ... found ..." line carefully — it names both types exactly.',
      'A missing `&`, a stray `*`, or a `String` where a `&str` was wanted are the usual causes.',
      'If a conversion is genuinely needed, `.to_string()`, `.as_str()`, or `.into()` are the usual tools.',
    ],
    reference: 'https://doc.rust-lang.org/error_codes/E0308.html',
  },
  E0106: {
    summary:
      'A reference in a signature has no lifetime, and the compiler cannot infer which input it borrows from.',
    fixes: [
      'Name a lifetime and tie the output to the input it actually borrows from.',
      'Return an owned value instead, if the function is really producing something new.',
    ],
    reference: 'https://doc.rust-lang.org/error_codes/E0106.html',
  },
  E0596: {
    summary: 'A mutable borrow was taken of something that is not declared mutable.',
    fixes: [
      'Declare the binding `let mut`.',
      'Take `&mut` in the signature if the function must modify it.',
    ],
    reference: 'https://doc.rust-lang.org/error_codes/E0596.html',
  },
  E0601: {
    summary: 'The crate has no `main` function, so there is nothing to run.',
    fixes: ['Add `fn main() { ... }`.'],
    reference: 'https://doc.rust-lang.org/error_codes/E0601.html',
  },
};

/**
 * Explain a diagnostic code, or `null` when we have nothing useful to add.
 *
 * Returning `null` is a feature. The interface renders the raw diagnostic alone
 * rather than padding it with a restatement.
 */
export function explain(code: string | undefined): Explanation | null {
  if (code === undefined) return null;
  return EXPLANATIONS[code] ?? null;
}

/** Every code we can explain, for tests and for a coverage report. */
export function explainedCodes(): string[] {
  return Object.keys(EXPLANATIONS).sort();
}
