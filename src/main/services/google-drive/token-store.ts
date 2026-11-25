/**
 * Refresh-token storage.
 *
 * The token never goes into LevelDB: it is written through the shell's
 * `keychain.*` RPC, which uses the OS credential store (Windows Credential
 * Manager, macOS Keychain, Secret Service on Linux). When that store is
 * unavailable the token stays in memory for this process only, and the caller
 * has to tell the user that the connection will not survive a restart
 * (PRD §4.F).
 */

export const GOOGLE_DRIVE_REFRESH_TOKEN_ACCOUNT = "google-drive-refresh-token";

export interface SecretStore {
  get(account: string): Promise<string | null>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
}

export type RefreshTokenStorage = "keychain" | "memory" | "none";

/**
 * The shell owns the OS keychain. Importing the shim's host module is safe in
 * the sidecar (it is the same process) and keeps the credential API in one
 * place instead of re-deriving the RPC envelope here.
 */
export const createShellKeychainStore = (): SecretStore => {
  const call = async (method: string, params: Record<string, unknown>) => {
    const { hostRpc } = await import("../../../sidecar/electron-shim/host.js");
    return hostRpc().request<unknown>(method, params);
  };

  return {
    async get(account) {
      const value = await call("keychain.get", { account });
      return typeof value === "string" && value.length > 0 ? value : null;
    },
    async set(account, secret) {
      await call("keychain.set", { account, secret });
    },
    async delete(account) {
      await call("keychain.delete", { account });
    },
  };
};

export class RefreshTokenStore {
  private memoryToken: string | null = null;
  private storage: RefreshTokenStorage = "none";
  private warnedAboutMemory = false;

  constructor(
    private readonly secrets: SecretStore,
    private readonly account = GOOGLE_DRIVE_REFRESH_TOKEN_ACCOUNT
  ) {}

  getStorage(): RefreshTokenStorage {
    return this.storage;
  }

  async load(): Promise<string | null> {
    try {
      const token = await this.secrets.get(this.account);
      if (token) {
        this.storage = "keychain";
        return token;
      }
    } catch {
      // The shell may not have a working secret service; fall through to the
      // in-memory token so this session still works.
    }

    if (this.memoryToken) {
      this.storage = "memory";
      return this.memoryToken;
    }

    this.storage = "none";
    return null;
  }

  async save(token: string): Promise<RefreshTokenStorage> {
    this.memoryToken = token;
    try {
      await this.secrets.set(this.account, token);
      this.storage = "keychain";
    } catch {
      this.storage = "memory";
      this.warnedAboutMemory = true;
    }
    return this.storage;
  }

  async clear(): Promise<void> {
    this.memoryToken = null;
    this.storage = "none";
    try {
      await this.secrets.delete(this.account);
    } catch {
      // Nothing to do: the token is gone from this process either way.
    }
  }

  /** True when the token could not be persisted and will be lost on exit. */
  isMemoryOnly(): boolean {
    return this.storage === "memory" || this.warnedAboutMemory;
  }
}
