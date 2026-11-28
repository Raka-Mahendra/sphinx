import { app, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WindowManager } from "../../services/window-manager";
import { bundledRendererUrls } from "../renderer-urls";
import { isTrustedEpicSender } from "./epic-ipc-sender";

export function assertTrustedEpicSender(
  event: IpcMainInvokeEvent,
  allowBigPicture = false
) {
  const window = allowBigPicture
    ? WindowManager.appWindows.find(
        (candidate) => candidate?.webContents.id === event.sender.id
      )
    : WindowManager.mainWindow;
  const rendererUrls = [
    pathToFileURL(path.join(__dirname, "../renderer/index.html")).href,
    ...bundledRendererUrls(),
  ];
  if (!app.isPackaged && process.env.SPHINX_RENDERER_URL) {
    rendererUrls.push(process.env.SPHINX_RENDERER_URL);
  }
  if (
    !isTrustedEpicSender(
      {
        id: event.sender.id,
        isMainFrame:
          !!window && event.senderFrame === window.webContents.mainFrame,
        url: event.senderFrame?.url ?? "",
      },
      window && !window.isDestroyed() ? window.webContents.id : null,
      rendererUrls
    )
  ) {
    throw new Error("epic-ipc-untrusted");
  }
}
