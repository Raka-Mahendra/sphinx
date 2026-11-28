# Releasing Sphinx Launcher

Everything here is verified against the Tauri v2 documentation and the CLI
schema that ships with this repository
(`node_modules/@tauri-apps/cli/config.schema.json`). Where the documentation
disagrees with the PRD, the disagreement is written down instead of quietly
resolved. See [`docs/upstream-policy.md`](./upstream-policy.md) for why the
updater and release workflow point at `Raka-Mahendra/sphinx` rather than
upstream.

---

## 1. Two kinds of key — they are not interchangeable

|                | Updater key (minisign)                                                                                                                                                                            | Authenticode certificate                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| What it signs  | The update _bundle_ (`.sig` next to the installer)                                                                                                                                                | The installer and the binaries inside it                                                     |
| What it proves | "This update was produced by whoever holds the updater key"                                                                                                                                       | "This installer was produced by whoever holds the certificate"                               |
| Created with   | `yarn tauri signer generate -w ~/.sphinx-updater/sphinx-updater.key --ci` (passwordless)                                                                                                          | A CA (a paid OV/EV certificate, or `signtool` + a self-signed cert for testing)              |
| Where it lives | `TAURI_SIGNING_PRIVATE_KEY`, scoped to the `release-signing` environment (recommended) or the repository (see §12). This key is passwordless, so the password secret is intentionally unset (§9). | `WINDOWS_CERTIFICATE` (base64 `.p12`) + `WINDOWS_CERTIFICATE_PASSWORD` as repository secrets |
| Losing it      | **Existing installs can never be auto-updated again** — the app verifies every update against the public key baked into `tauri.conf.json`, so users need a manual reinstall (§10)                 | You cannot sign future releases; users keep seeing SmartScreen                               |
| Used in v1     | **Yes**                                                                                                                                                                                           | **No** (opt-in, see §6)                                                                      |

Both credentials live outside the repository and must be backed up offline (§3),
but they are different credentials for different purposes. Rotating one says
nothing about the other.

The updater key for this project is **passwordless**. Only
`TAURI_SIGNING_PRIVATE_KEY` is required — preferably as an environment secret on
`release-signing` (§12), not repository-wide;
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is intentionally unset. GitHub evaluates an
unset secret to an empty string, and Tauri accepts an empty password for a key
that has none. Never invent a password for this key.

### What has and has not been proven

These are different claims and must not be collapsed into "signing works":

| Claim                                           | Status                 | Evidence                                                                                                                                  |
| ----------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins.updater.pubkey` matches the keypair    | **Verified locally**   | Public key file and config decode to the same 42-byte blob; key ID `96C5E41CD0651543`                                                     |
| The key is passwordless                         | **Verified locally**   | Signing succeeds with no password and with an explicit empty string; a wrong password fails with `Wrong password for that key`            |
| The published `v0.1.0` signature is valid       | **Verified locally**   | `scripts/verify-updater-signature.mjs` verifies the installer's `.sig` and global signature against the committed public key              |
| `TAURI_SIGNING_PRIVATE_KEY` exists in GitHub    | **Unverified**         | A secret cannot be read back; this checkout has no authenticated `gh`/API access. Confirm it in the `release-signing` environment (§12)   |
| `release-signing` environment is protected      | **Not yet configured** | Both signing workflows declare it, but the owner must create it with a required reviewer and `sphinx/main` rule before any push (see §12) |
| GitHub Actions can build **and sign**           | **Not yet proven**     | Run the manual smoke workflow in §11 (after §12); no run has happened yet                                                                 |
| A production release was built and signed by CI | **Not yet**            | The only release run failed at `Build the bundle`; the public 0.1.0 bundles `node.exe` 24.22.1, not the CI-pinned 22.21.0                 |
| A clean machine installs and runs the app       | **Not run**            | §8                                                                                                                                        |
| The updater works end to end (`0.1.0 → next`)   | **Not run**            | Issue #2                                                                                                                                  |

> **Verification status.** The workflow's `Require the updater signing key`
> step checks non-emptiness only. Local signatures prove the key and the
> verification algorithm; they do **not** prove the GitHub secret exists or that
> Actions can use it. The `release-signing` environment must also exist with a
> required reviewer before any push (§12). Only a smoke run in §11 (or a real
> signed release) proves that CI can sign.

---

## 2. Releasing

```sh
# 1. Make sure the three version sources agree with the tag you are about to push.
yarn release:check-version v0.1.0

