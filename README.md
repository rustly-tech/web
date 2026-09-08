# Rustly web

The Rustly website.

It contains the public learning experience at [rustly.tech](https://rustly.tech),
including lessons, Trials, cheatsheets, and the in-browser coding workspace.

## Run locally

```sh
corepack enable
pnpm install
pnpm dev
```

The development server prints the local URL. Content is copied from the
`rustly-tech/content` repository by `scripts/sync-content.mjs`.

## Verify

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The build checks that private Trial tests are absent from browser assets. See
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation and data-flow
details.

Rustly is in early development. Browser execution currently supports the
Ownership lesson used by the first working product slice.

## License

MIT or Apache-2.0, at your option.
