# rustly-tech/web

The [rustly.tech](https://rustly.tech) web application. Astro, TypeScript in
strict mode, React islands only where interactivity is genuinely needed.

## Static-first, and enforced

`output: 'static'`. There is no server, which is how invariant A stops being an
intention and becomes a property of the build: an ordinary Learn, cheatsheet, or
Trial page cannot depend on an API because there is nothing to depend on.

`scripts/check-build.mjs` runs after every build and asserts the things that are
easy to state and easy to lose:

| Invariant                                                         | Why it is checked mechanically                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **No hidden test material in `dist/`**                            | Everything in `dist/` is public. A "hidden" test in a static bundle is a published test. |
| **No reference solution in `dist/`**                              | Same reason, with the answer attached.                                                   |
| Lesson prose is in the HTML                                       | A refactor to client-side fetching would break offline reading with no type error.       |
| Public tests render into the Trial page                           | They are part of the statement, not an enhancement.                                      |
| Every page has `lang`, a title, one `h1`, a skip link, a viewport | These regress silently during a redesign.                                                |
| Every `<img>` has `alt`                                           | An image with no alt text is invisible to a screen reader.                               |
| Monaco is never loaded eagerly                                    | A reader of prose must not download an IDE.                                              |

CI runs it, plus a structural accessibility pass over every built page.

## Status

| Piece                                                                               | Status                                                                    |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Ownership lesson: prose, examples, visualisation, quizzes, cheatsheet, OSS examples | **IMPLEMENTED**                                                           |
| Trial page: statement, starter, public tests, workspace                             | **IMPLEMENTED**                                                           |
| Monaco editor with a working `<textarea>` fallback                                  | **IMPLEMENTED**                                                           |
| Local-first drafts and progress, batched into checkpoints                           | **IMPLEMENTED**                                                           |
| Hard Check (predict before you run)                                                 | **IMPLEMENTED**                                                           |
| Raw diagnostics + human explanation, side by side                                   | **IMPLEMENTED**                                                           |
| `CompilerBackend` with mock and remote adapters                                     | **IMPLEMENTED**                                                           |
| In-browser Rust compilation                                                         | **PLANNED** — see [`toolchain`](https://github.com/rustly-tech/toolchain) |
| Submission SSE stream and accepted-result UI                                        | **PLANNED** — the contract is written, the stream is not wired            |
| Post-solve solution comparison                                                      | **PLANNED** — the page states the reveal rule                             |
| Recent, Archive, Questions, Events, Clans                                           | **PLANNED** — honest shells that say what they need                       |

Every shell page says what it is missing rather than showing invented data. A
placeholder that looks finished hides the work.

## The mock compiler never pretends

`MockBackend` pattern-matches a small corpus of teaching errors so the interface
can be built and tested with no network and no toolchain. Every result carries a
`provenance` field, and the UI renders it:

> **Not a real compiler.** Pattern-matched locally. Not a real compiler; submit
> to see real rustc output.

It also refuses to fabricate program output — a plausible wrong answer is the
worst kind of lie for a teaching tool. An API outage surfaces as
`BackendUnavailable`, which is a distinct type precisely so it cannot be rendered
as a compile error: a learner shown a fabricated diagnostic learns to distrust
every real one.

## Content is vendored

`src/data/content/` is a snapshot of
[`rustly-tech/content`](https://github.com/rustly-tech/content), committed here
so the build is hermetic: `pnpm build` never reaches the network and CI never
fails because another repository is momentarily unavailable.

```sh
pnpm sync-content ../content                                   # local checkout
pnpm sync-content https://github.com/rustly-tech/content main  # or a clone
```

`SNAPSHOT.json` records the source, ref, and revision. A snapshot with no
provenance is a fork nobody remembers making.

## Development

```sh
pnpm install
pnpm dev            # http://localhost:4321
pnpm typecheck      # astro check + tsc --noEmit
pnpm lint
pnpm test
pnpm build          # astro build + build-invariant checks
```

`PUBLIC_RUSTLY_API` points the workspace at a real compiler and enables Submit.
Unset, the mock backend runs and says so.

## Layout

```
src/
  components/   Astro components and React islands
  layouts/      the page shell
  lib/          content loading, compiler backends, local storage, markdown
  pages/        one file per route
  styles/       the monochrome design system
  data/content/ vendored content snapshot
scripts/        content sync and build-invariant checks
```

## Design

Monochrome and dense. Colour is reserved for the three things that carry
meaning: a compiler error, a passing test, a warning. When something is red here,
it means something.

Both themes are defined at the top of `global.css` as custom properties, so a
hardcoded colour has nowhere to hide. Keyboard focus is always visible,
`prefers-reduced-motion` is respected, and every interactive component is
operable without a mouse.

## Accessibility

A floor, not a finish line. CI asserts structure — `lang`, one `h1`, a skip link,
labelled controls, descriptive link text, `alt` on images. The ownership
visualisation describes every binding state in words as well as position and
shading, because a diagram that only works if you can see it teaches only the
people who can see it.

## License

Dual-licensed under [MIT](LICENSE-MIT) or [Apache-2.0](LICENSE-APACHE), at your option.
