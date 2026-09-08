/**
 * Reading the vendored content snapshot at build time.
 *
 * Everything here runs during `astro build` and produces static HTML. None of
 * it ships to the browser, and none of it requires a running API — that is
 * invariant A (static-first) enforced by the build rather than by intent.
 */

/** Difficulty tiers, matching the control plane's vocabulary. */
export type Difficulty = 'intro' | 'easy' | 'medium' | 'hard' | 'expert';

/** Topic tags. */
export type Topic =
  | 'ownership'
  | 'borrowing'
  | 'lifetimes'
  | 'traits'
  | 'enums'
  | 'collections'
  | 'errors'
  | 'concurrency'
  | 'unsafe'
  | 'tooling';

/** Editorial state. */
export type Lifecycle = 'draft' | 'beta' | 'verified' | 'official';

/** What a runnable example is expected to do. */
export type ExpectedOutcome =
  { kind: 'runs'; stdout: string } | { kind: 'compiles' } | { kind: 'compile_error'; code: string };

/** A runnable example inside a lesson. */
export interface Example {
  id: string;
  caption: string;
  code: string;
  expect: ExpectedOutcome;
}

/** What a binding is doing at a point in a program. */
export type BindingState =
  'owns' | 'moved' | 'borrowed_shared' | 'borrowed_unique' | 'dropped' | 'uninitialised';

/** A named binding's state at one visualisation step. */
export interface Binding {
  name: string;
  state: BindingState;
}

/** One step of a mental-model visualisation. */
export interface VisualisationStep {
  line: number;
  note: string;
  bindings: Binding[];
}

/** An authored mental-model visualisation. */
export interface Visualisation {
  kind: 'ownership' | 'borrows' | 'lifetimes';
  code: string;
  steps: VisualisationStep[];
}

/** A citation. */
export interface Reference {
  title: string;
  url: string;
}

/** A lesson. */
export interface Lesson {
  format_version: number;
  id: string;
  title: string;
  summary: string;
  topics: Topic[];
  lifecycle: Lifecycle;
  body: string;
  visualisation?: Visualisation;
  examples: Example[];
  quizzes: string[];
  cheatsheets: string[];
  oss_examples: string[];
  trials: string[];
  references: Reference[];
}

/** A learning path. */
export interface LearningPath {
  format_version: number;
  id: string;
  title: string;
  summary: string;
  topics: Topic[];
  lifecycle: Lifecycle;
  lessons: string[];
  prerequisites: string[];
}

/** One quiz answer option. */
export interface QuizOption {
  text: string;
  correct: boolean;
  why_wrong?: string;
}

/** A micro quiz. */
export interface Quiz {
  format_version: number;
  id: string;
  lesson: string;
  prompt: string;
  code?: string;
  options: QuizOption[];
  explanation: string;
}

/** One cheatsheet entry. */
export interface CheatsheetEntry {
  want: string;
  code: string;
  note?: string;
}

/** A cheatsheet. */
export interface Cheatsheet {
  format_version: number;
  id: string;
  title: string;
  summary: string;
  topics: Topic[];
  lifecycle: Lifecycle;
  entries: CheatsheetEntry[];
}

/** A curated open-source example. */
export interface OssExample {
  format_version: number;
  id: string;
  caption: string;
  repository: string;
  commit: string;
  path: string;
  line_start: number;
  line_end: number;
  license: string;
  attribution: string;
  topics: Topic[];
  simplified?: string;
}

/** A Trial test case. */
export interface TestCase {
  id: string;
  stdin: string;
  expected_stdout: string;
}

/** A Trial. */
export interface Trial {
  format_version: number;
  slug: string;
  title: string;
  summary: string;
  difficulty: Difficulty;
  topics: Topic[];
  lifecycle: Lifecycle;
  version: number;
  statement: string;
  starter: string;
  starter_expect: ExpectedOutcome;
  tests: TestCase[];
}

/** A Trial with its prose and starter code already read from disk. */
export interface TrialWithFiles extends Trial {
  statementMarkdown: string;
  starterCode: string;
  /** Learner-visible tests bundled with the public content snapshot. */
  publicTests: TestCase[];
}

/** A lesson with its Markdown body already read from disk. */
export interface LessonWithBody extends Lesson {
  bodyMarkdown: string;
}

/** Provenance of the vendored content snapshot. */
export interface Snapshot {
  source: string;
  ref: string;
  revision: string;
  vendored_at: string;
}

