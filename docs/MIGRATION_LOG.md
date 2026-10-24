# Sphinx Launcher — Migration Log

Dokumen ini mencatat eksekusi migrasi Hydra Launcher 4.1.6 ke Sphinx Launcher
sesuai `PRD.md` v2.2. Fase 0 bersifat audit dan dokumentasi; kode aplikasi tidak
diubah.

## Fase 0 — Todo

1. [x] Clone penuh `hydralauncher/hydra` ke folder terpisah dan catat versi + SHA.
2. [x] Bandingkan direktori kerja dengan clone upstream.
3. [x] Siapkan riwayat upstream, remote `upstream`, tag `baseline-hydra`, dan
       branch `sphinx/tauri-migration` di repo lokal.
4. [x] Pasang dependensi dan jalankan build Electron asli sebagai pembanding.
       Runtime `dev` belum dijalankan; build produksi sudah lulus.
5. [ ] Verifikasi `hydra-native.node`, `sharp`, dan `classic-level` di Node LTS.
       `sharp` dan `classic-level` lulus; `hydra-native.node` tidak tersedia dan
       tidak dapat dikompilasi di mesin ini.
6. [x] Tulis `docs/ipc-inventory.md`.
7. [x] Tulis `docs/electron-api-usage.md`.
8. [x] Tulis `docs/torrent-audit.md`.
9. [x] Tulis `docs/account-dependent-features.md`.
10. [x] Tulis `docs/epic-audit.md`.
11. [x] Tulis `docs/cloud-save-audit.md`.
12. [x] Tulis `docs/network-calls.md`.
13. [x] Tulis `docs/baseline-behavior.md`.
14. [x] Commit dokumen Fase 0.
15. [ ] Minta repo kosong publik `Raka-Mahendra/sphinx` dan izin push.

## Baseline

| Item                                     | Nilai                                                    | Bukti                                                  |
| ---------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------ |
| Versi paket upstream                     | `4.1.6`                                                  | `package.json` di clone dan direktori kerja            |
| Clone upstream                           | `C:\Users\Raka Mahendra\Dokumen\Projects\hydra-baseline` | `git clone https://github.com/hydralauncher/hydra.git` |
| HEAD upstream saat clone                 | `a47faed2786b519d0e7579386b5f7c17f8b6a2cb` (2026-10-22)  | `git rev-parse HEAD`                                   |
| Tag upstream `v4.1.6`                    | `5e5dbcc77fe2638daa7e5365cdafdd6cda3f85fb`               | `git rev-parse v4.1.6`                                 |
| Commit yang cocok dengan direktori kerja | `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd` (2026-10-20)  | diff clone `be492f5` vs direktori kerja                |
| Tag lokal `baseline-hydra`               | `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd`               | `git rev-parse baseline-hydra`                         |
| Branch kerja                             | `sphinx/tauri-migration`                                 | `git branch --show-current`                            |
| Remote upstream                          | `https://github.com/hydralauncher/hydra.git`             | `git remote -v`                                        |

### Catatan pemilihan baseline

- `package.json` di clone HEAD dan di direktori kerja sama-sama `4.1.6`.
- Direktori kerja identik dengan commit upstream `be492f5` (2026-10-20), bukan
  clone HEAD `a47faed` (2026-10-22). Clone HEAD sudah bergerak 2 hari setelah
  snapshot lokal.
- Tag `baseline-hydra` dipasang di `be492f5` karena itulah commit yang secara
  faktual menjadi isi direktori kerja. Clone HEAD dan tag `v4.1.6` dicatat
  terpisah agar tidak ada klaim baseline yang keliru.
- Tag `v4.1.6` bukan `be492f5` dan bukan `a47faed`. Jarak tag `v4.1.6` ke clone
  HEAD adalah 352 commit (`git describe` = `v4.1.4-352-ga47faed27`).

## Selisih direktori kerja vs upstream

Perintah:

```powershell
git diff --no-index --stat -- "C:\Users\Raka Mahendra\Dokumen\Projects\hydra-be492f5" "C:\Users\Raka Mahendra\Dokumen\Projects\sphinx"
```

Hasil:

- `PRD.md` — file baru, 412 baris.
- `.git` — hanya artefak worktree clone, bukan isi aplikasi.

Tidak ada perbedaan kode aplikasi, konfigurasi, aset, atau native module terhadap
`be492f5`.

## Toolchain lokal