# 2. Push the tag. The workflow does the rest.
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/tauri-release.yml` runs on `v*` tags only and has three jobs:

| Job       | Permissions       | What it does                                                                                                                 |
| --------- | ----------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `build`   | `contents: read`  | Version check → renderer + sidecar → `yarn stage:node` → `tauri build` (signed if the certificate secret exists) → artefacts |
| `draft`   | `contents: write` | Builds `latest.json` + `SHA256SUMS`, creates a **draft** release, uploads everything                                         |
| `publish` | `contents: write` | Publishes the draft                                                                                                          |

The build job is the only one that reads the signing secrets, and it has no
release permission at all: a fork pull request cannot push a tag, and even a
compromised fork cannot publish. Nothing can appear under
`releases/latest` until the `publish` job runs, so a half-uploaded release can
never be picked up by the updater.

The Electron workflows were deleted in Fase 8; `tauri-release.yml` is the only
release path in the repository.

### What lands in the release

| File                                      | Purpose                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `sphinx-launcher_<version>_x64-setup.exe` | The installer users download                                                   |
| `…-setup.exe.sig`                         | The minisign signature the updater verifies                                    |
| `latest.json`                             | The update manifest (`windows-x86_64` only for now)                            |
| `SHA256SUMS`                              | Checksums for both of the above, so a browser download can be verified by hand |

`latest.json` is generated by `scripts/make-update-manifest.mjs`, not by
`tauri-action`, because this release flow builds first and publishes afterwards —
the action can only emit `latest.json` when it uploads the release itself. The
script and version-alignment helper are verified by unit tests in `scripts/`
(`scripts/make-update-manifest.test.mjs` and `scripts/bump-version.test.mjs`).

The updater endpoint is `releases/latest/download/latest.json`, and GitHub's
`latest` route **skips prereleases**. A release marked as a prerelease on GitHub
therefore makes every installed copy fail its update check with a 404. Publish
normal releases and put the alpha or beta status in the title and body. If a
build really must be a GitHub prerelease, point `plugins.updater.endpoints` at
that tag and accept that it will not roll forward on its own.

### The build needs no `.env`

The release runner has no `.env`, and it must not need one. `scripts/build-sidecar.mjs`
defines every `import.meta.env.MAIN_VITE_*`/`RENDERER_VITE_*` key the sources read
and falls back to an empty string, which is the "not configured" state the
account features already expect. (Before this, a build without `.env` produced a
sidecar that booted but registered no IPC handlers at all.)

The only build secret for the updater is the private key in §1; this key has no
password. The optional Authenticode certificate in §6 is a separate credential.

---

## 3. Backing the keys up

**Do this now, and do it once, properly.** `v0.1.0` is already public. The
28 November 2026 check found one copy of the key on the development laptop and
no offline backup; no exhaustive search of every disk, cloud account or password
manager was performed. The GitHub repository secret is not a backup: GitHub does
not let you read a secret back.

1. **Use offline, encrypted storage.** Put the key file in an encrypted
   container that is not this laptop: a BitLocker/VeraCrypt USB drive kept
   offline, or an encrypted archive on removable media. A password-manager
   attachment is acceptable only as a _secondary_ copy in an end-to-end
   encrypted vault. Do not put the raw key in a cloud-synced folder (OneDrive,
   Dropbox, iCloud, Google Drive) or anywhere inside this repository.
2. **Verify the backup before trusting it.** From the backup copy, sign a
   throwaway file and verify it against the _committed_ public key:

   ```powershell
   yarn tauri signer sign -f <backup-key-path> .\backup-check.txt
   node scripts/verify-updater-signature.mjs `
     --file .\backup-check.txt `
     --signature .\backup-check.txt.sig `
     --config src-tauri/tauri.conf.json `
     --expect-key-id 96C5E41CD0651543
   ```

   The script must print `"ok": true` with key ID `96C5E41CD0651543`. A copy
   that cannot produce that result is not a backup. Delete the throwaway file
   and signature afterwards; never publish them.

3. **Restrict access.** On Windows the key currently has an ACL for `SYSTEM`,
   `Administrators` and the current user only. Keep it that way, for example:

   ```powershell
   icacls <backup-key-path> /inheritance:r `
     /grant:r "${env:USERNAME}:(R,W)" "Administrators:(F)" "SYSTEM:(F)"
   ```

