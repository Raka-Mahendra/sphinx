import {
  DYNAMIC_EVENT_PREFIXES,
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  SEND_CHANNELS,
} from "./allowlist.generated.js";
import type { ChannelKind } from "./rpc.js";

/**
 * The sidecar's half of the allowlist check.
 *
 * Rust validates every inbound message before it reaches the pipe, and the
 * sidecar validates again before it dispatches. The duplication is deliberate:
 * a shell bug must not be enough to reach a handler that was never audited.
 *
 * The matcher is generated from the same scan as the Rust table, so the two
 * sides cannot drift — `scripts/generate-ipc-allowlist.mjs --check` fails the
 * build if either file is stale.
 */

const INVOKE = new Set(INVOKE_CHANNELS);
const SEND = new Set(SEND_CHANNELS);
const EVENT = new Set(EVENT_CHANNELS);

/** Characters allowed after a dynamic event prefix. */
const DYNAMIC_CHARSET = /^[A-Za-z0-9_.:@-]+$/;
const DYNAMIC_MAX_LENGTH = 200;

export const matchesDynamicEventChannel = (channel: string): boolean => {
  for (const prefix of DYNAMIC_EVENT_PREFIXES) {
    if (!channel.startsWith(prefix)) continue;

    const remainder = channel.slice(prefix.length);
    if (remainder.length === 0 || remainder.length > DYNAMIC_MAX_LENGTH)
      continue;
    if (!DYNAMIC_CHARSET.test(remainder)) continue;

    return true;
  }

  return false;
};

export const isInvokeChannelAllowed = (channel: string): boolean =>
  INVOKE.has(channel);

export const isSendChannelAllowed = (channel: string): boolean =>
  SEND.has(channel);

export const isEventChannelAllowed = (channel: string): boolean =>
  EVENT.has(channel) || matchesDynamicEventChannel(channel);

/** The guard `SidecarRpc` uses for every inbound message. */
export const isChannelAllowed = (
  channel: string,
  kind: ChannelKind
): boolean => {
  switch (kind) {
    case "invoke":
      return isInvokeChannelAllowed(channel);
    case "send":
      return isSendChannelAllowed(channel);
    case "event":
      return isEventChannelAllowed(channel);
    default:
      return false;
  }
};

export const allowlistCounts = () => ({
  invoke: INVOKE.size,
  send: SEND.size,
  event: EVENT.size,
  dynamicEventPrefixes: DYNAMIC_EVENT_PREFIXES.length,
});
