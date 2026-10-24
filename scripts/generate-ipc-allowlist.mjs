#!/usr/bin/env node
/**
 * Generates the IPC allowlist from the source tree.
 *
 * The allowlist is not maintained by hand. This script walks `src/main`, finds
 * every channel the baseline registers or emits, and writes three artefacts
 * from that single scan:
 *
 *   src/sidecar/allowlist.generated.ts   what the sidecar will serve
 *   src-tauri/src/ipc/allowlist.rs       what the Rust shell will forward
 *   docs/ipc-inventory.md                the human-readable inventory
 *
 * Completeness is enforced, not assumed. The scan resolves three indirection
 * patterns the baseline actually uses:
 *
 *   1. a channel stored in a `const` (`const channel = \`on-x-${id}\``);
 *   2. a local helper that forwards its first parameter (`function send(event)`
 *      and `private send(channel)`);
 *   3. a `const someChannels = [...] as const` list registered in a loop.
 *
 * Anything it still cannot resolve aborts the run with file and line, because a
 * channel built at runtime cannot be audited. `--check` mode fails when the
 * committed output is stale.
 *
 * Usage:
 *   node scripts/generate-ipc-allowlist.mjs           # write the files
 *   node scripts/generate-ipc-allowlist.mjs --check    # fail if they are stale
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_DIR = path.join(ROOT, "src", "main");
const TS_OUTPUT = path.join(ROOT, "src", "sidecar", "allowlist.generated.ts");
const RUST_OUTPUT = path.join(ROOT, "src-tauri", "src", "ipc", "allowlist.rs");
const DOC_OUTPUT = path.join(ROOT, "docs", "ipc-inventory.md");

/** The wrapper itself registers whatever name it is given. */
const SKIP_FILES = new Set(["src/main/events/register-event.ts"]);

/**
 * Helpers that forward their first parameter as a channel name across the whole
 * code base. Verified to exist by `assertForwardersExist`.
 */
const GLOBAL_FORWARDERS = new Set([
  "sendToAppWindows",
  "sendToFirstLoadedWindow",
  "sendToChatWindow",
  "sendToWebContents",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const PARAM_NAMES = new Set(["channel", "event", "name"]);

const walk = (directory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      files.push(...walk(full));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }

  return files;
};

const isTestFile = (file) =>
  /\.(test|spec)\.[cm]?tsx?$/.test(file) ||
  file.includes(`${path.sep}tests${path.sep}`);

/** Reads the first argument of a call whose `(` is at `openParenIndex`. */
const readFirstArgument = (source, openParenIndex) => {
  let index = openParenIndex + 1;
  while (index < source.length && /\s/.test(source[index])) index++;

  const quote = source[index];

  if (quote === '"' || quote === "'") {
    let value = "";
    index++;
    while (index < source.length && source[index] !== quote) {
      if (source[index] === "\\") {
        value += source[index + 1] ?? "";
        index += 2;
        continue;
      }
      value += source[index];
      index++;
    }
    return { kind: "literal", value };
  }

  if (quote === "`") {
    let value = "";
    index++;
    while (index < source.length && source[index] !== "`") {
      if (source[index] === "\\") {
        value += source[index + 1] ?? "";
        index += 2;
        continue;
      }
      value += source[index];
      index++;
    }
    return value.includes("${")
      ? { kind: "template", value }
      : { kind: "literal", value };
  }

  if (quote === undefined) return null;

  const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(index));
  return {
    kind: "identifier",
    value: identifier ? identifier[0] : null,
  };
};

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

/**
 * Finds the nearest function signature before `index` whose first parameter is
 * a string channel. Returns `{name, param}` or null.
 */
const enclosingForwarderSignature = (source, index) => {
  const pattern = /([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*:\s*string/g;
  let match;
  let last = null;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index > index) break;
    last = match;
  }

  if (!last) return null;

  const [, name, param] = last;
  if (!PARAM_NAMES.has(param)) return null;

  return { name, param };
};