4. **Record location, not content.** Write down where the backup is and how to
   reach it. Never put the key or a passphrase in this repository, an issue, a
   chat, or a workflow artifact.
5. **This key has no password.** There is nothing to record for it. If you ever
   create a key with a password, store the password separately from the key.
6. **Prove it stays out of Git.** The key lives outside the checkout, and the
   backup medium must never be copied into it. Before publishing, confirm:

   ```powershell
   git log --all -- "**/.sphinx-updater/**"   # expected: no output
   git grep -n "minisign secret key"          # expected: no match (exit 1)
   ```

7. **Tell one other trusted person** that the backup exists and how to get to
   it, without handing them the key or a passphrase.
8. **Recovery** after loss or compromise is a release-time operation; see §10.
   Do not create or upload a backup automatically: the owner chooses the medium
   and authorizes the copy.

A key that exists in exactly one place, on one developer's laptop, is a key the
project does not really have.

`docs/release.md` is not the place to store either the key or any password. The
private key generated for this project is at
`C:\Users\<you>\.sphinx-updater\sphinx-updater.key` — outside the repository on
purpose, and `.gitignore` never sees it.

### Rotating the updater key

Rotation is a release-time action, and it has a sharp edge: **the public key in
`tauri.conf.json` must match the key that signed the update**. The order is:

1. Generate a new keypair.
2. Ship a release **signed with the old key** that contains the new public key.
   Users on the previous release install it, because their app still verifies
   with the old key.
3. From the next release on, sign with the new key and use the new public key.

If you rotate the public key in the same release that is signed with the old
one, users of the previous release reject the update — they are checking with a
key they do not have yet.

---

## 4. Versions

`scripts/bump-version.mjs` is the single tool that touches versions, and the CI
check in the release workflow fails the build if `package.json`,
`src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` disagree with the tag.

```sh
node scripts/bump-version.mjs 0.2.0        # write
node scripts/bump-version.mjs --check v0.2.0  # verify only (what CI runs)
```

**Pure `X.Y.Z` only.** The script rejects anything else, because:

- the Tauri updater compares the version in `latest.json` against the running
  app's version, and a pre-release build (`0.2.0-beta.1`) would report itself as
  _newer_ than the stable `0.2.0` that follows it;
