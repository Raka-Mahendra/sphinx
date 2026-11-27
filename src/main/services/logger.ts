import { logsPath } from "@main/constants";
import path from "path";
import log, {
  type LogMessage,
  type PathVariables,
} from "../../sidecar/electron-shim/logger.js";

// The sidecar runs outside Electron. `electron-log` posted its file transport to
// the Electron main process, so this module now configures the shim logger in
// `src/sidecar/electron-shim/logger.ts`, which writes the same file split with
// plain `fs` streams (PRD Fase 8).
const networkLog = log.create({ logId: "network" });
(networkLog.transports.ipc as { depth: number }).depth = 12;
networkLog.transports.file.resolvePathFn = () =>
  path.join(logsPath, "network.txt");

log.transports.file.resolvePathFn = (
  _: PathVariables,
  message?: LogMessage | undefined
) => {
  if (message?.scope == "achievements") {
    return path.join(logsPath, "achievements.txt");
  }

  if (message?.level === "error") {
    return path.join(logsPath, "error.txt");
  }

  if (message?.level === "info") {
    return path.join(logsPath, "info.txt");
  }

  return path.join(logsPath, "logs.txt");
};

log.errorHandler.startCatching({
  showDialog: false,
});

log.initialize();

export const logger = log.scope("main");
export const achievementsLogger = log.scope("achievements");
export const steamSyncLogger = log.scope("steam-sync");
export const networkLogger = networkLog.scope("network");
