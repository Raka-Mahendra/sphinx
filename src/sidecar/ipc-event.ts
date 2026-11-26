/**
 * Builds the event object `src/main` handlers receive for a sidecar invoke or
 * send. Electron supplies `senderFrame` (a `WebFrameMain`) with every IPC
 * event, and `src/main/events/misc/file-system.ts` rejects any caller whose
 * `senderFrame` is missing or whose URL is not the renderer. The shim therefore
 * has to forward the sender's main frame, not `null`.
 */
export interface SenderFrameLike {
  url: string;
}

export interface SenderLike {
  mainFrame: SenderFrameLike;
}

export interface IpcEvent<TSender> {
  sender: TSender;
  senderFrame: SenderFrameLike | null;
  frameId: number;
  processId: number;
  returnValue: unknown;
}

export const createIpcEvent = <TSender extends SenderLike>(
  sender: TSender,
  processId: number
): IpcEvent<TSender> => ({
  sender,
  senderFrame: sender.mainFrame,
  frameId: 0,
  processId,
  returnValue: undefined,
});