| Tool                             | Versi / status                                     | Bukti                                               |
| -------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| OS                               | Windows 10 Pro 19045, 64-bit                       | `Get-CimInstance Win32_OperatingSystem`             |
| Node.js                          | `v24.20.0`                                         | `node --version`                                    |
| npm                              | tersedia tetapi `npm.ps1` diblokir ExecutionPolicy | `npm --version` gagal; gunakan `npm.cmd`/`corepack` |
| Corepack                         | `0.35.0`                                           | `corepack --version`                                |
| Yarn                             | `1.22.22`                                          | `corepack yarn --version`                           |
| Git                              | `2.55.0.windows.5`                                 | `git --version`                                     |
| Visual Studio 2022 / Build Tools | tidak ada                                          | `Test-Path` untuk kedua lokasi = `False`            |
| Rust / Cargo                     | tidak ada                                          | `C:\Users\Raka Mahendra\.cargo\bin` = `False`       |
| Python                           | `3.14` (user install)                              | `where.exe python`                                  |

Implikasi: `hydra-native.node` tidak dapat dikompilasi dari sumber di mesin ini
tanpa memasang Rust MSVC dan Visual Studio C++ Build Tools. Fase 0 perlu
memakai addon prebuilt resmi atau meminta pengguna memasang toolchain.

## Verifikasi dependensi dan build

### Instalasi

- Perintah: `corepack yarn install --ignore-scripts --frozen-lockfile`.
- `postinstall` tidak dijalankan karena `--ignore-scripts`; ini juga mencegah
  unduhan runtime Epic saat instalasi.
- `yarn.lock` asli dipulihkan setelah instalasi; tidak ada perubahan lockfile
  yang dikomit.
- Electron 41.10.3 dipasang manual karena `install.js` gagal. File yang ada:
  - `node_modules/electron/dist/electron.exe`
  - `node_modules/electron/dist/version` = `41.10.3`
  - `node_modules/electron/path.txt` = `electron.exe`
- `electron.exe --version` menghasilkan `v41.10.3`.
- SHA-256 `electron.exe` saat audit: `9526bbd54fa5489afdf8c756ba5e380c4ddc3356673cab73b007430814078ee0`.

Catatan instalasi bersih: cache Yarn perlu dibersihkan dari
`%LOCALAPPDATA%\Yarn\Cache\v6\.tmp\2bf45681d877413ac7753b3589298d98` karena
commit `@electron/node-gyp` `06b29aafb7708acef8b3669835c8a7857ebc92d2` tidak
dapat dijangkau.

### Typecheck

