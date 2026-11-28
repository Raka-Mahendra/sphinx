/**
 * Steam developer/publisher lists.
 *
 * The list is served by the `getCatalogueNames` IPC handler, which keeps a
 * 24-hour LevelDB cache in the main process. A renderer can be served over the
 * air to an older app whose preload predates that handler, so fall back to the
 * direct API call it replaced when the bridge member is missing.
 */
export const loadCatalogueNames = (
  list: "developers" | "publishers"
): Promise<string[]> =>
  typeof window.electron.getCatalogueNames === "function"
    ? window.electron.getCatalogueNames(list)
    : window.electron.hydraApi.get<string[]>(`/catalogue/steam/${list}`, {
        needsAuth: false,
      });
