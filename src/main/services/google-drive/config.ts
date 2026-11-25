/**
 * Google OAuth client configuration.
 *
 * The client is embedded in the Rust shell at build time (`GOOGLE_CLIENT_ID` /
 * `GOOGLE_CLIENT_SECRET`), which forwards it to this process as
 * `SPHINX_GOOGLE_CLIENT_ID` / `SPHINX_GOOGLE_CLIENT_SECRET`. Nothing is read
 * from the repository, and there is no in-app field to replace it: a fork
 * overrides it with its own build environment (PRD §4.F).
 *
 * The scope is fixed to `drive.appdata`. There is deliberately no
 * `drive.file`, `drive`, or `userinfo.email` here: the consent screen must ask
 * for application data only, and the app never needs the user's address.
 */

export const GOOGLE_DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive.appdata";

export const GOOGLE_OAUTH_AUTHORIZATION_ENDPOINT =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_ENDPOINT =
  "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_REVOKE_ENDPOINT =
  "https://oauth2.googleapis.com/revoke";
export const GOOGLE_DRIVE_API_BASE = "https://www.googleapis.com";
export const GOOGLE_DRIVE_UPLOAD_BASE = "https://www.googleapis.com";

export interface GoogleDriveConfig {
  clientId: string;
  clientSecret: string;
  configured: boolean;
}

type Env = Record<string, string | undefined>;

export const readGoogleDriveConfig = (
  env: Env = process.env as Env
): GoogleDriveConfig => {
  const clientId = env.SPHINX_GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.SPHINX_GOOGLE_CLIENT_SECRET?.trim() ?? "";

  return {
    clientId,
    clientSecret,
    configured: clientId.length > 0,
  };
};

export const isGoogleDriveConfigured = (env?: Env): boolean =>
  readGoogleDriveConfig(env).configured;