- MSI/WiX does not accept non-numeric version suffixes at all
  (<https://wixtoolset.org/docs/v4/>), and this project ships NSIS now but may
  add MSI later.

Test releases use the same scheme: `v0.0.1`, `v0.0.2`, in a throwaway
repository or as a draft that is deleted afterwards (§8).

---

## 5. Installer options, and what `installMode: passive` actually means

The PRD asks for `installMode: passive`. That value exists — but for the
**updater**, not for the installer. Two different settings:

| Setting                               | Where             | Allowed values                      | This project                                                |
| ------------------------------------- | ----------------- | ----------------------------------- | ----------------------------------------------------------- |
| `plugins.updater.windows.installMode` | `tauri.conf.json` | `passive`, `basicUi`, `quiet`       | **`passive`** (the default: a progress bar, no interaction) |
| `bundle.windows.nsis.installMode`     | `tauri.conf.json` | `currentUser`, `perMachine`, `both` | **`currentUser`**                                           |

Verified from `node_modules/@tauri-apps/cli/config.schema.json` — `passive` is
**not** a valid `NSISInstallerMode`, so it cannot be used for the installer.
Source: <https://v2.tauri.app/distribute/windows-installer/>

The rest of the installer is matched to the Electron baseline
(`electron-builder.yml`, `nsis:` block):

| Baseline (electron-builder)                                 | Tauri NSIS                                     | Same?                                                                                                                       |
| ----------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `oneClick: false`                                           | NSIS is always a wizard                        | Yes, by construction: the default template always inserts the MUI welcome/license/directory/install/finish pages            |
| `allowToChangeInstallationDirectory: true`                  | The default template offers the directory page | Yes: `!insertmacro MUI_PAGE_DIRECTORY` in the bundled `installer.nsi`, skipped only for `/P` passive mode                   |
| `createDesktopShortcut: always`                             | The default template creates the shortcut      | Yes: `MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut`, plus desktop shortcuts for silent/passive installs |
| per-user install (`perMachine` unset)                       | `installMode: currentUser`                     | Yes                                                                                                                         |
| `shortcutName` / `uninstallDisplayName` = `Sphinx Launcher` | `productName` is used for both                 | Yes                                                                                                                         |
| `artifactName: ${name}-${version}-setup.exe`                | `sphinx-launcher_<version>_x64-setup.exe`      | Normalized in the `draft` job (removes spaces so GitHub Releases preserves the exact URL)                                   |
| `include: installer.nsh` (custom NSIS hooks)                | `bundle.windows.nsis.installerHooks`           | Available, not needed yet                                                                                                   |
| `portable` target                                           | not shipped                                    | Portable is dropped on purpose (PRD §4.E)                                                                                   |

The "same?" column for the first three rows was checked against the template
Tauri actually bundles, not inferred from the config schema:
<https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi>
(checked 27 November 2026). `NsisConfig` itself has no
`allowToChangeInstallationDirectory` or `oneClick` key; the directory page is
part of the template, which is why no config field is needed.

`PORTABLE_EXECUTABLE_FILE` logic is removed/disabled across
`src/main/helpers/shortcut-launch.ts`, `src/main/helpers/hydra-executable-path.ts`,
`src/main/helpers/index.ts`, and `src/preload/index.ts` because no portable build
exists.

---

## 6. Authenticode signing (optional, off by default)

Signing is not an input of `tauri-action`; it is Tauri config. When
`WINDOWS_CERTIFICATE` is present, the workflow writes a temporary JSON file
(`tauri-signing.json`) and passes it with `--config <path>` so secrets never
touch shell interpolation:

```json
{
  "bundle": {
    "windows": {
      "signCommand": "signtool.exe sign /fd SHA256 /tr <timestamp-url> /td SHA256 /f <cert.p12> /p <password> %1"
    }
  }
}
```

`%1` is required and is replaced by the path of the file to sign. Reference:
<https://v2.tauri.app/reference/config/#signcommand>

The step is skipped entirely unless `WINDOWS_CERTIFICATE` is present, so a fork
or a local build produces an unsigned installer with no extra configuration.
The certificate is a _different credential_ from the updater key (§1): buying one
does not rotate the other.

---

## 7. What "restart = install" means

On Windows `Update::install` spawns the installer and exits the app
(std::process::exit(0)) — it never returns. The two-stage UX in the UI is
unchanged from the baseline:

1. `checkForUpdates()` → `{ type: "update-available", info: { version } }` → the
   header shows "version available";
2. the download starts → `{ type: "update-downloaded" }` → the button becomes
   "restart to install";
3. clicking it calls `restartAndInstallUpdate` → `updater.install` → the app
   exits and the installer runs.

Before the installer runs, `on_before_exit` stops the sidecar through the normal
shutdown RPC (including `torrentShutdown`), so the installer never has to replace
a `node.exe` or a `hydra-native.node` that is still open. A game that is already
running is a detached process and is not touched.

On macOS and Linux `install` returns without exiting, and the app has to be
relaunched — that path is not shipped yet (Fase 9).

---

## 8. Manual test plan (Windows 10 and 11, clean machines)

This cannot be automated from this repository, and it is the PRD's decision gate
(§4.E). Run it on a clean VM or a sandbox, with Defender _at its defaults_, and
record each observation separately.

**Setup:** two clean machines (Windows 10 and Windows 11), no prior install, a
browser, and a user account that is _not_ an administrator.

1. Download `sphinx-launcher_0.0.1_x64-setup.exe` from the GitHub Releases page.
2. Run it.
3. Open the app, confirm it starts, then close it.
4. Tag `v0.0.2`, let the workflow finish, then run the app from step 2 again.
5. Confirm the banner appears, the download completes, and "restart to install"
   updates the app to 0.0.2.
6. Repeat steps 1–5 on the Windows 10 machine.

**Record separately** (they are different failure modes and different fixes):

| Observation                                                             | What it means                                                                                                                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SmartScreen on the **browser download**                                 | "Windows protected your PC" from `releases.githubusercontent.com`. Expected for every unsigned new release; the README explains "More info → Run anyway".                                     |
| SmartScreen on the **self-update**                                      | The updater's installer is launched by the app, not the browser, so it normally does **not** show SmartScreen. If it does, the update path is broken.                                         |
| Smart App Control (Windows 11)                                          | Blocks _unknown_ publishers outright. If the machine has SAC on, an unsigned installer is not installable — that is a hard block, not a warning, and it makes signing a release prerequisite. |
| Windows Defender on `node.exe`, `hydra-native.node`, the torrent engine | False positives are common for bundled runtimes. Confirm the files hash-match `SHA256SUMS` before reporting.                                                                                  |
| Files locked during update                                              | If the installer fails with "file in use", a sidecar process survived the exit. Check the log for `shutdown-complete`.                                                                        |
| Processes left behind                                                   | After the update, check Task Manager for `node.exe`. Any survivor means the supervisor's shutdown budget was too short.                                                                       |

If any machine shows a **hard block** (Smart App Control, or an installer that
cannot run at all), signing becomes a prerequisite for the public release
(PRD §4.E, "Gerbang keputusan").

---

## 9. Where the keypair for this project lives

Generated with:

```sh
mkdir -p ~/.sphinx-updater
yarn tauri signer generate -w ~/.sphinx-updater/sphinx-updater.key --ci
```

`--ci` skips the password prompt, so this keypair is **passwordless**. Its public
key (ID `96C5E41CD0651543`) is the value in `tauri.conf.json` →
`plugins.updater.pubkey`; it is committed. The private key is not.

The only signing secret this project requires is
`TAURI_SIGNING_PRIVATE_KEY`. Scope it to the `release-signing` environment (§12)
rather than the repository, so only workflows that declare that environment can
read it. Its presence cannot be proven from the repository (see the verification
note in §1); a signed build in Actions is the proof.
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is intentionally **unset**: GitHub returns
an empty string for a missing secret
([GitHub docs](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions)),
and Tauri documents the password as optional
([Tauri updater docs](https://v2.tauri.app/plugin/updater/)). Setting a made-up
password would make every signing attempt fail with `Wrong password for that
key`.

### What passwordless means for security

- Anyone who can read the key file, or obtain the environment secret, can sign
  an update. There is no passphrase as a second factor.
- Repository administrators can replace the secret, and a workflow that declares
  the `release-signing` environment (and is approved) can use it. Protect
  `sphinx/main` and review workflow changes; masking in logs does not stop a
  malicious workflow from using a secret.
- The file is protected by the operating system ACL only. Keep it outside the
  repository, out of cloud-sync folders, and backed up on an encrypted medium.
- GitHub masks the secret in logs, but never echo it or pass it on a command
  line. The workflow passes it through `env:` and Tauri reads it there.
- If the key is lost, existing installs can no longer be updated. The public
  `v0.1.0` installer already trusts this key (its `.sig` has the same key ID),
  so rotation is a release-time operation, not a file edit: ship a release
  signed with the old key that contains the new public key first. See §3.
- Tauri's CLI has no documented command to add a password to an existing key.
  Wanting a passphrase means generating a new keypair and rotating it with that
  sequence.

---

## 10. Recovery: lost or compromised updater key

The updater has no revocation list. The public key baked into the installed app
is the only trust anchor, so recovery is a release-time operation, not a GitHub
setting.

### If the private key is lost (no evidence of compromise)

1. Stop the release workflow before the next tag: remove or rotate the
   `TAURI_SIGNING_PRIVATE_KEY` secret so a broken pipeline fails fast.
2. Generate a new keypair and update `plugins.updater.pubkey`.
3. Existing installs **cannot verify** the new key, because they still trust the
   old one. Ship a one-time manual reinstall (new keypair from the start), or
   accept that older installs must be replaced by hand.
4. Publish the new installer with its new `.sig`, `latest.json` and
   `SHA256SUMS`, and announce that the old installs need a manual download.

There is no bridge release when the old private key is gone: bridge rotation
(§3) needs the old key to sign the release that carries the new public key.

### If the private key is compromised

A holder of the key can sign an update that every existing install accepts.
Treat this as a supply-chain incident, not a password reset.

1. Remove the environment (and any repository) secret and disable the release
   workflow immediately.
2. Do **not** publish anything signed with the compromised key except a
   deliberately reviewed bridge release, and only if you still control the
   signing path. If the attacker can also publish releases, assume they can
   impersonate an update.
3. Publish a security advisory naming the affected versions and the expected
   new key ID.
4. Generate a new keypair, ship a bridge release signed with the old key that
   contains the new `pubkey`, then revoke the old key everywhere (secret,
   backups, CI caches).
5. Ask users to verify the installer hash against `SHA256SUMS` published in the
   advisory, and to prefer a fresh download from the repository over the
   in-app updater until the bridge release is out.

### If a release is mis-signed or a wrong asset is uploaded

Draft releases are safe to edit: replace the asset and regenerate `latest.json`
and `SHA256SUMS` **before** the `publish` job runs. Once published, do not
silently replace assets — publish a new patch version, because installs may
already have cached the old `latest.json` and its signature.

---

## 11. Proving CI signing without publishing

The release workflow runs only on tags, and a tag publishes. To prove that the
GitHub Actions environment can use the existing key **without** creating a
release, run the manual smoke workflow:

`.github/workflows/tauri-signing-smoke.yml`

It is deliberately separate from the release pipeline:

| Property                     | Smoke workflow                                            | Release workflow                                  |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------- |
| Trigger                      | `workflow_dispatch` only                                  | `v*` tag                                          |
| Allowed ref                  | `sphinx/main` in `Raka-Mahendra/sphinx` only              | tag in `Raka-Mahendra/sphinx`                     |
| Permissions                  | `contents: read`                                          | `contents: read` build, `write` for draft/publish |
| Environment                  | `release-signing`, required reviewer                      | `release-signing`, required reviewer              |
| Signing secret               | `TAURI_SIGNING_PRIVATE_KEY` only, empty password          | same                                              |
| Builds the real NSIS package | yes                                                       | yes                                               |
| Creates a tag or release     | **no**                                                    | yes                                               |
| Uploads production assets    | **no** (Actions artifact only)                            | yes                                               |
| Publishes `latest.json`      | **no** (generated in the runner and uploaded as evidence) | yes                                               |

### What it does

0. The job enters the `release-signing` environment and **waits for a required
   reviewer's approval** before any step runs. Nothing is checked out, installed
   or signed until that approval is granted.
1. Checks out `sphinx/main` and asserts the three version sources agree.
2. Fails before the build if `TAURI_SIGNING_PRIVATE_KEY` is empty; it never
   echoes the value.
3. Installs dependencies with `--frozen-lockfile --ignore-scripts`, downloads
   ludusavi, stages the Node runtime, builds the native torrent addon and checks
   the packageable resources — the same steps as the release build.
4. Runs `yarn tauri build`. `bundle.createUpdaterArtifacts` is `true`, so Tauri
   produces the installer **and** its `.sig`.
5. Renames the installer to `sphinx-launcher_<version>_x64-setup.exe` and
   generates `latest.json` + `SHA256SUMS` in `signing-smoke-evidence/`.
6. Runs `scripts/verify-updater-signature.mjs`, which mirrors
   `tauri-plugin-updater`: key ID, Ed25519 over the BLAKE2b-512 prehash (or the
   legacy raw bytes), the global signature over signature + trusted comment, and
   the manifest's version/URL/signature. It asserts the key ID is
   `96C5E41CD0651543`.
7. Refuses to upload anything outside the five evidence files, then uploads them
   as the `signing-smoke-evidence` Actions artifact (3 days).

The workflow has no `contents: write`, no release action, no `tauri-action`, and
no tag step.

### How to run it

The order matters: the `release-signing` environment must exist **with
protection rules** before the workflow file reaches `sphinx/main`. Otherwise the
push itself would let GitHub auto-create an unprotected environment (see §12).

1. **Owner creates and protects the `release-signing` environment** exactly as
   described in §12, then adds the environment secret
   `TAURI_SIGNING_PRIVATE_KEY`. Do not paste the key into this repository, an
   issue, or a chat.
2. The workflow file must exist on `sphinx/main`. Pushing it requires owner
   authorization; the file being on a local branch is not enough for
   `workflow_dispatch`.
3. Run it from the Actions UI: **Tauri Signing Smoke → Run workflow → branch
   `sphinx/main`**. The run then waits in **Review pending deployments** until a
   required reviewer approves it. Or, with an authenticated `gh`:

   ```sh
   gh workflow run tauri-signing-smoke.yml --ref sphinx/main
   gh run watch
   gh run download <run-id> -n signing-smoke-evidence
   ```

4. Read `signature-verification.json`. The run is a success only when all of
   these hold:

   ```json
   {
     "key_id": "96C5E41CD0651543",
     "expected_key_id": "96C5E41CD0651543",
     "key_id_ok": true,
     "signature_ok": true,
     "global_signature_ok": true,
     "manifest": { "ok": true },
     "ok": true
   }
   ```

5. Record the run URL and the JSON result on issue #5.

### How to read a failure

| Where it fails                                      | What it means                                                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `Require the updater signing key`                   | The secret is absent (or empty). Nothing was built. Fix the secret; do not invent a password.                                                 |
| `Build and sign the Windows bundle`, wrong password | A password secret is set for a passwordless key. Remove `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.                                                 |
| `Build and sign the Windows bundle`, signing error  | The secret is not the key whose public half is in `tauri.conf.json`, or the key is damaged. Compare the key ID; never print the key.          |
| `Verify the signature and the manifest`             | The build produced a signature that does not match the committed public key, or the manifest is inconsistent. Treat the artifact as unusable. |
| Any build error before signing                      | A build/toolchain problem, not a signing proof. The secret's presence is still unproven.                                                      |

### What a pass proves — and does not

A pass proves that a GitHub-hosted Windows runner built the real package and
signed its updater artifact with the key whose public half is committed. That is
the evidence issue #5 needs for "CI can sign".

It does **not** prove:

- that a **published** release works (`make_latest`, draft finalization, asset
  upload) — that needs an authorized tag;
- that the installer passes SmartScreen/Smart App Control (§8);
- that the updater downloads, installs, stops the sidecar and rolls forward
  (issue #2);
- that the GitHub secret will still exist at the next tag. Re-run the smoke test
  after any secret or workflow change.

Never upload the smoke run's `latest.json` to a release. Its URL points at
`v0.1.0`, and replacing the production manifest is exactly the kind of change
this workflow exists to avoid.

---

## 12. Protecting the signing environment

Both signing jobs (`tauri-release.yml` → `build`, `tauri-signing-smoke.yml` →
`sign`) declare:

```yaml
environment:
  name: release-signing
```

An environment is an approval gate: the job is created, then it pauses at
**Review pending deployments** until a listed reviewer approves it. No step —
checkout, install, build or signing — runs before that approval. It is the one
place where a human confirms "yes, sign with this key now".

### Why the environment must exist before the workflow is pushed

A workflow that references a GitHub Environment by name can make GitHub
**create** that environment on first use, and a freshly auto-created environment
has no protection rules. In that case the job would run immediately and the
approval gate would silently not exist. The order is therefore not optional:

1. Create and protect `release-signing` (below).
2. Confirm `TAURI_SIGNING_PRIVATE_KEY` is available in that scope.
3. **Then** authorise the push that puts the workflow files on `sphinx/main`.

### Create and protect the environment

In `Raka-Mahendra/sphinx` → **Settings** → **Environments** → **New
environment**:

| Setting                             | Value                                                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Name                                | `release-signing`                                                                                                                            |
| Required reviewers                  | at least one trusted reviewer (the owner, and ideally a second person)                                                                       |
| Prevent self-review                 | **on** once a second trusted reviewer exists; leave off while the owner is the only reviewer, or the owner could never approve their own run |
| Deployment branches and tags        | **Selected branches and tags** → branch `sphinx/main` **and** tag pattern `v*` (see the note below)                                          |
| Wait timer                          | 0 (optional; a delay is not a substitute for review)                                                                                         |
| Administrator bypass / bypass rules | **disable where the plan supports it**; if it cannot be disabled, record that admins can still bypass                                        |

The deployment rule must allow **both** `sphinx/main` and `v*` tags:

- the smoke workflow runs on the `sphinx/main` branch;
- the release workflow runs on a `v*` tag, so restricting the environment to the
  branch alone would make every tag build fail at the environment gate. That
  would break the existing tag-triggered release architecture.

Allowing `v*` does not weaken the gate: a tag still needs the required reviewer's
approval, and `tauri-release.yml` only runs on tags in this repository. Each
workflow also keeps its own `if:` ref check, so an approval cannot be reused for
a different ref.

### Move the signing secret into the environment scope

Prefer an **environment secret** over a repository secret: only workflows that
declare the environment can read it, so the set of workflows that can reach the
key is explicit and small. The key itself does not change — no rotation, no new
public key.

Safe migration (the key never leaves GitHub):

1. In the new environment → **Environment secrets** → **Add secret** →
   `TAURI_SIGNING_PRIVATE_KEY`, pasting the existing key. **Do not** create
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`; this key is passwordless and the
   workflow passes an explicit empty string.
2. Keep the existing repository-level secret for now. An environment secret with
   the same name takes precedence for jobs that declare the environment, so the
   value is unambiguous.
3. Run the smoke workflow (§11) once and confirm `signature-verification.json`
   shows `ok: true` — that proves the environment secret works.
4. Only after a green smoke run, **delete** the repository-level
   `TAURI_SIGNING_PRIVATE_KEY`, leaving the key reachable solely through
   `release-signing`.

Until step 3 passes, do not delete the repository secret: removing the only
working copy would leave no way to sign until it is re-added.

### What the environment does and does not protect

- **Does:** require a human approval before any step of a signing job runs;
  restrict which branch/tag may consume the environment; scope the secret so only
  environment-declaring workflows can read it.
- **Does not:** protect against a malicious edit to a workflow file that still
  names the environment — a reviewer must read the diff before approving. It also
  adds no passphrase: the key is passwordless, so anyone who can read the secret
  can sign. Protect `sphinx/main` and review workflow changes for that reason.
