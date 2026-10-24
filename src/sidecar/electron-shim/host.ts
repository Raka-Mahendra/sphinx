import path from "node:path";

import type { SidecarRpc } from "../rpc.js";

/**
 * Everything the shim needs from the shell, resolved synchronously at boot.
 *
 * `src/main/constants.ts` calls `app.getPath()` and `app.isPackaged` while the
 * module graph is still loading, before any RPC round trip could complete.
 * Those values therefore arrive as environment variables set by the Rust
 * supervisor, and `app.getPath()` reads them from here rather than asking the
 * shell. `path.get` exists as an RPC method for paths that are only needed
 * later; the boot-time set never goes through it.
 */
export interface ShellEnvironment {
  isPackaged: boolean;
  appVersion: string;
  appName: string;
  appPath: string;
  resourcesPath: string;
  locale: string;
  paths: Record<string, string>;
}

const ELECTRON_PATH_NAMES = [
  "home",
  "appData",
  "userData",
  "sessionData",
  "temp",
  "exe",
  "module",
  "desktop",
  "documents",
  "downloads",
  "music",
  "pictures",
  "videos",
  "recent",
  "logs",
  "crashDumps",
  "userCache",
] as const;

export type ElectronPathName = (typeof ELECTRON_PATH_NAMES)[number];

const isElectronPathName = (value: string): value is ElectronPathName =>
  (ELECTRON_PATH_NAMES as readonly string[]).includes(value);

const readJsonEnv = (name: string): Record<string, string> => {
  const raw = process.env[name];
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") result[key] = value;
    }
    return result;
  } catch {
    return {};
  }
};

let environment: ShellEnvironment | null = null;
const overrides = new Map<string, string>();

export const loadShellEnvironment = (): ShellEnvironment => {
  if (environment) return environment;

  environment = {
    isPackaged: process.env.SPHINX_IS_PACKAGED === "1",
    appVersion: process.env.SPHINX_APP_VERSION ?? "0.1.0",
    appName: process.env.SPHINX_APP_NAME ?? "Sphinx Launcher",
    appPath: process.env.SPHINX_APP_PATH ?? process.cwd(),
    resourcesPath:
      process.env.SPHINX_RESOURCES_DIR ?? path.join(process.cwd(), "resources"),
    locale: process.env.SPHINX_LOCALE ?? "en-US",
    paths: readJsonEnv("SPHINX_PATHS"),
  };

  return environment;
};

export const shellEnvironment = (): ShellEnvironment => loadShellEnvironment();

/**
 * `app.getPath`. Unknown names throw, matching Electron's behaviour instead of
 * returning an empty string that would silently write into the CWD.
 */
export const getShellPath = (name: string): string => {
  const override = overrides.get(name);
  if (override) return override;

  const env = loadShellEnvironment();
  const resolved = env.paths[name];

  if (typeof resolved === "string" && resolved.length > 0) return resolved;

  if (isElectronPathName(name)) {
    throw new Error(
      `The shell did not provide the "${name}" path. Check SPHINX_PATHS.`
    );
  }

  throw new Error(`Unknown path name: ${name}`);
};

export const setShellPath = (name: string, value: string): void => {
  overrides.set(name, value);
};

/** The RPC channel to the shell. Null until `entry.ts` has created it. */
let rpc: SidecarRpc | null = null;

export const attachHostRpc = (instance: SidecarRpc): void => {
  rpc = instance;
};

export const hostRpc = (): SidecarRpc => {
  if (!rpc) {
    throw new Error(
      "The shell RPC channel is not ready. The shim was used before entry.ts finished booting."
    );
  }
  return rpc;
};

/**
 * A shim call the sidecar can survive without. Fire-and-forget Electron methods
 * (`show`, `focus`, `maximize`) are synchronous and return `void`, so a rejected
 * RPC must be logged instead of becoming an unhandled rejection that kills the
 * process.
 */
export const callIgnoringFailure = async (
  method: string,
  params: unknown
): Promise<void> => {
  try {
    await hostRpc().request(method, params);
  } catch (error) {
    process.stderr.write(
      `[shim] ${method} failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`
    );
  }
};
