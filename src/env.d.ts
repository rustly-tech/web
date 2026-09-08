/// <reference types="astro/client" />

/**
 * Environment variables this application reads.
 *
 * `PUBLIC_` is Astro's marker for values that reach the browser. There is
 * nothing secret here by construction: an API origin is public, and anything
 * that is not must never be given a `PUBLIC_` name.
 */
interface ImportMetaEnv {
  /** Origin of the Rustly control-plane API. Empty means no backend. */
  readonly PUBLIC_RUSTLY_API?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;

  /**
   * Vite's build-time glob import.
   *
   * Declared here so `tsc --noEmit` outside the Astro pipeline understands it.
   * It must always be called as the literal `import.meta.glob(...)`: Vite
   * rewrites that syntax at build time, so aliasing it to a local variable
   * silently produces a runtime error instead of a static import map.
   */
  glob<T = unknown>(pattern: string, options?: Record<string, unknown>): Record<string, T>;
}