Heap default Node gagal dengan
`FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
dan exit code 134 pada percobaan sebelumnya (log:
`C:\Users\Raka Mahendra\AppData\Local\Temp\opencode\electron-typecheck-build.log`).

Dengan `NODE_OPTIONS=--max-old-space-size=4096`:

| Perintah                       | Hasil             | Log                                  |
| ------------------------------ | ----------------- | ------------------------------------ |
| `corepack yarn typecheck:node` | exit 0, 12.03 dtk | `%TEMP%\opencode\typecheck-node.log` |
| `corepack yarn typecheck:web`  | exit 0, 35.61 dtk | `%TEMP%\opencode\typecheck-web.log`  |
| `corepack yarn typecheck`      | exit 0, 48.01 dtk | `%TEMP%\opencode\typecheck-full.log` |

Mesin ini hanya memiliki RAM fisik sekitar 7.8 GiB; nilai heap 4096 MB cukup
untuk seluruh typecheck.

### Build Electron

- Perintah: `corepack yarn electron-vite build` dengan
  `NODE_OPTIONS=--max-old-space-size=4096`.
- Hasil: exit 0, selesai dalam 60.30 dtk (log:
  `%TEMP%\opencode\electron-vite-build.log`).
- Output yang diperiksa:
  - `out/main/index.js`
  - `out/preload/index.mjs`
  - `out/renderer/index.html`
  - `out/renderer/assets/*`
- Perintah ini **tidak** menjalankan `typecheck` karena memanggil
  `electron-vite` langsung; typecheck dijalankan terpisah di atas.
- Build paket penuh (`electron-builder`) belum dijalankan karena akan memicu
  `beforePack` Epic dan membutuhkan `hydra-native.node`, `ludusavi`, serta
  runtime Epic. Fase 0 belum boleh mengklaim installer berhasil.

### Native module

| Modul                   | Status        | Bukti                                                                                               |
| ----------------------- | ------------- | --------------------------------------------------------------------------------------------------- |
| `sharp`                 | lulus         | `sharp=0.35.0 libvips=8.18.3` di Node v24.20.0                                                      |
| `classic-level`         | lulus         | smoke test buka/put/get/tutup database sementara = `classic-level=ok`                               |
| `hydra-native.node`     | **tidak ada** | `Test-Path native/hydra-native/hydra-native.node` = `False`; tidak ada folder `target`              |
| Torrent bridge prebuilt | ada           | `libhydra_torrent_bridge.so` (x64 Linux) dan `hydra_torrent_bridge.dll`/`.lib` (x64 Windows static) |

`hydra-native` adalah addon Rust N-API untuk torrent, process listing, image
processing, screenshot, dan hashing/restore cloud save. Tanpa file ini, build
Electron tetap selesai, tetapi fitur yang memanggil addon tidak dapat
diverifikasi atau dijalankan.

## Status dokumen audit

| Dokumen                              | Status  | Temuan utama                                                                                                                   |
| ------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `docs/ipc-inventory.md`              | selesai | 311 `registerEvent`, 40 direct `ipcMain.handle`, 351 main receiver unik, 431 nama preload, 3 API preload stale                 |
| `docs/electron-api-usage.md`         | selesai | 9 kelas window, `sandbox:false`, remote renderer, protocol `local:`/`gradient:`, pemetaan Tauri                                |
| `docs/torrent-audit.md`              | selesai | batas torrent, 4 RPC, port `5881`, seeding/state, guardrail migrasi                                                            |
| `docs/account-dependent-features.md` | selesai | 109 panggilan `HydraApi.*`, 15 publik eksplisit, 19 subscription-gated, 97 panggilan renderer, peta lima flag                  |
| `docs/epic-audit.md`                 | selesai | aset Epic-only, 16 kanal IPC, 88 file/38 test, Python bundled hanya Legendary, unduhan build-time                              |
| `docs/cloud-save-audit.md`           | selesai | dua pipeline Hydra (legacy tar + v2 snapshot), 30 kanal, tidak ada Google Drive, batas 500 file/2 GiB, concurrency 8           |
| `docs/network-calls.md`              | selesai | env endpoint, remote `bundle.js`, remote renderer, katalog/Steam, hoster/debrid, emulasi, Epic, telemetri, P2P, listener lokal |
| `docs/baseline-behavior.md`          | selesai | startup/quit, close-to-tray, game saat quit/crash, deep link, updater, log, NSIS/portable                                      |

## Temuan yang mengubah asumsi PRD

1. **Baseline bukan tag `v4.1.6`.** Isi direktori kerja adalah `be492f5`
   (2026-10-20); tag `v4.1.6` adalah `5e5dbcc` dan clone HEAD `a47faed`.
   Baseline yang dipakai tetap `be492f5` sampai pengguna memutuskan lain.
2. **Jumlah panggilan akun berbeda dari PRD.** Sumber menunjukkan 15 panggilan
   publik eksplisit dan 19 panggilan subscription-gated, bukan 16/17. Angka
   aktual harus dipakai saat verifikasi Fase 1.
3. **Cloud save baseline bukan Google Drive.** Baseline memakai Hydra
   API + S3, subscription, dan dua pipeline (legacy tar dan v2 snapshot).
   `drive.appdata` membutuhkan provider, OAuth, penyimpanan token, model
   konflik, dan GC baru. `HYDRA_CLOUD_LEGACY` harus mematikan backend Hydra,
   bukan menyembunyikan seluruh UI cloud save.
4. **Torrent bridge membuka `0.0.0.0:5881`.** Ini port listen BitTorrent, bukan
   API HTTP, tetapi tetap harus didokumentasikan sebagai permukaan jaringan.
5. **Renderer produksi dapat dimuat dari host remote.**
   `window-manager.ts:149-162` memuat
   `https://release-v<versi>.<MAIN_VITE_LAUNCHER_SUBDOMAIN>` sebelum fallback
   lokal; origin itu juga dipercaya oleh pengecekan IPC. Ini temuan
   supply-chain yang harus dihapus, bukan sekadar di-flag.
6. **Instalasi/build dapat mengunduh runtime Epic.** `postinstall` menjalankan
   `prepare:legendary`, dan `beforePack` juga memanggilnya. Build Sphinx harus
   memisahkan varian Epic atau menghapus unduhan ini.
7. **Python bukan dependensi global.** Python bundled hanya untuk Legendary;
   pengecualiannya adalah UMU di Linux yang memakai `/usr/bin/python3` sistem.
8. **Tidak ada Google Drive di baseline.** Nol referensi ke
   `GoogleDriveProvider`, `drive.appdata`, OAuth Google, PKCE, atau `googleapis`.

## Blocker dan keputusan terbuka

- **Blocker:** `hydra-native.node` tidak ada dan tidak dapat dikompilasi tanpa
  Rust + MSVC + Windows SDK. Perlu addon prebuilt resmi atau instalasi
  toolchain. Tanpa ini Fase 0 belum memenuhi verifikasi native secara penuh.
- **Blocker:** repo `Raka-Mahendra/sphinx` yang ada adalah fork publik berisi
  materi. PRD meminta repo publik non-fork yang kosong. Pengguna akan
  membuat/mengonfirmasi repo tersebut; `origin` ditambahkan setelah itu.
- **Izin:** `git push` ditahan atas permintaan pengguna dan memerlukan izin
  eksplisit sebelum dijalankan.
- **Diputuskan (2026-10-23):** baseline final adalah `be492f5` (tag dan branch
  `baseline-hydra`). Opsi `a47faed` dan `v4.1.6` tidak dipakai.
- **Keputusan:** arsitektur cloud save Google Drive vs kelanjutan Hydra API;
  lihat `docs/cloud-save-audit.md`.
- **Keputusan:** apakah Sphinx mempertahankan pipeline native v2 dan hanya
  mengganti provider remote, atau membangun ulang cloud save.
- **Keputusan:** apakah installer Sphinx tetap menyimpan userData saat
  uninstall seperti baseline.
- **Catatan:** auto-update masih menunjuk `hydralauncher/hydra`; harus diganti
  sebelum build rilis.

## Fase 1 — Eksekusi (fitur akun dinonaktifkan)

Fase 1 mengubah kode aplikasi sesuai `PRD.md` v2.2 §4.B, §4.E (updater), dan
§4.G. Fitur akun/cloud/achievement/Steam/Epic dipertahankan di kode tetapi
dimatikan di balik feature flag; login, token akun, Sentry, dan WorkWonders
dihapus.

### Slice terkomit

| Slice                                       | Commit      | Isi                                                                                                                                                                                             |
| ------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lisensi Apache-2.0                          | `37848df03` | `LICENSES/MIT-hydra.txt`, `LICENSE`, `NOTICE`, README, `package.json`                                                                                                                           |
| Updater Electron dinonaktifkan              | `20d58f0a1` | Feed Hydra dihapus, dependensi `electron-updater` dihapus, nama IPC tetap sebagai no-op                                                                                                         |
| Feature flag dan penghapusan akun/telemetri | `81d75b7b1` | `feature-flags.json` + pembaca per-surface, peta kanal IPC, stub akun fail-closed, `HydraApi` publik saja, deep link hanya `run`, Sentry/WorkWonders/UI login dihapus, layanan/UI/route di-gate |
| Aset runtime Epic/Legendary tidak dibundel  | `0581f27e1` | `electron-builder.yml` berhenti membundel runtime Epic/Legendary                                                                                                                                |
| Sembunyikan pengaturan akun/achievement     | `19d01a46b` | Renderer dan Big Picture menyembunyikan bagian akun/achievement                                                                                                                                 |

### Verifikasi Fase 1

| Perintah                                                       | Hasil                                    |
| -------------------------------------------------------------- | ---------------------------------------- |
| `corepack yarn typecheck`                                      | lulus (exit 0)                           |
| `corepack yarn lint`                                           | lulus (0 error, 78 warning pre-existing) |
| `corepack yarn format-check`                                   | lulus                                    |
| Test flag (`feature-flags`, `feature-flags-core`, `hydra-api`) | 13 lulus                                 |
| `yarn test` seluruh `src` kecuali `services/epic`              | 1753 test: 1710 lulus, 22 gagal, 21 skip |
| Typecheck/lint dengan semua flag `true`                        | lulus; JSON dikembalikan ke `false`      |

Sisa 22 kegagalan `yarn test` bersifat lingkungan Windows dan sudah ada sebelum
Fase 1: symlink `EPERM` dan pemisah/casing path di `cloud-save/*`, `retroarch/*`,
`steam-installation`, `umu-launch-monitor`, `wine`, dan `notification-icon`.
Tidak ada kegagalan yang terkait feature flag. Suite Epic (`services/epic`)
dikecualikan karena Linux-only.

### Jalankan aplikasi secara anonim

- Build dev (`yarn dev`) berhasil membangun main, preload, dan renderer.
- Aplikasi berjalan tanpa layar login dan memuat katalog anonim dari
  `MAIN_VITE_API_URL`.
- Log tidak memuat panggilan `/auth/*`, `/profile/*`, Sentry, WorkWonders, SSE,
  atau Epic.
- Panggilan kanal yang di-gate (`getRemoteLibrarySyncState`) ditolak dengan
  `feature_unavailable` dan ditangani tanpa unhandled rejection.
- `hydra-native.node` dan `ludusavi.exe` tidak ada; keduanya dicatat dan tidak
  menghentikan startup.

### Catatan Fase 1

- `src/main/constants.ts` masih gagal dengan `TypeError` jika
  `MAIN_VITE_API_URL` tidak diisi; `.env` lokal (git-ignored) diperlukan untuk
  menjalankan `yarn dev`.
- Temuan supply-chain renderer remote (`window-manager.ts`) masih terbuka.
- Keputusan arsitektur cloud save Google Drive masih terbuka.

## Fase 2 — Branding, identitas, dan generator allowlist (PRD §4.D, §4.A.2)

### Yang sudah ada di kode

- `branding/` — kit produksi hasil skill `logo-design`: mark (disediakan pemilik
  proyek, tidak digambar ulang), varian SVG/PNG, ikon tray (16/32/64), ikon web,
  `brand-sheet.png`, dan `branding/process/` (brief, longlist, concepts, renders,
  `preview.html`). Dokumentasi di `branding/README.md`.
- `README.md` diubah: nama "Sphinx Launcher" dan deskripsi "written in Rust
  (Tauri) and Node.js (a React/TypeScript sidecar)".
- `docs/branding-allowlist.md` — mencatat ±596 `grep -ri hydra` yang sah (crate
  `hydra-native`, `HYDRA_*` ledger, key i18n `hydra_cloud.*`, plugin Decky, dll.)
  supaya sisa referensi dapat dibaca tanpa curiga.
- `scripts/generate-ipc-allowlist.mjs` — memindai `src/main`, menulis
  `src/sidecar/allowlist.generated.ts`, `src-tauri/src/ipc/allowlist.rs`, dan
  `docs/ipc-inventory.md`. `src/sidecar/allowlist.test.ts` (9/9) gagal bila ada
  kanal baru/stale.

### Yang terverifikasi

- Generator menghasilkan daftar dan tes paritas lulus (Fase 4, 9/9):
  `yarn test` pada `allowlist.test.ts` (`--check` gagal bila output stale).
- README berubah nama/deskripsi (terlihat di diff WIP `f99322bb0`).
- `docs/branding-allowlist.md` ada dan memetakan sisa `hydra` (±596 file).

### Yang belum / tidak memenuhi acceptance Fase 2

- **Logo BELUM disetujui manusia.** `branding/README.md` eksplisit: "seluruh
  file produksi … dihasilkan oleh agen AI dan **belum melalui pemeriksaan mata
  desainer manusia**. Jalankan checklist di bagian 8 sebelum rilis publik."
  Acceptance "Logo disetujui" **belum terpenuhi** — masih checkpoint tertunda
  (R14).
- **Generator allowlist BUKAN sadar-flag.** `scripts/generate-ipc-allowlist.mjs`
  memindai `src/main` tanpa membaca `feature-flags.json`; hasilnya masih berisi
  kanal yang seharusnya digate oleh flag mati: `hydraApiCall` (305 hit),
  `getHydraDeckyPluginInfo`, `installHydraDeckyPlugin`, `setGameHydraPlaytimeEnabled`.
  Acceptance "generator … (sadar flag)" **belum terpenuhi** (R9: kebocoran flag).
  Catatan: webview tetap dibatasi allowlist Rust + handler fail-closed, tetapi
  allowlist yang di-generate sendiri tidak menyempit saat flag mati.
- **i18n khusus branding belum dikerjakan.** Fase 2 menyebut "i18n"; yang ada
  baru i18n baseline Hydra. String produk "Hydra" yang tersisa di key i18n
  tercakup oleh `docs/branding-allowlist.md` tetapi belum diganti namanya di
  tingkat terjemahan.

## Fase 3 — Kerangka Tauri (PRD §4.A.1, §4.A.3)

### Yang sudah ada di kode

- `src-tauri/` — proyek Cargo: `lib.rs` (builder + plugin + setup),
  `tauri.conf.json`, `capabilities/default.json`, plugin `deep-link`, `updater`,
  `notification`, `autostart`, `shell`, `dialog`, `fs`, `process`,
  `window-state`, dll.
- Vite renderer (`vite.config.ts`) + `vite.config.big-picture.ts`; jendela utama
  `main` dan `big-picture` dibedakan lewat label (lihat Fase 4, bug #1).
- `src/tauri-bridge/` — shim `electron`/`node:crypto`/`process` untuk webview;
  preload baseline dipakai apa adanya.

### Yang terverifikasi

- **`yarn tauri dev` menampilkan UI** — acceptance Fase 3 terpenuhi dan terbukti
  oleh boot dev (lihat bukti Fase 4): Home, Catalogue (≈211k hasil), Library,
  Downloads, Settings, halaman detail game, dan Big Picture semuanya render;
  sidecar mencapai `ready`; katalog mengembalikan HTTP 200.

### Yang belum

- Belum ada `yarn tauri build` instal NSIS yang dijalankan (milik Fase 8);
  Fase 3 cukup sampai dev menampilkan UI.
- Pengujian di mesin Linux belum dilakukan (Fase 9); kerangka ini berjalan di
  Windows (PRD: Windows prioritas).

## Fase 4 — sidecar, bridge, supervisor, recovery (PRD §4.A.2 – §4.A.5)

### Yang ditambahkan

- `src/sidecar/` — `protocol.ts`, `rpc.ts` (JSON Lines dua arah di stdio), `allowlist.ts` +
  `allowlist.generated.ts` (dari generator), `recovery.ts`, `entry.ts`, dan `electron-shim/`
  (`app`, `ipcMain`, proxy `BrowserWindow`, `dialog`, `shell`, `net`, `clipboard`, `session`, `screen`,
  `nativeImage`, `Notification`, `powerSaveBlocker`, `safeStorage`, `nativeTheme`, `Tray`, `Menu`,
  pengganti `electron-log`). API yang tidak dipakai melempar `NotImplementedInShim: <nama>`.
- `scripts/build-sidecar.mjs` — esbuild, alias `electron` → shim, `@electron-toolkit/*` → pengganti,
  ESM, `hydra-native`/`sharp`/`classic-level` sebagai external. 963 modul, 7,6 MB, 74 external.
- `src/tauri-bridge/` — shim `electron` untuk webview (`contextBridge.exposeInMainWorld`,
  `ipcRenderer.invoke/send/on/once/off/removeListener`), shim `node:crypto` dan `process`, pengganti
  `electron-log/renderer`, indikator menyambung ulang. `src/preload/index.ts` dipakai apa adanya.
- `src-tauri/src/` — `sidecar/` (supervisor, protokol, konfigurasi, RPC host), `ipc/` (command +
  allowlist), `dialogs.rs`, `shell.rs`, `keychain.rs`, `power.rs`, `clipboard.rs`.
- `scripts/generate-ipc-allowlist.mjs` — 346 kanal invoke, 71 kanal event, 6 prefiks dinamis, 9 situs
  forwarder; menulis `src/sidecar/allowlist.generated.ts` + `docs/ipc-inventory.md`.
- `scripts/stage-node-binary.mjs` + `bundle.externalBin: ["binaries/node"]` — installer membawa
  Node yang menjalankan sidecar. Berkasnya ~80 MB jadi tidak di-commit (`yarn stage:node`,
  dipanggil otomatis oleh `yarn build`); `sidecar/config.rs` mencarinya di sebelah executable.
- `docs/sidecar.md`, `docs/tauri-security.md`, `docs/evidence/fase4-*.png`, `fase4-ipc-traffic.json`.

### Perubahan pada kode baseline

`src/main` tetap dipakai; yang berubah hanya yang tidak bisa tidak:

- `game-running-state.ts` — sesi playtime dapat `sessionId` (UUID) dan tanda `resumed`, keduanya
  in-memory (PRD: tanpa persistensi baru).
- `process-watcher.ts` — `watchProcesses({ resumed })`; pemindaian saat start menandai sesi.
- `emulator-session-tracker.ts` — `sessionId` per sesi emulator.
- `window-manager.ts` — `attachExternalWindow()` supaya jendela milik Rust bisa diadopsi;
  `loadWindowURL()` tidak lagi memuat renderer dari `MAIN_VITE_LAUNCHER_SUBDOMAIN` (kode remote yang
  dieksekusi dari konfigurasi) dan memakai `SPHINX_RENDERER_URL` di dev; `openBigPictureWindow()`
  meneruskan `label: "big-picture"` (batas capability Tauri).
- `find-achievement-files.ts` — dua `await` tingkat atas diganti `initializeSteamAchievementLocations()`
  yang dipanggil `loadState()`, karena esbuild tidak bisa membundel TLA di dalam siklus impor.

### Bug yang ditemukan saat verifikasi

1. **Label jendela = batas capability.** Jendela Big Picture dibuat tanpa label → label sintetis
   `sphinx-window-1` → semua `ipc_invoke` ditolak → halaman kosong. Diperbaiki dengan `label`.
2. **`ready-to-show` tidak pernah datang.** Semua jendela tambahan dibuat `show: false` dan
   ditampilkan dari `ready-to-show`, yang di Electron datang dari renderer. Sidecar tidak bisa
   mengetahuinya, jadi Rust mengirim `control window-ready` saat `PageLoadEvent::Finished`.
3. **`ipcRenderer.off` tidak ada.** Preload memakai `ipcRenderer.off` (`src/preload/index.ts:2310`);
   bridge hanya punya `removeListener`. Akibatnya halaman detail game melempar
   `ipcRenderer.off is not a function` dan jatuh ke error boundary. Ditambahkan sebagai alias.
4. **Impor melingkar `@renderer/context`.** Barrel itu mengekspor ulang `@renderer/components` yang
   mengimpor balik barrel-nya, sehingga ada dua instance objek context dan
   `useCollectionContextMenu` melempar "must be used within CollectionContextMenuProvider" di
   Library/Downloads/Settings. `main.tsx` kini mengimpor berkas modulnya langsung.
5. **Kegagalan saat boot mematikan sidecar.** `Ludusavi.copyBinaryToUserData()` menolak tanpa
   penanganan (perilaku baseline). Shim semula mematikan proses pada unhandled rejection → restart
   berulang. Sekarang unhandled rejection dicatat dan proses tetap hidup; yang diawasi supervisor
   adalah _hang_, bukan error.

### Verifikasi (24 Oktober 2026)

| Klaim                  | Perintah                          | Hasil                                                                                                   |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Sidecar bundel         | `yarn build:sidecar`              | 7,6 MB, 963 modul, 74 external                                                                          |
| RPC + protokol         | `src/sidecar/rpc.test.ts`         | 12/12                                                                                                   |
| Allowlist = sumber     | `src/sidecar/allowlist.test.ts`   | 9/9                                                                                                     |
| 4 tes crash            | `yarn test:crash`                 | 4/4                                                                                                     |
| Typecheck              | `tsc -p tsconfig.{node,web}.json` | bersih                                                                                                  |
| Rust                   | `cargo check`                     | bersih                                                                                                  |
| UI di `yarn tauri dev` | —                                 | Home, Catalogue (211.445 hasil), Library, Downloads, Settings, detail game, Big Picture semuanya render |

Bukti render: `docs/evidence/fase4-home.png`…`fase4-big-picture.png`. Bukti lalu lintas IPC:
`docs/evidence/fase4-ipc-traffic.json` — 423 panggilan invoke lewat 25 kanal berbeda pada satu sesi.

Supervisor diuji langsung: sidecar dibunuh tiga kali (`taskkill /F`), setiap kali hidup lagi
(pid 6776 → 3680 → 11432 → 8872, boot 0,5–1,0 dtk), dan banner "Menyambung ulang ke layanan latar…"
muncul lalu hilang setelah panggilan berikutnya berhasil.

### Belum / tidak bisa di mesin ini

- `hydra-native.node` tidak terbangun: `napi-build` menuntut `libnode.dll`, yang tidak ada di kedua
  distribusi Node di mesin ini, dan MSVC tidak tersedia. Efek: torrent dan eksekusi unduhan mati,
  pemindaian proses di recovery scan gagal (dicatat, boot lanjut).
- Karena itu tes crash (i) memverifikasi bagian "game hidup" dan keberadaan laporan recovery, bukan
  bagian "playtime lanjut"; bagian itu ditutup oleh tes unit `game-running-state.test.ts`.
- `ludusavi.exe` tidak ada di repo (sama seperti baseline).

## Fase 5 — Fitur platform, updater Tauri, workflow rilis (PRD §4.E, §6.1)

Fase 5 **sebagian**: kode untuk updater, `tauri-release.yml`, tray, dan deep link
**sudah ada dan menyusun**, tetapi belum diverifikasi ujung-ke-ujung. Berkas yang
tergolong Fase 5 sebagian:

| Berkas                                                                                                                                                  | Status kode                                                                                                                                                                                                            | Verifikasi                                                                                  | Kesenjangan                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/updater.rs` (+ `src-tauri/src/sidecar/rpc.rs`, `src/main/services/update-manager.ts`, `tauri.conf.json › plugins.updater`)                 | Lengkap: `check`/`download`/`install`/`shutdown_before_install`/`state_snapshot`; endpoint menunjuk `Raka-Mahendra/sphinx` (bukan Hydra) + `pubkey` minisign + `installMode: passive`                                    | `cargo check` bersih; `tauri dev` boot tanpa error plugin updater                           | E2E update **belum dijalankan**: belum ada tag rilis dibangun/dipublikasikan; jalur `v0.0.1→v0.0.2` (unduh+pasang tanpa file terkunci, tanpa proses tersisa) **belum terbukti**. Kecocokan `pubkey` di `tauri.conf.json` dengan `TAURI_SIGNING_PRIVATE_KEY` riil **belum divalidasi**. |
| `.github/workflows/tauri-release.yml`                                                                                                                  | Lengkap: build → draft → publish; gerbang versi (`bump-version.mjs --check`); `signCommand` Authenticode (no-op tanpa secret); signing minisign via secret; generate `latest.json`+`SHA256SUMS`                          | YAML valid (js-yaml); struktur job benar; `bump-version.mjs --check v0.1.0` lulus          | Workflow **belum pernah dijalankan** (tidak ada tag push; push ditahan). Interaksi minisign+Authenticode, penamaan artefak, draft→publish di runner nyata **belum terbukti**.                                                                                                              |
| `src-tauri/src/tray.rs` (+ `src/sidecar/entry.ts` handler `tray-click`/`tray-event`)                                                                  | Lengkap: menu dibangun dari model sidecar, `tray::register_menu_handler` di `setup`                                                                                                    | `cargo check` bersih; `tauri dev` boot (tray dibuat di setup tanpa crash)                    | Kehadiran/visual tray dan klik menu **belum diverifikasi** di sesi dev (tidak di-screenshot); checklist §6.1 (taskbar/Start Menu/ARP) belum di mesin bersih.                                                                                                                              |
| `src/main/deep-link.ts` + `src-tauri/src/platform.rs` (`register_deep_links`) + `tauri.conf.json › plugins.deep-link`                                   | Lengkap: skema `sphinx` terdaftar; Rust meneruskan `control deep-link`/`second-instance` ke sidecar; `handleDeepLinkPath`/`handleSecondInstance` menangani                                                  | `cargo check` bersih; `tauri dev` boot (skema terdaftar, setup tanpa crash)                  | Klik tautan `sphinx://run` nyata **belum diuji**; single-instance + replay URL belum dieksekusi. Capability `deep-link:allow-*` tidak eksplisit di `capabilities/default.json` (penanganan skema di Rust, bukan webview) — perlu konfirmasi.                                              |
| `scripts/bump-version.mjs`, `scripts/make-update-manifest.mjs`                                                                                         | Lengkap                                                                                                                                                                                                                | `bump-version.mjs --check` lulus; `make-update-manifest.mjs` 6/6 tes (SHA256 benar pada fixture) | `SHA256SUMS` **belum divalidasi terhadap artefak build riil** (hanya fixture).                                                                                                                                                                                                              |

### Yang terverifikasi (Fase 5, lingkup terbatas)

- `cargo check` bersih untuk seluruh `src-tauri/src` (termasuk `updater`, `tray`,
  `platform`).
- `tauri dev` boot tanpa error konfigurasi/plugin; tray, deep-link, updater
  terdaftar di `setup` (bukti: log dev Fase 4 — sidecar `ready`, katalog 200,
  tidak ada panic plugin).
- `bump-version.mjs` dan `make-update-manifest.mjs` lulus tes unit masing-masing.
- `tauri-release.yml` lolos validasi YAML dan gate versi.

### Yang belum (acceptance Fase 5 belum terpenuhi)

- **Update E2E** `v0.0.1→v0.0.2` (repo uji) sukses tanpa file terkunci dan tanpa
  proses tersisa — **belum dijalankan** (butuh rilis nyata).
- **Checklist platform §6.1 di Windows 10 & 11 bersih**: start, kontrol jendela,
  tray, single instance, deep link, autostart, notifikasi, identitas
  taskbar/Start/ARP — **belum dijalankan** di mesin bersih.
- **SmartScreen** (unduhan browser vs update mandiri), **Smart App Control**
  (Win 11), **Defender** false-positive untuk paket berisi `node.exe`/addon
  native/engine torrent (R7, R9) — **belum diuji**.
- **`SHA256SUMS` benar** untuk artefak riil — **belum divalidasi** (hanya
  fixture).
- **Autostart** perilaku "jalankan saat login" di Windows bersih — belum
  diverifikasi (blok config dihapus dari `tauri.conf.json`; kini via `init()` di
  `lib.rs`).
- **Kunci minisign** (cadangan offline, pemisahan dari Authenticode, pemegang =
  pemilik repo) — belum dibuat/didokumentasikan (PRD §10 butir 20).

### Catatan khusus autostart

Blok `plugins.autostart` dihapus dari `tauri.conf.json` karena plugin v2 tidak
lagi membacanya dari config (membuat dev boot panic). Argumen `--hidden` kini
diberikan via `tauri_plugin_autostart::init([...])` di `lib.rs`, dan preferensi
"start minimised" dibaca dari `compute_startup` (`platform.rs`). Perilaku aktual
di mesin bersih belum diuji.

## Ringkasan status fase & langkah berikutnya

| Fase | Status                  | Catatan kunci                                                                              |
| ---- | ----------------------- | ------------------------------------------------------------------------------------------ |
| 0    | selesai                 | audit + baseline `be492f5`                                                                  |
| 1    | selesai                 | anonim, feature flag, lisensi Apache-2.0                                                    |
| 2    | **sebagian**            | branding ada; logo belum disetujui; generator allowlist bukan sadar-flag                    |
| 3    | selesai & terverifikasi | `yarn tauri dev` render UI                                                                  |
| 4    | selesai & terverifikasi | sidecar/bridge/crash-tests; `hydra-native`/`ludusavi` belum ada di mesin ini                |
| 5    | **sebagian**            | updater/tray/deep-link/release-yml ada di kode; E2E update & Windows bersih belum diverifikasi |

Langkah berikutnya (sebelum/sesudah pindah ke Linux):

1. **Tutup celah Fase 2:** dapatkan persetujuan logo manusia (checklist
   `branding/README.md` §8); jadikan generator allowlist sadar-flag (filter
   `src/main` dengan `feature-flags.json`) agar kanal mati tidak muncul di
   allowlist.
2. **Verifikasi Fase 5 di Windows bersih:** tag `v0.1.0`, jalankan
   `tauri-release.yml` (perlu `TAURI_SIGNING_PRIVATE_KEY` + opsi Authenticode),
   pasang di VM Windows 10 & 11, jalankan checklist §6.1, catat
   SmartScreen/Smart App Control/Defender.
3. **Validasi E2E update:** rilis `v0.0.1` lalu `v0.0.2` di repo uji; pastikan
   tidak ada file terkunci/proses tersisa; cek `SHA256SUMS` vs artefak riil.
4. **Kunci minisign:** buat, cadangkan offline, pisahkan dari Authenticode
   (§10.20).
5. **Tahan `git push`** atas izin pengguna (lihat pesan commit).
