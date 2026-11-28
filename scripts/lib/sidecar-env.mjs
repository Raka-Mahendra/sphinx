/**
 * Build-time `import.meta.env.*` values for the sidecar bundle.
 *
 * Vite replaces every `import.meta.env.X` in the renderer, but the sidecar is
 * bundled by esbuild, which leaves `import.meta` undefined in CJS output. A
 * missing define therefore used to become `undefined.includes(...)` in
 * `src/main/constants.ts` at module load, which aborted the whole event
 * registration: the sidecar reported `ready` and then answered every invoke
 * with `No handler registered`.
 *
 * So every key the source reads is defined here, with `""` as the value when
 * the developer has no `.env` (the release build has no `.env` at all). `""`
 * means "not configured": `isStaging` is false and the API-backed account
 * features stay disabled.
 */

/** Keys Vite would read from `.env`; `MODE`/`DEV` are esbuild's own. */
const CONFIGURABLE_KEY = /^(?:MAIN_VITE|RENDERER_VITE)_[A-Z0-9_]+$/;

/**
 * Parses a `.env` body the way the baseline did: `KEY=value` lines, optional
 * surrounding quotes, everything else ignored.
 */
export const parseEnvFile = (contents) => {
  const values = {};

  for (const line of contents.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }

  return values;
};

/** Every configurable `import.meta.env.X` key referenced in `sources`. */
export const collectEnvKeys = (sources) => {
  const keys = new Set();

  for (const source of sources) {
    for (const match of source.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)) {
      const key = match[1];
      if (CONFIGURABLE_KEY.test(key)) keys.add(key);
    }
  }

  return keys;
};

/**
 * esbuild `define` entries for `keys`.
 *
 * A key absent from `env` is defined as the empty string rather than left out,
 * so the bundle can never fall back to a raw `import.meta.env` access.
 */
export const buildEnvDefines = ({ keys, env }) => {
  const defines = {};

  for (const key of keys) {
    defines[`import.meta.env.${key}`] = JSON.stringify(env[key] ?? "");
  }

  return defines;
};
