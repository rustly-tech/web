# Web architecture

## Why static

`output: 'static'`. Every Learn, Trial, and cheatsheet page is HTML on a CDN.

This is invariant A, and making it structural rather than aspirational is the
point: with no server there is nothing for a page to accidentally start
depending on. A reader on a bad connection, or with our API down, still gets the
lesson.

## Islands

React is present for interactivity only. A page that is not interactive ships no
JavaScript.

| Island                | Hydration                                              | Why                                            |
| --------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| `OwnershipVisualiser` | `client:visible`                                       | Below the fold; hydrate when reached           |
| `PredictQuiz`         | `client:visible`                                       | Same                                           |
| `Workspace`           | `client:load` on a Trial, `client:visible` in a lesson | On a Trial page it is the reason you came      |
| `Editor` (Monaco)     | dynamic `import()` inside `Workspace`                  | Large; a reader of prose must never pay for it |

`scripts/check-build.mjs` fails the build if Monaco appears as a blocking script
on the lesson page.

## Content

Vendored at build time from `rustly-tech/content` and read through
`import.meta.glob`, which Vite rewrites into a static import map. Nothing is
fetched at runtime.

`trialWithFiles()` strips hidden tests **at the loader**, not in the template,
and shadows the `tests` field with the public subset so a template cannot reach
the hidden cases even by accident. `check-build.mjs` then greps the built output
for every hidden test id, input, and expected output. Two independent mechanisms,
because one mistake in the template should not be enough.

## Compiler backends

```
CompilerBackend
├── MockBackend      IMPLEMENTED   pattern matching; says so in provenance
├── RemoteBackend    IMPLEMENTED   calls the API, which dispatches to the judge
└── (browser WASM)   PLANNED       rustly-tech/toolchain
```

Every result carries `provenance`, and the UI renders it. A mocked diagnostic
must never pass as a real one.

`BackendUnavailable` is a distinct error type so an outage cannot be rendered as
a compile error. This distinction matters more here than almost anywhere else: a
learner shown a fabricated error learns to distrust every real one, including the
ones that would have taught them something.

## Local-first state

```
typing ──▶ debounced draft save ──▶ localStorage
quiz  ──▶ recordProgress        ──▶ localStorage + pending queue
                                          │
                                          ▼
                            batched checkpoint (≤ 256 entries)
                                          │
                                          ▼
                        POST /api/v1/progress/checkpoints
```

No request per keystroke, per quiz click, or per local Run. Progress is
monotonic and carries a per-key revision, so the server merge is idempotent and
a stale device cannot demote anything.

Storage degrades: IndexedDB or `localStorage` where available, memory otherwise.
A reader in a private window still gets a working editor; they just do not get
their draft back tomorrow.

## Submissions

The client hashes its source, writes it to the data plane, and posts the
resulting CID. The API's 64 KiB body limit enforces the same rule from the other
side, so a large submission cannot travel through the control plane even if a
client tried.

`idempotencyKey` is a stable digest of Trial and source, so a retry after a
dropped connection replays the original submission rather than creating a second.

## What is deliberately absent

- No client-side router. Full page loads are fast when pages are static, and they
  are more robust.
- No CSS framework. The design system is about 400 lines of custom properties.
- No state management library. The state is a draft and a progress map.
- No analytics.
- No ad network. A single house-ad slot abstraction will come later, and never in
  the editor, compiler output, judge result, workspace, Git, or chat.
