#!/usr/bin/env node
/**
 * Vendor a snapshot of `rustly-tech/content` into `src/data/`.
 *
 * The web application is static-first, so content is compiled *into* the build
 * rather than fetched at runtime. Vendoring the snapshot keeps the build
 * hermetic and offline-capable: `pnpm build` never reaches the network, and CI
 * never fails because another repository is momentarily unavailable.
 *
 * Refresh it deliberately, review the diff, and commit it:
 *
 *   node scripts/sync-content.mjs ../content
 *   node scripts/sync-content.mjs https://github.com/rustly-tech/content <ref>
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const source = process.argv[2] ?? '../content';
const ref = process.argv[3] ?? 'main';
const destination = resolve('src/data/content');

/** Resolve the source to a local directory, cloning if it is a URL. */
function materialise() {
  if (!source.startsWith('http')) {
    return { root: resolve(source), cleanup: () => {} };
  }
  const scratch = mkdtempSync(join(tmpdir(), 'rustly-content-'));
  execFileSync('git', ['clone', '--depth', '1', '--branch', ref, source, scratch], {
    stdio: 'inherit',
  });
  return { root: scratch, cleanup: () => rmSync(scratch, { recursive: true, force: true }) };
}

const { root, cleanup } = materialise();
try {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  cpSync(join(root, 'content'), destination, { recursive: true });

  let revision = 'unknown';
  try {
    revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // A source without git history is fine for local development.
  }

  // Record exactly what was vendored. A snapshot with no provenance is a fork
  // nobody remembers making.
  writeFileSync(
    join(destination, 'SNAPSHOT.json'),
    `${JSON.stringify({ source, ref, revision, vendored_at: new Date().toISOString() }, null, 2)}\n`,
  );

  const count = (dir) =>
    readdirSync(dir, { withFileTypes: true, recursive: true }).filter(
      (e) => e.isFile() && e.name.endsWith('.json'),
    ).length;

  console.log(
    `vendored ${count(destination)} document(s) from ${source} @ ${revision.slice(0, 8)}`,
  );

  // Fail loudly if the snapshot is obviously incomplete, rather than shipping a
  // site with no lessons.
  const trials = readdirSync(join(destination, 'trials'), { withFileTypes: true }).filter((e) =>
    e.isDirectory(),
  );
  if (trials.length === 0) throw new Error('the snapshot contains no Trials');
  const learn = readFileSync(join(destination, 'learn/ownership/path.json'), 'utf8');
  if (!learn.includes('"lessons"')) throw new Error('the ownership path looks malformed');
} finally {
  cleanup();
}
