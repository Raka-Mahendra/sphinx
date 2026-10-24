/**
 * `Tray` and `Menu`, backed by a native tray in Rust.
 *
 * `src/main/services/window-manager.ts` builds the tray menu with
 * `Menu.buildFromTemplate` and attaches it to a `Tray`, because the entries
 * include the six most recently played games — data that lives in LevelDB, on
 * the sidecar's side of the boundary. So the split is:
 *
 * - the sidecar keeps deciding what the menu *says* (labels, order, click
 *   closures);
 * - Rust keeps the native icon and the native menu;
 * - a click travels back as `control tray-click`, and the closure the baseline
 *   registered runs here.
 *
 * Ids are assigned here (`tray:<index>`) because `Menu.buildFromTemplate` takes
 * closures, not ids. Rust echoes the id back verbatim.
 */
import { EventEmitter } from "node:events";

import { hostRpc } from "./host.js";

export type MenuTemplateItem = {
  id?: string;
  label?: string;
  type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
  enabled?: boolean;
  click?: () => void;
  submenu?: MenuTemplateItem[];
  [key: string]: unknown;
};

/** Serialised form Rust understands. */
type WireMenuItem = {
  id?: string;
  label?: string;
  type?: string;
  enabled?: boolean;
};

type WireMenu = {
  tooltip?: string;
  items: WireMenuItem[];
};

/**
 * `Menu.buildFromTemplate(template)`.
 *
 * Only the members the tray menu uses are carried across. `submenu`,
 * `accelerator` and `role` are accepted but not forwarded: the baseline's tray
 * menu has none, and inventing native support for them would be untested code.
 */
export class Menu {
  /** id -> the closure the template registered. */
  private readonly handlers = new Map<string, () => void>();

  private constructor(
    private readonly template: MenuTemplateItem[],
    private readonly tooltip?: string
  ) {
    this.assignIds();
  }

  public static buildFromTemplate(
    template: MenuTemplateItem[],
    tooltip?: string
  ): Menu {
    return new Menu(template, tooltip);
  }

  public static setApplicationMenu(): void {
    // Rust owns the application menu; the baseline calls this to remove the
    // default Electron menu, which Tauri never adds.
  }

  public static getApplicationMenu(): null {
    return null;
  }

  /** Stable ids, assigned in template order. */
  private assignIds(): void {
    this.template.forEach((item, index) => {
      if (item.type === "separator") return;

      const id = item.id ?? `tray:${index}`;
      if (typeof item.click === "function") {
        this.handlers.set(id, item.click);
      }
    });
  }

  public toWire(): WireMenu {
    return {
      tooltip: this.tooltip,
      items: this.template.map((item, index) => ({
        id: item.id ?? `tray:${index}`,
        label: item.label,
        type: item.type,
        enabled: item.enabled ?? true,
      })),
    };
  }

  /** Runs the click closure for an id, if one was registered. */
  public dispatch(id: string): boolean {
    const handler = this.handlers.get(id);
    if (!handler) return false;
    handler();
    return true;
  }
}

/**
 * The tray the sidecar created, so control messages can find it.
 *
 * `createSystemTray` is called once per app run and keeps its own reference; this
 * registry exists because control messages arrive on the RPC channel, not
 * through that closure.
 */
let activeTray: Tray | null = null;

/**
 * `new Tray(image)`.
 *
 * The icon argument is ignored: Rust resolves the tray icon from the resource
 * directory so it can also swap it when the system theme changes, which the
 * sidecar cannot observe.
 */
export class Tray extends EventEmitter {
  /** Public so control messages can dispatch into the attached menu. */
  public menu: Menu | null = null;
  private tooltip = "Sphinx Launcher";

  constructor(_image?: unknown) {
    super();
    // `createSystemTray` keeps its own reference, but control messages arrive
    // on the RPC channel and need a way back to this instance.
    activeTray = this;
  }

  public setToolTip(tooltip: string): void {
    this.tooltip = tooltip;
    void hostRpc()
      .request("tray.setTooltip", { tooltip })
      .catch(() => undefined);
  }

  /**
   * `tray.setContextMenu(menu)`.
   *
   * The first call creates the tray; later calls replace the menu, which is what
   * the baseline relies on (`updateSystemTray` runs before every popup).
   */
  public setContextMenu(menu: Menu): void {
    this.menu = menu;
    const payload = { ...menu.toWire(), tooltip: this.tooltip };

    void hostRpc()
      .request("tray.create", payload)
      .then((result) => {
        // The tray already existed: `tray.create` only attaches the first menu.
        if ((result as { created?: boolean } | undefined)?.created === false) {
          return hostRpc().request("tray.setMenu", payload);
        }
        return undefined;
      })
      .catch((error: unknown) => {
        console.error("[tray] cannot attach the menu", error);
      });
  }

  /**
   * `tray.popUpContextMenu(menu)`.
   *
   * On Windows the native tray shows its attached menu on right-click, so the
   * only thing left to do is refresh the contents — which is exactly what the
   * baseline used this call for.
   */
  public popUpContextMenu(menu?: Menu): void {
    const target = menu ?? this.menu;
    if (!target) return;

    this.menu = target;
    void hostRpc()
      .request("tray.setMenu", { ...target.toWire(), tooltip: this.tooltip })
      .catch((error: unknown) => {
        console.error("[tray] cannot refresh the menu", error);
      });
  }

  public setImage(): void {
    // Theme-derived in Rust; see `tray_icon()` in src-tauri/src/tray.rs.
    void hostRpc()
      .request("tray.setIcon", {})
      .catch(() => undefined);
  }

  public destroy(): void {
    this.menu = null;
    void hostRpc()
      .request("tray.remove", {})
      .catch(() => undefined);
  }
}

/**
 * Routes a `control tray-click` message to the menu that is currently attached.
 *
 * Returns false when the id belongs to a menu that has since been replaced,
 * which happens if the user clicks while the sidecar is rebuilding it.
 */
export const dispatchTrayClick = (tray: Tray | null, id: string): boolean =>
  tray?.menu?.dispatch(id) ?? false;

/** Routes a `control tray-event` message to the listeners the baseline added. */
export const dispatchTrayEvent = (tray: Tray | null, kind: string): void => {
  tray?.emit(kind);
};

export const getActiveTray = (): Tray | null => activeTray;
