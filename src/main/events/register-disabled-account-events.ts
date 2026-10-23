// SPDX-License-Identifier: Apache-2.0

import { registerEvent } from "./register-event";

// Account chat/friends handlers live outside registerEvent because their
// modules are only loaded when the account feature is enabled. Registering
// fail-closed stubs keeps the IPC surface consistent: callers receive
// `feature_unavailable` instead of a missing-handler error.
const disabledAccountChannels = [
  "openChatWindow",
  "consumePendingChatFriends",
  "setChatWindowState",
  "getChatUnreadState",
  "markChatRead",
  "uploadChatAttachment",
  "minimizeChatWindow",
  "closeChatWindow",
  "openGameInMainWindow",
  "openFriendsWindow",
  "openFriendProfileInMainWindow",
  "openAddFriendModalInMainWindow",
  "minimizeFriendsWindow",
  "closeFriendsWindow",
  "friendsWindowReady",
  "syncFriendRequests",
  "prefetchFriends",
  "getFriendsSnapshot",
] as const;

for (const channel of disabledAccountChannels) {
  registerEvent(channel, () => {
    throw new Error(`Disabled account channel: ${channel}`);
  });
}
