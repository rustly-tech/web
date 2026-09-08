#!/usr/bin/env node
/**
 * Invariant checks against the built site.
 *
 * These are the properties that are easy to state and easy to lose: a
 * refactor that switches a page to client-side fetching, a template that
 * accidentally renders the whole Trial object, a heading dropped during a
 * redesign. None of them produce a type error, and all of them matter.
 *
 * Run against `dist/` after `astro build`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const DIST = 'dist';
const failures = [];
const notes = [];

function fail(message) {
  failures.push(message);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(DIST);
const html = files.filter((f) => f.endsWith('.html'));
const js = files.filter((f) => f.endsWith('.js'));

if (html.length === 0) fail('no HTML was built');

// --- Hidden test material must never reach a build artifact ------------------
//
// Everything in the vendored snapshot and dist/ is public by definition.
// Trusted evaluation must be absent at the source boundary, rather than
// filtered during a browser build.
const trialFiles = walk('src/data/content/trials').filter((f) => f.endsWith('trial.json'));
for (const file of trialFiles) {
  const trial = JSON.parse(readFileSync(file, 'utf8'));
  if ('reference_solution' in trial)
    fail(`${trial.slug}: public manifest names a reference solution`);
  if (trial.tests.some((test) => test.visibility === 'hidden'))
    fail(`${trial.slug}: public manifest contains a hidden test`);
  const solution = join(file, '..', 'solution.rs');
  if (existsSync(solution)) fail(`${trial.slug}: public snapshot contains solution.rs`);
}

// --- Static-first ------------------------------------------------------------
//
// A lesson must be readable with the API unreachable, which means its prose has
// to be in the HTML rather than fetched.
const lessonPage = html.find((f) => f.includes('learn/ownership/move-semantics'));
if (!lessonPage) {
  fail('the ownership lesson was not built');
} else {
  const body = readFileSync(lessonPage, 'utf8');
  for (const phrase of ['Every value in Rust has exactly one owner', 'E0382']) {
    if (!body.includes(phrase)) fail(`the lesson page does not contain its own prose: ${phrase}`);
  }
}

const trialPage = html.find((f) => f.includes('trials/ownership-move-or-borrow'));
if (!trialPage) {
  fail('the ownership Trial was not built');
} else {
  const body = readFileSync(trialPage, 'utf8');
  if (!body.includes('summarise')) fail('the Trial page does not contain its own statement');
  if (!body.includes('public-hello-world'))
    fail('public tests are not rendered into the Trial page');
}

// --- Accessibility floor -----------------------------------------------------
for (const file of html) {
  const body = readFileSync(file, 'utf8');
  const where = relative(DIST, file);

  if (!/<html[^>]+lang=/.test(body)) fail(`${where}: <html> has no lang attribute`);
  if (!/<title>[^<]+<\/title>/.test(body)) fail(`${where}: no page title`);
  if (!/<h1[^>]*>/.test(body)) fail(`${where}: no h1`);
  if (!body.includes('class="skip-link"')) fail(`${where}: no skip link`);
  if (!/<meta name="viewport"/.test(body)) fail(`${where}: no viewport meta`);

  // An image without alt text is invisible to a screen reader.
  const images = body.match(/<img\b[^>]*>/g) ?? [];
  for (const image of images) {
    if (!/\balt=/.test(image)) fail(`${where}: an <img> has no alt attribute`);
  }
}

// --- Weight ------------------------------------------------------------------
//
// Monaco is large and deliberately lazy. What matters is that a reader who only
// reads a lesson does not pay for it.
const lessonBytes = lessonPage ? statSync(lessonPage).size : 0;
notes.push(`lesson page HTML: ${(lessonBytes / 1024).toFixed(1)} KiB`);
if (lessonBytes > 200 * 1024) {
  fail(
    `the lesson page HTML is ${(lessonBytes / 1024).toFixed(0)} KiB, which is too heavy for prose`,
  );
}

const monacoChunks = js.filter((f) => f.includes('monaco') || f.includes('.worker'));
notes.push(`monaco chunks: ${monacoChunks.length}`);
if (lessonPage) {
  const body = readFileSync(lessonPage, 'utf8');
  const eager = monacoChunks.filter((chunk) => {
    const name = chunk.split('/').pop();
    return name !== undefined && body.includes(name) && !body.includes(`import("${name}`);
  });
  // Monaco must arrive through a dynamic import when the editor mounts, never
  // as a blocking script on a page someone is only reading.
  for (const chunk of eager) {
    if (new RegExp(`<script[^>]+src="[^"]*${chunk.split('/').pop()}"`).test(body)) {
      fail(`the lesson page loads ${relative(DIST, chunk)} eagerly; Monaco must stay lazy`);
    }
  }
}

const total = files.reduce((sum, f) => sum + statSync(f).size, 0);
notes.push(`total dist: ${(total / 1024 / 1024).toFixed(1)} MiB across ${files.length} files`);

// --- Report ------------------------------------------------------------------
for (const note of notes) console.log(`note: ${note}`);
if (failures.length > 0) {
  console.error('');
  for (const failure of failures) console.error(`error: ${failure}`);
  console.error(`\n${failures.length} build invariant(s) violated`);
  process.exit(1);
}
console.log(`\nok: ${html.length} page(s) satisfy every build invariant`);