// `import.meta.glob` must appear literally: Vite rewrites this syntax into a
// static import map at build time. Assigning it to a variable first produces a
// runtime "not a function" error rather than a compile error, which is a
// singularly unhelpful way to find out.
const json = import.meta.glob<{ default: unknown }>('../data/content/**/*.json', { eager: true });
const raw = import.meta.glob<string>('../data/content/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const rust = import.meta.glob<string>('../data/content/**/*.rs', {
  eager: true,
  query: '?raw',
  import: 'default',
});

function load<T>(predicate: (path: string) => boolean): T[] {
  return Object.entries(json)
    .filter(([path]) => predicate(path))
    .map(([, module]) => module.default as T);
}

function text(source: Record<string, string>, suffix: string): string {
  const entry = Object.entries(source).find(([path]) => path.endsWith(suffix));
  if (!entry) throw new Error(`missing content file: ${suffix}`);
  return entry[1];
}

/** Every learning path, in id order. */
export function learningPaths(): LearningPath[] {
  return load<LearningPath>((p) => p.endsWith('path.json')).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/** Every lesson, in id order. */
export function lessons(): Lesson[] {
  return load<Lesson>((p) => p.includes('/learn/') && !p.endsWith('path.json')).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/** Every quiz. */
export function quizzes(): Quiz[] {
  return load<Quiz>((p) => p.includes('/quizzes/'));
}

/** Every cheatsheet. */
export function cheatsheets(): Cheatsheet[] {
  return load<Cheatsheet>((p) => p.includes('/cheatsheets/')).sort((a, b) =>
    a.id.localeCompare(b.id),
  );
}

/** Every curated OSS example. */
export function ossExamples(): OssExample[] {
  return load<OssExample>((p) => p.includes('/oss/'));
}

/** Every Trial. */
export function trials(): Trial[] {
  return load<Trial>((p) => p.endsWith('trial.json')).sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Snapshot provenance, so a page can say exactly which content it was built from. */
export function snapshot(): Snapshot {
  return load<Snapshot>((p) => p.endsWith('SNAPSHOT.json'))[0] as Snapshot;
}

/** A lesson with its Markdown body. */
export function lessonWithBody(id: string): LessonWithBody {
  const lesson = lessons().find((l) => l.id === id);
  if (!lesson) throw new Error(`unknown lesson: ${id}`);
  return { ...lesson, bodyMarkdown: text(raw, `/${lesson.body}`) };
}

/**
 * A Trial with its statement and starter code.
 *
 * Trusted evaluation is absent from the public content repository. Everything
 * loaded here is learner-visible by construction.
 */
export function trialWithFiles(slug: string): TrialWithFiles {
  const trial = trials().find((t) => t.slug === slug);
  if (!trial) throw new Error(`unknown Trial: ${slug}`);
  return {
    ...trial,
    statementMarkdown: text(raw, `/trials/${slug}/${trial.statement}`),
    starterCode: text(rust, `/trials/${slug}/${trial.starter}`),
    publicTests: trial.tests,
  };
}

/** Quizzes belonging to a lesson, in the order the lesson lists them. */
export function quizzesFor(lesson: Lesson): Quiz[] {
  const all = quizzes();
  return lesson.quizzes
    .map((id) => all.find((q) => q.id === id))
    .filter((q): q is Quiz => q !== undefined);
}

/** Cheatsheets a lesson wants shown alongside it. */
export function cheatsheetsFor(lesson: Lesson): Cheatsheet[] {
  const all = cheatsheets();
  return lesson.cheatsheets
    .map((id) => all.find((c) => c.id === id))
    .filter((c): c is Cheatsheet => c !== undefined);
}

/** OSS examples a lesson wants shown alongside it. */
export function ossExamplesFor(lesson: Lesson): OssExample[] {
  const all = ossExamples();
  return lesson.oss_examples
    .map((id) => all.find((o) => o.id === id))
    .filter((o): o is OssExample => o !== undefined);
}

/** A permalink to an OSS example's exact lines at its pinned commit. */
export function permalink(example: OssExample): string {
  return `https://github.com/${example.repository}/blob/${example.commit}/${example.path}#L${example.line_start}-L${example.line_end}`;
}

/** Published content only. Drafts are never built into the site. */
export function isPublished(lifecycle: Lifecycle): boolean {
  return lifecycle !== 'draft';
}
