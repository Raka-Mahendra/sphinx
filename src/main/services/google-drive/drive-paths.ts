import { createHash } from "node:crypto";

import type { CloudSaveGameId } from "@types";

/**
 * Drive folder name for one game.
 *
 * `gameKey` is deliberately generic: it hashes whatever the shop and object ID
 * are, so adding a new shop needs no change here. The readable slug is only
 * there to make the app data folder debuggable; the short digest guarantees
 * that two IDs which sanitise to the same slug never share a folder.
 */
export const toDriveGameKey = ({ shop, objectId }: CloudSaveGameId): string => {
  const slug = `${shop}-${objectId}`
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  const digest = createHash("sha256")
    .update(`${shop}\u0000${objectId}`)
    .digest("hex")
    .slice(0, 8);
  return `${slug || "game"}-${digest}`;
};

export const DRIVE_SNAPSHOTS_FOLDER = "snapshots";
export const DRIVE_MANIFEST_FILE = (version: number) => `${version}.json`;
export const DRIVE_BLOB_FILE = (hash: string) => hash;
