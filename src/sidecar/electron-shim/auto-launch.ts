/**
 * `auto-launch`, backed by `tauri-plugin-autostart`.
 *
 * `src/main/events/user-preferences/auto-launch.ts` does:
 *
 * ```ts
 * const appLauncher = new AutoLaunch({ name: app.getName(), isHidden: minimized });
 * appLauncher.enable() / .disable();
 * ```
 *
 * The plugin is the documented replacement for the npm package (PRD §4.A.3), and
 * the shell owns it because only the shell can write the registry entry. The
 * "hidden" half of the option cannot be a per-call argument — the autostart
 * entry's arguments are fixed at build time — so it is stored next to the
 * preference and read at startup (`platform::compute_startup`).
 */
import { hostRpc } from "./host.js";

export interface AutoLaunchOptions {
  name?: string;
  isHidden?: boolean;
  path?: string;
  args?: string[];
}

export default class AutoLaunch {
  private readonly isHidden: boolean;

  constructor(options: AutoLaunchOptions = {}) {
    this.isHidden = options.isHidden ?? false;
  }

  public async enable(): Promise<void> {
    await hostRpc().request("autolaunch.set", {
      enabled: true,
      minimized: this.isHidden,
    });
  }

  public async disable(): Promise<void> {
    await hostRpc().request("autolaunch.set", {
      enabled: false,
      minimized: this.isHidden,
    });
  }

  public async isEnabled(): Promise<boolean> {
    const result = (await hostRpc().request("autolaunch.get", {})) as {
      enabled?: boolean;
    };
    return result?.enabled === true;
  }
}