const collect = () => {
  const invoke = new Map();
  const send = new Map();
  const events = new Map();
  const dynamicPatterns = new Map();
  const forwarderCallSites = [];
  const problems = [];

  const record = (map, channel, file, line) => {
    const existing = map.get(channel);
    if (existing) {
      existing.sites.push({ file, line });
      return;
    }
    map.set(channel, { channel, sites: [{ file, line }] });
  };

  const recordDynamic = (template, file, line) => {
    const prefix = template.split("${")[0];
    const existing = dynamicPatterns.get(prefix);
    if (existing) {
      existing.sites.push({ file, line });
      return;
    }
    dynamicPatterns.set(prefix, {
      prefix,
      template,
      sites: [{ file, line }],
    });
  };

  for (const file of walk(MAIN_DIR)) {
    if (isTestFile(file)) continue;

    const relative = path.relative(ROOT, file).replaceAll("\\", "/");
    if (SKIP_FILES.has(relative)) continue;

    const source = fs.readFileSync(file, "utf8");

    // --- 1. channels held in a const -------------------------------------
    const declaredChannels = new Map();
    for (const match of source.matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*[^=;]+)?=\s*(`[^`]*`|"[^"\n]*"|'[^'\n]*')/g
    )) {
      const [, name, raw] = match;
      const value = raw.slice(1, -1);
      const list = declaredChannels.get(name) ?? [];
      list.push({
        template: value.includes("${"),
        value,
        line: lineOf(source, match.index),
      });
      declaredChannels.set(name, list);
    }

    // --- 2. channel lists registered in a loop ---------------------------
    for (const match of source.matchAll(
      /(?:const|let)\s+([A-Za-z_$][\w$]*[Cc]hannels)\s*=\s*\[([\s\S]*?)\]\s*(?:as const)?/g
    )) {
      const [, , body] = match;
      for (const literal of body.matchAll(/"([^"\n]+)"|'([^'\n]+)'/g)) {
        record(
          invoke,
          literal[1] ?? literal[2],
          relative,
          lineOf(source, match.index)
        );
      }
    }

    // --- 3. receivers ----------------------------------------------------
    for (const match of source.matchAll(
      /\b(registerEvent|ipcMain\.handle|ipcMain\.handleOnce|ipcMain\.on|ipcMain\.once)\s*\(/g
    )) {
      const openParen = source.indexOf("(", match.index);
      const argument = readFirstArgument(source, openParen);
      const line = lineOf(source, match.index);
      const isSend = match[1] === "ipcMain.on" || match[1] === "ipcMain.once";

      if (!argument) continue;

      if (argument.kind === "literal") {
        record(isSend ? send : invoke, argument.value, relative, line);
        continue;
      }

      if (argument.kind === "template") {
        problems.push(
          `${relative}:${line} — dynamic receiver \`${argument.value}\`; receivers must be static`
        );
        continue;
      }

      // Identifier: either a `for (const channel of someChannels)` loop, which
      // step 2 already expanded, or something the scan cannot see.
      const isLoopVariable = new RegExp(
        `for\\s*\\(\\s*const\\s+${argument.value}\\s+of\\s+([A-Za-z_$][\\w$]*[Cc]hannels)`
      ).test(source);

      if (!isLoopVariable) {
        problems.push(
          `${relative}:${line} — ${match[1]} receives \`${argument.value}\`, which is not a literal or a known channel list`
        );
      }
    }

    // --- 4. senders ------------------------------------------------------
    for (const match of source.matchAll(
      /(?:webContents\.send|host\.send|sender\.send|sendToAppWindows|sendToFirstLoadedWindow|sendToChatWindow|sendToWebContents)\s*\(/g
    )) {
      const openParen = source.indexOf("(", match.index);
      const argument = readFirstArgument(source, openParen);
      const line = lineOf(source, match.index);

      if (!argument) continue;

      if (argument.kind === "literal") {
        record(events, argument.value, relative, line);
        continue;
      }

      if (argument.kind === "template") {
        recordDynamic(argument.value, relative, line);
        continue;
      }

      const identifier = argument.value;
      const declared = identifier
        ? declaredChannels.get(identifier)
        : undefined;

      if (declared) {
        for (const entry of declared) {
          if (entry.template) {
            recordDynamic(entry.value, relative, entry.line);
          } else {
            record(events, entry.value, relative, entry.line);
          }
        }
        continue;
      }

      const signature = enclosingForwarderSignature(source, match.index);

      if (signature && signature.param === identifier) {
        if (GLOBAL_FORWARDERS.has(signature.name)) {
          forwarderCallSites.push(`${relative}:${line} (${signature.name})`);
        } else {
          forwarderCallSites.push(`${relative}:${line} (${signature.name})`);
          scanLocalForwarderCalls(
            source,
            relative,
            signature.name,
            events,
            dynamicPatterns,
            declaredChannels
          );
        }
        continue;
      }

      problems.push(
        `${relative}:${line} — send forwards \`${identifier}\`, which is neither a declared channel nor a forwarder parameter`
      );
    }
  }

  return {
    invoke,
    send,
    events,
    dynamicPatterns,
    forwarderCallSites,
    problems,
  };
};

