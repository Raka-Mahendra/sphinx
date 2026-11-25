import type { GameShop, RemoteSnapshotSummary } from "@types";

import { getCloudSaveProvider } from "./cloud-save-provider";

/**
 * Lists the snapshots for a game, newest first.
 *
 * Drive keeps several immutable manifests (retention), so more than one entry is
 * normal. The pipeline treats `[0]` as the head.
 */
export const listRemoteGameSnapshots = async (
  objectId: string,
  shop: GameShop
): Promise<RemoteSnapshotSummary[]> =>
  getCloudSaveProvider().listSnapshots({ objectId, shop });
