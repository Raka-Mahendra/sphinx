/**
 * `sphinx://` deep links.
 *
 * Extracted from `src/main/index.ts` in Fase 5 so the same code runs in both
 * shells. In Electron the URL arrives through `app.on("second-instance")` /
 * `app.on("open-url")`; in Tauri the Rust shell forwards it over RPC and the
 * sidecar calls `handleDeepLinkPath`. The behaviour is unchanged: only
 * `sphinx://run?shop=&objectId=` does anything, and it starts the game.
 */
import { db, gamesSublevel, levelKeys } from "@main/level";
import { launchGame, openClassicsGame } from "@main/helpers";
import { lookupCachedPlatform } from "@main/events/library/get-library";
import { logger } from "@main/services/logger";
import { WindowManager } from "@main/services/window-manager";
import type { GameShop, UserPreferences } from "@types";

const handleRunGame = async (shop: GameShop, objectId: string) => {
  const gameKey = levelKeys.game(shop, objectId);
  const game = await gamesSublevel.get(gameKey);

  if (!game) {
    logger.error("Game not found", { shop, objectId });
    return;
  }

  const userPreferences = await db.get<string, UserPreferences | null>(
    levelKeys.userPreferences,
    { valueEncoding: "json" }
  );

  // Only open main window if setting is disabled
  if (!userPreferences?.hideToTrayOnGameStart) {
    WindowManager.createMainWindow();
  }

  if (shop === "launchbox") {
    if (!game.platform) {
      const cachedPlatform = await lookupCachedPlatform(gameKey);
      if (cachedPlatform) {
        game.platform = cachedPlatform;
        await gamesSublevel.put(gameKey, game).catch(() => {});
      }
    }
    await openClassicsGame(shop, objectId);
    return;
  }

  if (!game.executablePath) {
    logger.error("Game has no executable path", { shop, objectId });
    return;
  }

  await launchGame({
    shop,
    objectId,
    executablePath: game.executablePath,
    launchOptions: game.launchOptions,
  });
};

export const handleDeepLinkPath = (uri?: string) => {
  if (!uri) return;

  try {
    const url = new URL(uri);

    if (url.host === "run") {
      const shop = url.searchParams.get("shop") as GameShop | null;
      const objectId = url.searchParams.get("objectId");

      if (shop && objectId) {
        void handleRunGame(shop, objectId).catch((error) => {
          logger.error("Failed to launch game from deep link", error);
          WindowManager.createMainWindow();
        });
      }

      return;
    }
  } catch (error) {
    logger.error("Error handling deep link", uri, error);
  }
};

/**
 * `app.on("second-instance")` from the baseline.
 *
 * Moved here verbatim in behaviour: a `run` link must not raise the window (the
 * user asked to start a game, not to look at the library), everything else
 * focuses the main window and honours `--big-picture`, and the URL is handled
 * last so the game launch sees a visible window.
 */
export const handleSecondInstance = (
  uri: string | undefined,
  forceBigPicture: boolean
) => {
  const isRunDeepLink = uri?.startsWith("sphinx://run");

  if (!isRunDeepLink) {
    if (WindowManager.mainWindow) {
      if (WindowManager.mainWindow.isMinimized()) {
        WindowManager.mainWindow.restore();
      }

      WindowManager.mainWindow.focus();

      if (forceBigPicture) {
        void WindowManager.openBigPictureWindow();
      }
    } else {
      WindowManager.createMainWindow({ forceBigPicture });
    }
  }

  handleDeepLinkPath(uri);
};