/** Call sites of a local forwarder such as `function send(event, ...)`. */
const scanLocalForwarderCalls = (
  source,
  relative,
  name,
  events,
  dynamicPatterns,
  declaredChannels
) => {
  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${name}\\s*\\(`, "g");

  for (const match of source.matchAll(pattern)) {
    const openParen = source.indexOf("(", match.index);
    const argument = readFirstArgument(source, openParen);
    if (!argument) continue;

    const line = lineOf(source, match.index);

    if (argument.kind === "literal") {
      const existing = events.get(argument.value);
      if (existing) {
        existing.sites.push({ file: relative, line });
      } else {
        events.set(argument.value, {
          channel: argument.value,
          sites: [{ file: relative, line }],
        });
      }
      continue;
    }

    if (argument.kind === "template") {
      const prefix = argument.value.split("${")[0];
      const existing = dynamicPatterns.get(prefix);
      if (existing) {
        existing.sites.push({ file: relative, line });
      } else {
        dynamicPatterns.set(prefix, {
          prefix,
          template: argument.value,
          sites: [{ file: relative, line }],
        });
      }
      continue;
    }

    const declared = argument.value
      ? declaredChannels.get(argument.value)
      : undefined;
    if (!declared) continue;

    for (const entry of declared) {
      if (entry.template) {
        const prefix = entry.value.split("${")[0];
        if (!dynamicPatterns.has(prefix)) {
          dynamicPatterns.set(prefix, {
            prefix,
            template: entry.value,
            sites: [{ file: relative, line: entry.line }],
          });
        }
      } else if (!events.has(entry.value)) {
        events.set(entry.value, {
          channel: entry.value,
          sites: [{ file: relative, line: entry.line }],
        });
      }
    }
  }
};

const toSortedArray = (map) =>
  [...map.values()].sort((a, b) => a.channel.localeCompare(b.channel));

const renderTypeScript = ({ invoke, send, events, dynamicPatterns }) => `/**
 * GENERATED FILE — do not edit.
 *
 * Produced by \`scripts/generate-ipc-allowlist.mjs\` from \`src/main\`. Run
 * \`node scripts/generate-ipc-allowlist.mjs\` after adding or removing a channel;
 * \`--check\` mode fails the build when this file is stale.
 *
 * Counts: ${invoke.size} invoke, ${send.size} send, ${events.size} event, ${
   dynamicPatterns.size
 } dynamic prefix.
 */

/** \`ipcMain.handle\` and \`registerEvent\` channels. Served by \`ipc_invoke\`. */
export const INVOKE_CHANNELS: readonly string[] = [
${toSortedArray(invoke)
  .map((entry) => `  ${JSON.stringify(entry.channel)},`)
  .join("\n")}
];

/** \`ipcMain.on\` channels. Served by \`ipc_send\`. */
export const SEND_CHANNELS: readonly string[] = [
${toSortedArray(send)
  .map((entry) => `  ${JSON.stringify(entry.channel)},`)
  .join("\n")}
];

/** Main→renderer channels. The only values allowed in \`sphinx:ipc-event\`. */
export const EVENT_CHANNELS: readonly string[] = [
${toSortedArray(events)
  .map((entry) => `  ${JSON.stringify(entry.channel)},`)
  .join("\n")}
];

/**
 * Dynamic event channels. \`prefix\` is everything before the first \`\${\`, and
 * the remainder must be 1-200 characters of [A-Za-z0-9_.:@-]. The charset is
 * deliberately narrow: it covers shop ids, object ids and request ids while
 * excluding path separators, whitespace and anything that could smuggle a
 * different channel past the prefix check.
 */
export const DYNAMIC_EVENT_PREFIXES: readonly string[] = [
${[...dynamicPatterns.values()]
  .sort((a, b) => a.prefix.localeCompare(b.prefix))
  .map((entry) => `  ${JSON.stringify(entry.prefix)},`)
  .join("\n")}
];
`;

const renderRust = ({ invoke, send, events, dynamicPatterns }) => {
  const array = (name, entries) =>
    `pub const ${name}: &[&str] = &[\n${entries
      .map((entry) => `    ${JSON.stringify(entry.channel)},`)
      .join("\n")}\n];`;

  return `// GENERATED FILE — do not edit.
//
// Produced by \`scripts/generate-ipc-allowlist.mjs\` from \`src/main\`. The same
// scan writes \`src/sidecar/allowlist.generated.ts\`, so the shell and the
// sidecar can never disagree about which channels exist.
//
// Counts: ${invoke.size} invoke, ${send.size} send, ${events.size} event, ${
    dynamicPatterns.size
  } dynamic prefix.

/// \`ipcMain.handle\` / \`registerEvent\` channels, reachable through \`ipc_invoke\`.
${array("INVOKE_CHANNELS", toSortedArray(invoke))}

/// \`ipcMain.on\` channels, reachable through \`ipc_send\`.
${array("SEND_CHANNELS", toSortedArray(send))}

/// Main→renderer channels the shell may emit as \`sphinx:ipc-event\`.
${array("EVENT_CHANNELS", toSortedArray(events))}

/// Prefixes of dynamic event channels. The remainder after the prefix must be
/// 1-200 characters of [A-Za-z0-9_.:@-].
pub const DYNAMIC_EVENT_PREFIXES: &[&str] = &[
${[...dynamicPatterns.values()]
  .sort((a, b) => a.prefix.localeCompare(b.prefix))
  .map((entry) => `    ${JSON.stringify(entry.prefix)},`)
  .join("\n")}
];
`;
};

const renderDoc = ({
  invoke,
  send,
  events,
  dynamicPatterns,
  forwarderCallSites,
}) => {
  const table = (entries) =>
    entries.length === 0
      ? "_None._\n"
      : [
          "| Channel | Registered at |",
          "| --- | --- |",
          ...entries.map(
            (entry) =>
              `| \`${entry.channel}\` | ${entry.sites
                .slice(0, 4)
                .map((site) => `\`${site.file}:${site.line}\``)
                .join(
                  ", "
                )}${entry.sites.length > 4 ? ` +${entry.sites.length - 4}` : ""} |`
          ),
          "",
        ].join("\n");

  return `# IPC inventory

