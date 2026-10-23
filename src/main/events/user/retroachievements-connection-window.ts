import { WindowManager } from "@main/services";

import { registerEvent } from "../register-event";

registerEvent("openRetroAchievementsConnectionWindow", () => {
  WindowManager.openRetroAchievementsConnectionWindow();
});

registerEvent("minimizeRetroAchievementsConnectionWindow", () => {
  WindowManager.minimizeRetroAchievementsConnectionWindow();
});

registerEvent("closeRetroAchievementsConnectionWindow", () => {
  WindowManager.closeRetroAchievementsConnectionWindow();
});

registerEvent("completeRetroAchievementsConnectionWindow", () => {
  WindowManager.completeRetroAchievementsConnectionWindow();
});