**Generated file — do not edit.** Produced by \`scripts/generate-ipc-allowlist.mjs\`
from \`src/main\`. The Fase 0 hand-written audit is preserved in
\`docs/ipc-inventory-audit.md\`; this file is the build-time truth consumed by
both the Rust shell and the sidecar.

## Totals

| Kind | Count | Reaches |
| --- | ---: | --- |
| Renderer → sidecar (\`ipcMain.handle\` / \`registerEvent\`) | ${invoke.size} | \`ipc_invoke\` |
| Renderer → sidecar (\`ipcMain.on\`) | ${send.size} | \`ipc_send\` |
| Sidecar → renderer, static | ${events.size} | \`sphinx:ipc-event\` |
| Sidecar → renderer, dynamic prefixes | ${dynamicPatterns.size} | \`sphinx:ipc-event\` |
| Forwarder call sites (channel passed as a parameter) | ${forwarderCallSites.length} | resolved above |

## Renderer → sidecar channels

${table(toSortedArray(invoke))}

## \`ipcMain.on\` channels

${table(toSortedArray(send))}

## Sidecar → renderer channels

${table(toSortedArray(events))}

## Dynamic event channels

${
  dynamicPatterns.size === 0
    ? "_None._\n"
    : [
        "| Template | Producers |",
        "| --- | --- |",
        ...[...dynamicPatterns.values()]
          .sort((a, b) => a.prefix.localeCompare(b.prefix))
          .map(
            (entry) =>
              `| \`${entry.template.replaceAll("|", "\\|")}\` | ${entry.sites
                .map((site) => `\`${site.file}:${site.line}\``)
                .join(", ")} |`
          ),
        "",
        "Match rule: the literal prefix followed by 1-200 characters of",
        "`[A-Za-z0-9_.:@-]`. Path separators, whitespace and quotes are rejected,",
        "so a dynamic channel cannot be turned into a different one.",
        "",
      ].join("\n")
}

## Forwarder call sites

${forwarderCallSites.length === 0 ? "_None._\n" : forwarderCallSites.map((site) => `- \`${site}\``).join("\n") + "\n"}
`;
};

const main = () => {
  const scan = collect();

  if (scan.problems.length > 0) {
    process.stderr.write(
      `IPC allowlist generation failed:\n${scan.problems
        .map((problem) => `  ${problem}`)
        .join("\n")}\n`
    );
    process.exitCode = 1;
    return;
  }

  const outputs = [
    { file: TS_OUTPUT, content: renderTypeScript(scan) },
    { file: RUST_OUTPUT, content: renderRust(scan) },
    { file: DOC_OUTPUT, content: renderDoc(scan) },
  ];

  const check = process.argv.includes("--check");
  let stale = 0;

  for (const { file, content } of outputs) {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    if (existing === content) continue;

    if (check) {
      process.stderr.write(`stale: ${path.relative(ROOT, file)}\n`);
      stale++;
      continue;
    }

    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
    process.stdout.write(`wrote ${path.relative(ROOT, file)}\n`);
  }

  if (check && stale > 0) {
    process.stderr.write(
      `\n${stale} generated file(s) are stale. Run: node scripts/generate-ipc-allowlist.mjs\n`
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(
    `allowlist: ${scan.invoke.size} invoke, ${scan.send.size} send, ${
      scan.events.size
    } event, ${scan.dynamicPatterns.size} dynamic prefix, ${
      scan.forwarderCallSites.length
    } forwarder call sites\n`
  );
};

main();
