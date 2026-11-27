# Sphinx Launcher — Migration Log

Dokumen ini mencatat eksekusi migrasi Hydra Launcher 4.1.6 ke Sphinx Launcher
sesuai `PRD.md` v2.2. Fase 0 bersifat audit dan dokumentasi; kode aplikasi tidak
diubah.

## Fase 0 — Todo

1. [x] Clone penuh `hydralauncher/hydra` ke folder terpisah dan catat versi + SHA.
2. [x] Bandingkan direktori kerja dengan clone upstream.
3. [x] Siapkan riwayat upstream, remote `upstream`, tag `baseline-hydra`, dan
       branch `sphinx/main` di repo lokal.
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
| Branch kerja                             | `sphinx/main`                                            | `git branch --show-current`                            |
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

> **Historis Fase 0.** Bagian ini mencatat baseline saat aplikasi masih Electron.
> Setelah Fase 8, `electron-vite`, `electron-builder`, dan dependensi Electron
> dihapus; perintah `yarn electron-vite build` tidak ada lagi. Build sekarang:
> `yarn build:renderer` (Vite → `out/renderer`) + `yarn build:sidecar` (esbuild →
> `out/sidecar`) + `cargo` untuk shell Tauri. Angka di bawah bukan hasil build
> Sphinx.

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
- **Generator allowlist sadar-flag (diperbaiki di remediasi P2).**
  `scripts/generate-ipc-allowlist.mjs` kini membaca `feature-flags.json` dan peta
  `channelFlags`, sehingga 83 kanal milik flag mati tidak masuk tabel Rust/sidecar.
  Kanal yang disebut catatan lama — `hydraApiCall`,
  `getHydraDeckyPluginInfo`, `installHydraDeckyPlugin`,
  `setGameHydraPlaytimeEnabled` — **bukan** milik flag mana pun (proxy katalog
  publik, plugin Decky Linux, dan playtime), jadi tetap ada; klaim lama yang
  menyebutnya bocor sudah dikoreksi di sini. Lihat `docs/feature-flags.md` §4.2a.
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

| Berkas                                                                                                                                    | Status kode                                                                                                                                                                                     | Verifikasi                                                                                       | Kesenjangan                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/updater.rs` (+ `src-tauri/src/sidecar/rpc.rs`, `src/main/services/update-manager.ts`, `tauri.conf.json › plugins.updater`) | Lengkap: `check`/`download`/`install`/`shutdown_before_install`/`state_snapshot`; endpoint menunjuk `Raka-Mahendra/sphinx` (bukan Hydra) + `pubkey` minisign + `installMode: passive`           | `cargo check` bersih; `tauri dev` boot tanpa error plugin updater                                | E2E update **belum dijalankan**: belum ada tag rilis dibangun/dipublikasikan; jalur `v0.0.1→v0.0.2` (unduh+pasang tanpa file terkunci, tanpa proses tersisa) **belum terbukti**. Kecocokan `pubkey` di `tauri.conf.json` dengan `TAURI_SIGNING_PRIVATE_KEY` riil **belum divalidasi**. |
| `.github/workflows/tauri-release.yml`                                                                                                     | Lengkap: build → draft → publish; gerbang versi (`bump-version.mjs --check`); `signCommand` Authenticode (no-op tanpa secret); signing minisign via secret; generate `latest.json`+`SHA256SUMS` | YAML valid (js-yaml); struktur job benar; `bump-version.mjs --check v0.1.0` lulus                | Workflow **belum pernah dijalankan** (tidak ada tag push; push ditahan). Interaksi minisign+Authenticode, penamaan artefak, draft→publish di runner nyata **belum terbukti**.                                                                                                          |
| `src-tauri/src/tray.rs` (+ `src/sidecar/entry.ts` handler `tray-click`/`tray-event`)                                                      | Lengkap: menu dibangun dari model sidecar, `tray::register_menu_handler` di `setup`                                                                                                             | `cargo check` bersih; `tauri dev` boot (tray dibuat di setup tanpa crash)                        | Kehadiran/visual tray dan klik menu **belum diverifikasi** di sesi dev (tidak di-screenshot); checklist §6.1 (taskbar/Start Menu/ARP) belum di mesin bersih.                                                                                                                           |
| `src/main/deep-link.ts` + `src-tauri/src/platform.rs` (`register_deep_links`) + `tauri.conf.json › plugins.deep-link`                     | Lengkap: skema `sphinx` terdaftar; Rust meneruskan `control deep-link`/`second-instance` ke sidecar; `handleDeepLinkPath`/`handleSecondInstance` menangani                                      | `cargo check` bersih; `tauri dev` boot (skema terdaftar, setup tanpa crash)                      | Klik tautan `sphinx://run` nyata **belum diuji**; single-instance + replay URL belum dieksekusi. Capability `deep-link:allow-*` tidak eksplisit di `capabilities/default.json` (penanganan skema di Rust, bukan webview) — perlu konfirmasi.                                           |
| `scripts/bump-version.mjs`, `scripts/make-update-manifest.mjs`                                                                            | Lengkap                                                                                                                                                                                         | `bump-version.mjs --check` lulus; `make-update-manifest.mjs` 6/6 tes (SHA256 benar pada fixture) | `SHA256SUMS` **belum divalidasi terhadap artefak build riil** (hanya fixture).                                                                                                                                                                                                         |

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

| Fase | Status                  | Catatan kunci                                                                                  |
| ---- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| 0    | selesai                 | audit + baseline `be492f5`                                                                     |
| 1    | selesai                 | anonim, feature flag, lisensi Apache-2.0                                                       |
| 2    | **sebagian**            | branding ada; logo belum disetujui; generator allowlist bukan sadar-flag                       |
| 3    | selesai & terverifikasi | `yarn tauri dev` render UI                                                                     |
| 4    | selesai & terverifikasi | sidecar/bridge/crash-tests; `hydra-native`/`ludusavi` belum ada di mesin ini                   |
| 5    | **sebagian**            | updater/tray/deep-link/release-yml ada di kode; E2E update & Windows bersih belum diverifikasi |
| 6    | **sebagian**            | resource torrent native ikut installer; uji unduhan nyata & `cargo check` belum jalan          |
| 7    | **sebagian**            | provider Google Drive lengkap + 43 tes; login/upload/restore nyata belum diuji                 |

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

## Fase 6 — torrent native di Tauri (PRD §4.C)

Mesin torrent tidak diganti: `hydra-native` + `torrent-bridge`, `DownloadManager`,
status, seeding, pilih file, dan resume tetap. Catatan lengkap, termasuk tabel
acceptance per kriteria dan rencana uji mesin bersih, ada di
[`docs/torrent-tauri.md`](./torrent-tauri.md).

### Yang dikerjakan

- **Resource (`src-tauri/src/sidecar/config.rs`, `tauri.conf.json`)** — Rust
  menyelesaikan folder `hydra-native` satu kali (paket: `<resources>/hydra-native`,
  dev: `<repo>/hydra-native`, sama seperti Hydra) dan mengirimnya sebagai
  `SPHINX_HYDRA_NATIVE_DIR`. `bundle.resources` tetap memetakan `../hydra-native`
  ke `hydra-native`, jadi addon dan bridge prebuilt ikut installer tanpa binary
  hasil build di-commit (`/hydra-native/` tetap di `.gitignore`).
- **Resolusi path (`src/main/services/native-addon-path.ts`)** — fungsi murni
  dengan urutan: modul tes → `SPHINX_HYDRA_NATIVE_DIR` → `resourcesPath` →
  `appPath`. `native-addon.ts` hanya memanggilnya; tidak ada perubahan pada
  jalur torrent. Pemanggil Electron di jalur ini tetap lewat shim (`app`,
  `process.resourcesPath`); `src/main/services/download/**` tidak mengimpor
  `electron`.
- **Verifikasi dependensi `.node` (`scripts/check-torrent-resources.mjs`)** —
  membaca tabel impor PE `hydra-native.node` dan bridge tanpa dependensi baru,
  lalu gagal bila addon/bridge/runtime VC++ tidak ikut dikemas atau mapping
  resource hilang. Diukur di sini: bridge prebuilt (`x64-windows-static`) tidak
  mengimpor DLL CRT sama sekali; addon Rust mengimpor `vcruntime140`/`msvcp140`,
  yang sudah disalin `scripts/build-native-addon.cjs` ke folder resource.
- **Gate build & rilis (`package.json`, `.github/workflows/tauri-release.yml`)** —
  `yarn build` menjalankan pemeriksaan itu; workflow rilis kini membangun addon
  (`yarn build:native`) sebelum `tauri build`: instalasi CI memakai
  `--ignore-scripts`, jadi `postinstall` dilewati dan rilis sebelumnya akan
  terbit tanpa mesin torrent. `HYDRA_NATIVE_SKIP_LOAD_TEST=1` melewati uji muat
  Electron yang tidak tersedia di runner.
- **Tes otomatis** — `torrent-client.test.ts` (init/request/shutdown kontrak),
  `native-addon-path.test.ts` (dev vs paket), dan
  `src/sidecar/torrent-engine.test.ts` (integrasi proses nyata dengan pengganti
  addon yang memegang socket eksklusif: satu engine per boot, satu
  `torrentShutdown` pada shutdown bersih, sidecar kedua bukan engine kedua,
  ambil alih setelah kill, `stdin` tertutup ⇒ keluar tanpa engine yatim).

### Verifikasi (25 November 2026)

| Klaim                          | Perintah                                                   | Hasil                                                       |
| ------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------- |
| Resolusi path dev/paket        | `native-addon-path.test.ts`                                | 5/5                                                         |
| Init/request/shutdown engine   | `torrent-client.test.ts`                                   | 6/6                                                         |
| Lifecycle engine lintas proses | `src/sidecar/torrent-engine.test.ts`                       | 4/4                                                         |
| Resource dapat dikemas         | `node scripts/check-torrent-resources.mjs --allow-missing` | lulus, dengan peringatan `hydra-native.node` belum dibangun |
| Typecheck                      | `tsc -p tsconfig.test.json` untuk berkas baru              | bersih                                                      |

### Belum bisa dijalankan di mesin ini

- Semua uji unduhan nyata (magnet/`.torrent`, jeda/lanjut/batal/hapus, pilih
  sebagian file, seeding, resume setelah restart) — `hydra-native.node` tidak
  dapat dibangun (tidak ada `libnode.dll`/MSVC, `cargo` tidak terpasang).
- `cargo check` untuk perubahan `config.rs`; perubahan hanya menambah satu env
  variable dan satu `eprintln!`, tetapi harus lolos CI.
- Uji installer di VM Windows bersih tanpa Python/VC++ redistributable.

## Fase 7 — cloud save Google Drive (PRD §4.F)

Pipeline v2 tidak diganti: hashing native, snapshot lokal, manifest immutable,
`SnapshotVariant`, dan `baseVersion` tetap sama. Yang berganti hanya tujuan
unggah/restore — Hydra `/profile/cloud-saves/*` dan presigned S3 digantikan
`GoogleDriveCloudSaveProvider` di belakang antarmuka
`src/main/services/cloud-save/cloud-save-provider.ts`. Probe host dan langkah
setup ada di [`docs/google-drive-setup.md`](./google-drive-setup.md).

### Yang dikerjakan

- **Provider (`src/main/services/google-drive/**`)** — REST v3 lewat `fetch`(tanpa`googleapis`), scope hanya `drive.appdata`. Blob
content-addressed `<gameKey>/<sha256>`, manifest
`<gameKey>/snapshots/<version>.json`di`appDataFolder`, metadata di `appProperties` (`app=sphinx`, `schema=1`,
`kind`, `gameKey`, `hash`/`version`/`parent`, `deviceId`, `createdAt`). Tidak
ada `index.json`; `gameKey` diturunkan dari shop+objectId sehingga tidak
  bergantung nilai shop.
- **Protokol commit** — daftar manifest → cek head == `baseVersion` → unggah
  blob yang belum ada (dedupe per hash, konkurensi 3) → tulis manifest
  `version+1` dengan `parent=baseVersion` → daftar ulang untuk mendeteksi
  manifest kembar (dialog cloud/lokal/keduanya, backup lokal lebih dulu). Bila
  `aggregateHash` sama dengan head, commit dilewati.
- **ETag/If-Match** — diverifikasi dari dokumentasi Google dan laporan forum:
  Drive v3 tidak menyediakan ETag yang dapat diandalkan pada `files.update`
  atau penggantian media, dan `If-Match` tampak diabaikan. Karena itu konflik
  diselesaikan lewat nomor versi + re-list setelah tulis, bukan precondition.
- **Batas `appProperties` & laju tulis** — dokumentasi Google menetapkan
  maksimum 100 properti kustom per file, 30 privat per aplikasi, dan 124 byte
  per string properti (kunci + nilai). Sphinx menulis 9 kunci dengan nilai
  terpanjang 36 byte (`deviceId`), jadi batas ini aman; rinciannya dicatat di
  `docs/google-drive-setup.md` §6. Kuota tulis `files.create`/`files.update`
  (50 unit) dan batas 325.000 unit/menit/user menjadi dasar konkurensi 3 +
  backoff, bukan angka tebakan.
- **Retensi & GC** — retensi default 3 (rentang 1–10) disimpan di
  `google-drive-settings.json` (userData). Mark-and-sweep hanya menghapus blob
  yang tidak dirujuk manifest mana pun **dan** lebih tua dari 24 jam, dan hanya
  dijalankan setelah retensi memangkas manifest.
- **Kuota** — `fields` parsial, `pageSize=1000`, filter `appProperties`, cache
  daftar ~5 menit, backoff eksponensial + jitter untuk 429/403
  `rateLimitExceeded`/5xx, pesan khusus `storageQuotaExceeded`, konfirmasi
  ukuran (default 100 MB) dari byte baru setelah dedupe. `about.get` dipakai
  untuk pemakaian/sisa kuota di Settings; tidak ada polling — sinkron hanya
  saat aksi manual, game ditutup (bila diaktifkan), atau halaman game dibuka.
- **OAuth** — Authorization Code + PKCE S256, loopback
  `http://127.0.0.1:<port acak>/callback`, `state`, `access_type=offline`,
  browser sistem, server loopback hanya selama login. Refresh token disimpan
  lewat RPC `keychain.*` ke keychain OS; bila tidak tersedia, token hanya di
  memori dan UI memberi tahu. Putuskan: revoke ke
  `oauth2.googleapis.com/revoke`, hapus keychain, tawarkan hapus data cloud.
  `invalid_grant` → terputus + ajakan hubungkan ulang.
- **Client build-time** — `src-tauri/src/sidecar/config.rs` membaca
  `option_env!("GOOGLE_CLIENT_ID"/"GOOGLE_CLIENT_SECRET")` (fallback env untuk
  `tauri dev`) dan mengirimnya sebagai `SPHINX_GOOGLE_CLIENT_ID`/`SECRET`.
  Workflow rilis meneruskan dua secret Actions. Build tanpa kredensial
  menonaktifkan tombol dengan pesan "Google Drive belum dikonfigurasi di build
  ini".
- **Legacy & UI** — jalur `SubscriptionRequiredError` dihapus:
  `assertCloudSaveAvailable()`/`isCloudSaveAvailable()` kini berbasis koneksi
  Drive, dan 17 pemanggil subscription diganti. Channel v2 tidak lagi digated
  `HYDRA_CLOUD_LEGACY`; kartu Settings baru
  (`settings-google-drive.tsx`) berisi Hubungkan/Putuskan, pemakaian kuota,
  retensi, dan ambang konfirmasi. Jalur artifact Hydra legacy tetap ada di
  balik flag seperti sebelumnya.
- **Tes otomatis** — 43 tes di `src/main/services/google-drive/`:
  PKCE (vektor RFC 7636), OAuth (URL scope, state salah, scope berlebih,
  `invalid_grant`, revoke), client REST (multipart, resumable, 401→refresh,
  429 backoff, `storageQuotaExceeded`, `about`, delete, pagination), provider
  (dedupe, skip commit, `baseVersion` bentrok, konfirmasi ukuran, manifest
  kembar untuk ketiga pilihan, pruning + GC dengan grace period, varian Steam,
  restore manifest/URL/unduh, hapus total), manifest (validasi totals/skema/
  varian/custom path), settings (clamp, fallback, tulis atomik).

### Verifikasi (25 November 2026)

| Klaim                          | Perintah                                                                                       | Hasil                                                                            |
| ------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Tes Google Drive               | `node --import ./scripts/register-ts-node.mjs --test src/main/services/google-drive/*.test.ts` | 43/43                                                                            |
| Typecheck main/sidecar         | `tsc --noEmit -p tsconfig.node.json --composite false`                                         | bersih                                                                           |
| Typecheck renderer/big-picture | `tsc --noEmit -p tsconfig.web.json --composite false`                                          | bersih                                                                           |
| Lint berkas baru & yang diubah | `eslint` pada `src/main/services/google-drive`, provider, event, Settings                      | bersih (2 warning `any` lama di `preload/index.ts`)                              |
| IPC allowlist                  | `node scripts/generate-ipc-allowlist.mjs`                                                      | 267 invoke, 0 send, 72 event, 83 excluded by feature flags                       |
| Regresi pipeline cloud save    | `--test src/main/services/cloud-save/*.test.ts`                                                | 375/401; 15 gagal karena symlink `EPERM`/semantik path Windows, bukan kode Drive |

### Belum bisa dijalankan di mesin ini

- Login Google nyata, unggah/restore ke Drive sungguhan, dan pemeriksaan
  "file tidak tampak di My Drive" — tidak ada kredensial client maupun akun
  Google. Langkah manualnya ada di `docs/google-drive-setup.md` §8.
- `cargo check` untuk `config.rs` (cargo tidak terpasang); perubahan hanya
  menambah dua env dan satu peringatan build.
- Uji restore end-to-end tetap tertahan `hydra-native.node` (lihat Fase 6).

## Fase 8 — Pembersihan dan paket (PRD fase 8, §4.A, §4.B, §4.G, §8, §10)

Tujuan fase: Electron hilang sepenuhnya, `grep` bersih, installer NSIS dibangun dan
diukur, dokumen rilis lengkap. Bagian yang bisa dijalankan di mesin ini dicatat
dengan hasil nyata; bagian yang diblokir toolchain dicatat sebagai **tidak
terbukti**, bukan lulus.

### Yang dihapus / dirapikan

| Item                                                                                                                                                                          | Bukti                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Dependensi Electron (`electron`, `electron-builder`, `electron-vite`, `electron-log`, `electron-updater`, `@electron-toolkit/*`)                                              | `package.json` tidak memuatnya; `yarn.lock` dipangkas (60 insertions, 1.715 deletions)              |
| `electron-builder.yml`, `electron.vite.config.ts`, `build/`                                                                                                                   | Dihapus                                                                                             |
| Workflow Electron (`build.yml`, `release.yml`, `build-renderer.yml`, `trigger-lp.yml`, `update-aur.yml`)                                                                      | Dihapus; hanya `tauri-release.yml`, `lint.yml`, `text-integrity.yml`, `torrent-bridge-prebuilt.yml` |
| Skrip Epic/Legendary build (`legendary-*.cjs`, `prepare-legendary.cjs`, `*-managed*.py`, `prepare-epic-process-supervisor.cjs`, `build-epic-prerequisite-runner.cjs`, tesnya) | Dihapus; tidak ada referensi tersisa di `package.json`, CI, atau `src-tauri`                        |
| `resources/legendary/` (Python, shell, `.pyz` bootstrap)                                                                                                                      | Dihapus; nol berkas `.py` di repo                                                                   |
| Masukan ignorable `legendary/`, `hydra-python-rpc/`, `.env.sentry-build-plugin`                                                                                               | Dihapus dari `.gitignore`, `.eslintignore`, `.prettierignore`                                       |

Shim yang tersisa memang disengaja: `src/sidecar/electron-shim/**`,
`src/tauri-bridge/electron.ts`, `src/types/electron-globals.d.ts`, dan alias
`electron` di `vite.config*.ts`/`tsconfig*.json`. Daftar lengkap ada di
[`docs/electron-allowlist.md`](./electron-allowlist.md).

### Perbaikan akar masalah yang ditemukan saat verifikasi

1. **Typecheck `src/main` gagal total setelah paket Electron dihapus.** Seluruh
   `src/main` diketik terhadap shim, dan shim hanya mendeklarasikan anggota yang
   dulu dipakai jalur torrent. 120+ error (`ipcMain` contravariance,
   `WebContents.mainFrame`, `BrowserWindow.setPosition/showInactive/flashFrame`,
   `session.fromPartition`, `dialog` return type, `nativeImage`, `process.defaultApp`,
   `@resources/*?asset`).
   Perbaikan: tipe shim dilengkapi (`WebFrameMain`, `IpcListener(...args: any[])`,
   `Session`, `NativeImage`, `DesktopCapturerSource`, `readShortcutLink`, opsi
   notifikasi), `src/types/asset-modules.d.ts` ditambahkan, dan
   `ipcRenderer.invoke` dikembalikan ke kontrak Electron `Promise<any>`.
   Tidak ada `@ts-ignore` atau penurunan aturan `tsconfig`.
2. **`yarn build:renderer` gagal** karena alias `@preload` hilang dari
   `vite.config.ts` (Big Picture sudah memilikinya). Ditambahkan; build renderer
   dan Big Picture lulus.
3. **`yarn format-check` gagal pada 10 berkas** (termasuk berkas yang sudah ada
   sebelum fase ini). Diperbaiki dengan `prettier --write`, bukan dengan
   mengecualikan berkas.
4. **`yarn.lock` masih memuat seluruh graf Electron.** `yarn install` (bukan edit
   tangan) memangkasnya; `electron-to-chromium` tetap ada karena itu data
   browserslist, bukan Electron.

### Hasil perintah (26 November 2026, Windows 10 Pro 19045, Node 24.22.1, Yarn 1.22.22)

| Perintah                                          | Hasil                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `yarn install --ignore-scripts`                   | lulus, `Saved lockfile`                                                                                                                                                                        |
| `yarn install --frozen-lockfile --ignore-scripts` | lulus, `Already up-to-date`                                                                                                                                                                    |
| `yarn typecheck` (flag `false`)                   | lulus (`typecheck:node` 16.8 dtk, `typecheck:web` 59.0 dtk)                                                                                                                                    |
| `yarn typecheck` (semua flag `true`)              | lulus (85.0 dtk), JSON dikembalikan ke `false`                                                                                                                                                 |
| `yarn lint` (flag `false`)                        | lulus, 0 error (78 warning pre-existing)                                                                                                                                                       |
| `yarn lint` (semua flag `true`)                   | lulus, 0 error, 78 warning                                                                                                                                                                     |
| `yarn format-check`                               | lulus (`All matched files use Prettier code style`)                                                                                                                                            |
| `yarn test` (seluruh suite)                       | **menggantung** di suite Epic Linux-only; dihentikan setelah 6 menit tanpa output                                                                                                              |
| Suite yang sama tanpa `src/main/services/epic/**` | 1.768 tes: **1.726 lulus, 24 gagal, 18 skip**; lihat kategori di bawah                                                                                                                         |
| `yarn build:renderer`                             | lulus (74.7 dtk) setelah alias `@preload` diperbaiki                                                                                                                                           |
| `yarn build:big-picture`                          | lulus (46.0 dtk) — skrip & entry ini dihapus di P0; Big Picture kini route `#/big-picture` di bundel renderer                                                                                  |
| `yarn build:sidecar`                              | lulus: `out/sidecar/index.mjs` 7.710 KB, 982 modul, 74 external                                                                                                                                |
| `yarn check:torrent-resources`                    | **gagal**: `hydra-native.node` tidak ada (butuh Rust + MSVC)                                                                                                                                   |
| `yarn tauri build`                                | **gagal**: `beforeBuildCommand` memanggil `yarn build:native`, yang bergantung pada paket `electron` yang sudah dihapus dan `hydra-native.node` yang belum dibangun → tidak ada installer NSIS |

24 kegagalan tes adalah lingkungan Windows dan sudah ada sebelum fase ini
(simlink `EPERM`, casing path `RAKAMH~1` vs `rakamhndra`, Wine/UMU Linux-only,
arsip 7z/zip, `native addon is not built`, `crash-recovery` yang membutuhkan
sidecar terbuild, dan satu suite Epic yang timeout). Tidak ada kegagalan yang
berasal dari penghapusan Electron atau dari perubahan Fase 8: `feature flag`,
sidecar, allowlist, dan tes kampanye Fase 8 lulus.

### Blokir yang belum dapat dibuktikan

| Butir PRD                                                               | Status                                                                   |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Instalasi NSIS di Windows bersih + checklist §6.1 penuh                 | **Tidak dijalankan** — tidak ada installer dan tidak ada VM bersih       |
| Ukuran installer (angka nyata)                                          | **Tidak terukur** — build berhenti di `build:native`/`hydra-native.node` |
| RAM idle (angka nyata)                                                  | **Tidak terukur** — aplikasi tidak dapat dibangun/dijalankan             |
| Tidak ada Python/legendary/`.pyz`/`hydra-epic-process.exe` di installer | **Terbukti statis** (lihat di bawah); isi installer belum diverifikasi   |
| SmartScreen / Smart App Control / Defender                              | **Tidak diuji** (butuh mesin bersih dan installer)                       |

Bukti statis untuk installer: tidak ada berkas `.py` di repo, tidak ada langkah
build Python/PyInstaller di `package.json`/CI, dan `bundle.resources` di
`src-tauri/tauri.conf.json` hanya memuat tray/icon/achievement/linux-game-capture/
ludusavi/hydra-native. Karena `yarn tauri build` tidak pernah menghasilkan paket,
klaim "installer bersih" tetap belum diuji pada artefak nyata.

Langkah menutup blokir (mesin dengan Rust, MSVC, WebView2):

```sh
yarn build:native            # hydra-native.node + VC++ runtime DLL
yarn check:torrent-resources # harus lulus
yarn tauri build             # NSIS di src-tauri/target/release/bundle/nsis/
```

Lalu jalankan checklist §6.1 di Windows 10 dan 11 bersih, ukur ukuran
`*-setup.exe` dan RAM idle (Task Manager → Details → Working set
`Sphinx Launcher.exe` + `node.exe`), dan catat di tabel ini.

### Definition of Done (PRD §8)

| #   | Butir                                                                                                         | Status                   | Bukti                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `yarn tauri build` menghasilkan NSIS yang terpasang/berjalan; ukuran installer + RAM idle dicatat             | **BLOKIR**               | `build:native` gagal (Electron dihapus, `hydra-native.node` belum ada); `src-tauri/target/release/bundle/nsis` tidak ada                    |
| 2   | Checklist §6.1 lulus tanpa regresi                                                                            | **BELUM**                | Membutuhkan installer (butir 1)                                                                                                             |
| 3   | Acceptance 4.C/4.E/4.F.6                                                                                      | **Sebagian (fase lain)** | `docs/torrent-tauri.md`, `docs/release.md`, tes cloud save; uji mesin bersih tidak diulang                                                  |
| 4   | Tidak ada Electron/Sentry/analytics/workwonders/login Hydra; Node diizinkan                                   | **LULUS**                | `docs/electron-allowlist.md`; `package.json`/`yarn.lock` bersih; grep hanya kategori sah                                                    |
| 5   | Logo sphinx terpasang dan disetujui                                                                           | **Sebagian**             | Branding ada; persetujuan manusia terbuka (Fase 2)                                                                                          |
| 6   | Engine torrent native dari installer tanpa Python; tidak ada Python/legendary/`.pyz`/`hydra-epic-process.exe` | **Sebagian**             | Tidak ada Python di repo/build; `hydra-native.node` belum dibangun → belum diuji dari installer                                             |
| 7   | `latest.json` + `SHA256SUMS` benar; versi tiga berkas = tag                                                   | **Sebagian**             | Tes unit `make-update-manifest`/`bump-version` lulus; artefak nyata belum ada                                                               |
| 8   | Dokumen: LICENSE, NOTICE, MIT-hydra, THIRD_PARTY_NOTICES, README, docs/…                                      | **LULUS**                | Berkas ada; `LICENSE` = `daf69d…`; MIT Hydra ada; `docs/upstream-policy.md` diperbarui                                                      |
| 9   | Tidak ada uji Epic; semua butir §10 tercatat                                                                  | **BELUM**                | Suite Epic **masih ada** (Linux-only; dikecualikan dari run Windows) dan `yarn test` tanpa filter menggantung; bukan "lulus dengan catatan" |
| 10  | Commit rapi di branch                                                                                         | **Belum**                | Belum di-commit (menunggu persetujuan pengguna)                                                                                             |

### Butir wajib dibuktikan (PRD §10)

| #     | Butir                                                                            | Hasil di Fase 8                                                                  |
| ----- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1     | Capability + command kustom; iframe/remote tidak `invoke`                        | Fase 3/4 (`docs/tauri-security.md`); tidak diuji ulang                           |
| 2     | `on_before_exit`; `download()`/`install()` terpisah                              | `src-tauri/src/updater.rs`; belum E2E (`docs/release.md` §7)                     |
| 3     | `tauri-action` draft → publish; `latest.json` valid                              | Workflow ada; belum pernah dijalankan                                            |
| 4     | Opsi NSIS, `installMode`, `signCommand`                                          | Dicek ke schema (`docs/release.md` §5–6); installer belum dibuat                 |
| 5     | Native module di Node bundel                                                     | `sharp`/`classic-level` lulus Fase 0; `hydra-native` tidak bisa dibangun di sini |
| 6     | Job object/detached spawn                                                        | Tes crash Fase 4 (game hidup); tutup app/update tidak diuji ulang                |
| 7     | Perilaku baseline saat quit/crash                                                | `docs/baseline-behavior.md`                                                      |
| 8     | SmartScreen (browser vs self-update), Smart App Control                          | **Tidak diuji**                                                                  |
| 9     | Defender false positive                                                          | **Tidak diuji**                                                                  |
| 10–15 | Drive: ETag, `appProperties`, rate limit, `about.get`, brand verification, kuota | `docs/cloud-save-audit.md` + tes; tidak diverifikasi ulang ke API nyata          |
| 16    | `needsAuth:false` terhadap API nyata                                             | `docs/account-dependent-features.md`; verifikasi runtime Fase 0/1                |
| 17    | Aset Epic khusus Epic                                                            | `docs/epic-audit.md`; Fase 8 menghapus build asset-nya dari repo                 |
| 18    | Python hanya untuk legendary                                                     | Benar; sekarang Python dihapus total dari build/CI                               |
| 19    | ludusavi mengunduh manifest?                                                     | `docs/network-calls.md`                                                          |
| 20    | Kunci minisign: cadangan, terpisah dari Authenticode                             | Prosedur `docs/release.md` §1–3; kunci belum dibuat/dicadangkan                  |
| 21    | Celah playtime saat crash terdokumentasi                                         | `docs/baseline-behavior.md`, README batasan v1                                   |

### Code review diff terhadap `baseline-hydra`

`git diff --stat baseline-hydra`: **513 berkas, +37.757 / −15.499**. Sebaran
terbesar: `src/main` (105), `src/renderer` (71), branding/aset (48),
`src/locales` (35), `src-tauri` (19+), `src/sidecar` (18), ditambah penghapusan
jalur Electron/Python.

Yang diperiksa dan hasilnya:

- **Tidak ada jalur runtime yang masih memanggil API Electron asli.** Renderer
  memakai `src/tauri-bridge/electron.ts`, sidecar memakai
  `src/sidecar/electron-shim`. Alias di `vite.config*.ts`,
  `tsconfig*.json`, dan `scripts/build-sidecar.mjs` menutup ketiganya.
- **Tidak ada impor modul yang sudah dihapus** (`electron`, `@sentry/*`,
  `workwonders-sdk`, `legendary/*`, `hydra-python-rpc`). `yarn build:renderer`
  (yang kini juga memuat Big Picture di `#/big-picture`) dan `build:sidecar`
  membuktikannya untuk kedua bundel.
- **Risiko yang tersisa:** (a) shim masih longgar di beberapa tempat
  (`(...args: any[])` pada listener, `Menu` index signature) — disengaja agar
  kontrak Electron tetap cocok, diberi komentar; (b) `src/main/services/epic/**`
  tetap ada di balik flag `false`, sehingga tes Linux-only-nya ikut dijalankan
  `yarn test` dan menggantung di Windows; (c) `hydra-native` belum dibangun di
  mesin ini, jadi jalur torrent hanya tervalidasi lewat typecheck/unit test,
  belum lewat paket.
- **Bug yang ditemukan review dan sudah diperbaiki:** lockfile basi, tipe shim
  tidak lengkap, impor logger renderer menunjuk path yang salah, alias
  `@preload` hilang, dan sisa build asset Epic/Python.

## Remediasi review pasca-Fase 8 (P0/P1/P2)

Daftar temuan lengkap ada di `HANDOFF-sphinx-fixes.md`. Yang sudah dikerjakan dan
diverifikasi di mesin ini:

| Item  | Perubahan                                                                                                                                                                                                                                                                             | Bukti                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| P0-1  | `record_restart` menghitung budget setelah membuang entri di luar jendela; tes aging yang salah diperbaiki (PRD §4.A.4: 3 restart/60 dtk)                                                                                                                                             | `cargo test` — tes restart lulus                                                       |
| P0-2  | `createIpcEvent` mengisi `senderFrame` dari `sender.mainFrame`; `readDirectory`/`getPathInfo`/`listDrives` menerima sender tepercaya                                                                                                                                                  | `src/sidecar/ipc-event.test.ts`                                                        |
| P0-3  | `bundle.resources` memetakan `../out/sidecar` → `sidecar`, cocok dengan `sidecar/config.rs`                                                                                                                                                                                           | `cargo test`; isi installer belum diuji                                                |
| P0-4  | Big Picture menjadi route `#/big-picture` di bundel renderer; entry Vite terpisah (`vite.config.big-picture.ts`, `src/big-picture/`) dihapus; `beforeBuildCommand` menjalankan `build:sidecar`                                                                                        | `yarn build:renderer`; `docs/tauri-security.md` §2                                     |
| P1-1  | `window.create` memetakan `x`/`y`, `maxWidth`/`maxHeight`, `minimizable`/`maximizable`/`focusable`, `backgroundColor`, `titleBarStyle` (macOS), `icon`; semua jendela renderer mengirim `label`                                                                                       | `cargo test` — tes `color_from_hex`                                                    |
| P1-2  | `setFocusable`, `setProgressBar`, dan `setOpacity` (0 = hide, 1 = show, nilai tengah `not_implemented`) diimplementasikan                                                                                                                                                             | `cargo test` — tes `progress_bar_state`                                                |
| P1-3  | Label renderer hanya boleh memuat path aplikasi atau origin `devUrl`; URL remote ditolak di `window.create`                                                                                                                                                                           | `cargo test` — 6 tes `renderer_url_allowed`/`is_renderer_label`                        |
| P1-4  | Skema `local:` hanya melayani berkas gambar absolut tanpa `..`; CORS hanya untuk origin renderer tepercaya                                                                                                                                                                            | `cargo test` — 3 tes `uri_scheme`                                                      |
| P1-5  | `let _ =` pada hasil fallible diganti penanganan eksplisit (`deliver` di `dialogs.rs`, log di supervisor/tray/platform)                                                                                                                                                               | `cargo clippy --all-targets --all-features` exit 0                                     |
| P1-6  | Binding unit `let _ = done` dihapus                                                                                                                                                                                                                                                   | `cargo clippy` exit 0                                                                  |
| P1-7  | `clippy::unreachable` dari ekspansi `#[tauri::command]` disupresi dengan `#![expect(..., reason = ...)]`; `updater` merapikan doc dan memakai `#[derive(Default)]`                                                                                                                    | `cargo clippy` exit 0                                                                  |
| P1-8  | `cargo fmt --all` diterapkan hanya di crate `src-tauri`                                                                                                                                                                                                                               | `cargo fmt --all -- --check` exit 0                                                    |
| P1-9  | `script-src 'self'` (tanpa `unsafe-inline`/`unsafe-eval`); `ws:`/`wss:` dihapus dari `connect-src`; `local:` ditambahkan; `<meta>` CSP permisif di `index.html` dihapus                                                                                                               | bundel produksi tanpa inline script/`eval`; `yarn build:renderer`                      |
| P1-10 | `scripts/stage-node-binary.mjs` memakai triple `aarch64`/`x86_64` yang benar dan gagal pada platform tak dikenal                                                                                                                                                                      | skrip dijalankan ulang                                                                 |
| P1-11 | Banner status sidecar menampilkan tombol "Coba lagi" saat supervisor menyerah; `sidecar_restart` dipanggil lewat `setSidecarRetry`                                                                                                                                                    | `src/tauri-bridge/reconnect-indicator.test.ts` — 6/6                                   |
| P2-1  | Generator allowlist sadar-flag: `feature-flags.json` + peta `channelFlags` dibaca; 83 kanal flag mati tidak masuk tabel Rust/sidecar; paritas diuji                                                                                                                                   | `allowlist.test.ts` — 11/11; `--check` exit 0                                          |
| P2-2  | `use-epic-managed.test.ts` tidak lagi crash: `tsconfig.test.json` memakai `types: ["node", "vite/client"]`, sehingga `import.meta.env` di helper renderer lolos typecheck ts-node                                                                                                     | tes 42/42                                                                              |
| P2-3  | Kegagalan test Windows (symlink `EPERM`, pemisah path, path pendek 8.3, YAML) dikonfirmasi lingkungan dan sudah didokumentasikan                                                                                                                                                      | `docs/windows-environmental-test-failures.md`                                          |
| P2-4  | `crash-recovery.test.ts` memakai `sublevel<string, Record<string, unknown>>(...)`; cast `as Record<string, unknown>` dihapus                                                                                                                                                          | `tsc --noEmit -p tsconfig.test.json` exit 0                                            |
| P2-5  | Dokumen dikoreksi: bagian build Electron ditandai historis Fase 0; klaim `hydraApiCall` bocor dikoreksi; DoD 9 menjadi **BELUM**                                                                                                                                                      | `docs/MIGRATION_LOG.md`                                                                |
| P2-6  | `publicProfilePath` tetap `C:/Users/Public` dengan komentar: itu path guest Windows di dalam prefix Wine, bukan `%PUBLIC%` host                                                                                                                                                       | `src/main/constants.ts`                                                                |
| P2-7a | §4.G: `Cargo.toml` `license = "Apache-2.0"`; `bundle.publisher`/`copyright`/`licenseFile`/`category`/`shortDescription` diisi                                                                                                                                                         | `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`                                    |
| P2-7b | §4.E: `allowToChangeInstallationDirectory`/`oneClick` tidak ada di `NsisConfig`, tetapi template NSIS Tauri memuat `MUI_PAGE_DIRECTORY`; dikutip dari template resmi                                                                                                                  | `docs/release.md` §5                                                                   |
| P2-7c | §8.4: kunci `setup_install_guide_workwonders` (sisa SDK workwonders) dihapus dari 11 locale                                                                                                                                                                                           | `grep` bersih                                                                          |
| P2-7d | §4.F.2/§4.F.3: ETag/`If-Match` dicek ke referensi resmi `files.update` — tidak didokumentasikan, jadi desain tidak bergantung padanya                                                                                                                                                 | `docs/cloud-save-audit.md` §8.1                                                        |
| P2-7e | §8.9: `yarn test` tanpa filter menggantung di suite Epic; DoD 9 tidak lagi ditandai lulus                                                                                                                                                                                             | `docs/MIGRATION_LOG.md`                                                                |
| P2-8  | Urutan boot: `loadState` tidak lagi memulai main loop; `src/sidecar/entry.ts` menjalankan recovery scan dulu, baru `startMainLoop`, sehingga sesi game yang sudah berjalan ditandai `resumed` (sebelumnya tick pertama process watcher menang balapan)                                | `yarn test:crash` - tes resumed lulus                                                  |
| P2-9  | `yarn test:crash` memakai `--test-concurrency=1`: `crash-recovery` dan `torrent-engine` sama-sama memakai port torrent 5881, jadi berkas paralel saling berebut saat addon native terpasang                                                                                           | `yarn test:crash` 32/32; `yarn test:torrent` 4/4                                       |
| P2-10 | Protokol `rpc-error`: sidecar hanya mengenali `rpc-result`, padahal Rust mengirim tipe terpisah untuk kegagalan. Setiap host RPC yang gagal (mis. `updater.check` 404 karena repo belum punya release) menggantung sampai timeout 120 dtk di renderer                                 | Test `rpc.test.ts` memakai bentuk `rpc-error`; `checkForUpdates` via CDP selesai cepat |
| P2-11 | Host RPC dijalankan di task terpisah, bukan di read loop: `dialog.showOpenDialog` menunggu user dan `updater.check` menunggu jaringan, sehingga heartbeat berhenti dan watchdog membunuh sidecar yang sehat. Tambahan timeout 30 dtk untuk cek update (default plugin: tanpa timeout) | `cargo test`/`clippy`; dialog & cek update tidak lagi memicu restart                   |

Hasil verifikasi terakhir: `cargo test --all-features` 30 lulus; `cargo clippy
--all-targets --all-features` exit 0; `cargo fmt --all -- --check` exit 0;
`yarn typecheck` exit 0; `yarn lint` 0 error / 78 warning; `yarn format-check`
exit 0; `yarn test:crash` 33/33; `yarn test:torrent` 4/4.

Uji manual `tauri dev` di Windows (WebView2, CDP di port 9222): Home, Catalogue
(218.398 hasil), detail game, Library, Downloads, Settings, dan Big Picture
(jendela kedua, termasuk detail game) semua tampil; sidebar berpindah rute;
`addGameToLibrary`/`removeGameFromLibrary` menulis dan membaca LevelDB dengan
benar; tidak ada error console selain `favicon.ico` 404 (kosmetik). Satu-satunya
anomali saat boot adalah `unhandledRejection ENOENT ludusavi.exe` — perilaku
baseline yang memang didokumentasikan (`src/sidecar/electron-shim/logger.ts`),
karena binary ludusavi belum terunduh di mesin ini.

Batasan yang tetap ada: `window.create` tidak membatasi origin untuk label
non-renderer (jendela auth Epic/Steam memang perlu origin provider apa pun);
`setOpacity` parsial tidak didukung; CSP `img-src`/`media-src`/`connect-src`
masih memuat `https: http:` karena URL artwork/trailer berasal dari katalog;
dan `yarn tauri build` tetap terblokir `build:native`.

## Build alpha 0.1 dan bug packaging sidecar

Installer 0.1.0 dibangun lokal dengan `TAURI_SIGNING_PRIVATE_KEY` (kunci
minisign baru di `~/.sphinx-updater/`, public key di
`src-tauri/tauri.conf.json`). `yarn build` sempat gagal dua kali, dan keduanya
temuan nyata:

| Item  | Masalah                                                                                                                                                                                                                                                                                                                                                                          | Perbaikan                                                                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2-12 | `rpc.rs` memanggil `window.open_devtools()`/`close_devtools()`, yang hanya dikompilasi Tauri pada debug build. `tauri dev` dan `cargo test` lulus, `yarn build` gagal E0599 di profil release                                                                                                                                                                                    | Cabang devtools diberi `#[cfg(any(debug_assertions, feature = "devtools"))]`, fitur `devtools` opsional di `Cargo.toml`, dan release menjawab `not_implemented`                                          |
| P2-13 | Sidecar hasil bundel gagal boot dari installer: `ERR_MODULE_NOT_FOUND: Cannot find package 'classic-level'`. `build-sidecar.mjs` sengaja membuat semua dependency produksi external dan menyatakan sidecar "ships with `node_modules`", tetapi tidak ada langkah yang menyalinnya. Di `tauri dev` paket ditemukan dari root repo, jadi celah ini hanya muncul di build terpasang | `scripts/stage-sidecar-deps.mjs` menelusuri specifier bundel, menyalin paket + closure dependency ke `out/sidecar/node_modules`, lalu dijalankan di `beforeBuildCommand` dan workflow rilis              |
| P2-14 | Renderer kalah balapan dengan sidecar saat cold start: `main.tsx` menunggu `isStaging()` sebelum memasang React, sedangkan supervisor langsung menolak dengan `sidecar_starting` selama sidecar belum `ready`. Di build terpasang jendela berhenti di "Menyalakan layanan latar"                                                                                                 | `request_channel` menunggu `ready` (poll 50 ms, batas 30 dtk) alih-alih menolak seketika; `cargo test`/`clippy`/`fmt` lulus                                                                              |
| P2-15 | Saat host keluar lebih dulu, pipe stderr/stdout tertutup. Logger menulis error `EPIPE` lewat jalur yang sama, memicu `uncaughtException` berulang tanpa henti: satu proses yatim menulis `error.txt` 1,7 GB dalam beberapa menit. Jalur shutdown juga menggantung di `flushAndWait` sehingga sidecar yatim tidak pernah keluar                                                   | Logger memakai `writeStderr` dengan flag `stderrBroken` dan listener `error`; `JsonLineTransport` berhenti menulis dan menyelesaikan `flushAndWait` saat output rusak. Tes regresi `rpc.test.ts` (14/14) |

Verifikasi installer 0.1.0: dipasang senyap ke folder sementara
(`/S /D=...`), isi folder memuat `sphinx-launcher.exe`, `node.exe`, `sidecar/`
(termasuk `node_modules`), `hydra-native/`, dan `ludusavi/`; `classic-level` dan
`sharp` dimuat oleh `node.exe` yang dibundel (v24.22.1). Installer terkompresi
sekitar 60 MB dan folder terpasang sekitar 248 MB karena dependency produksi dan
source map ikut dibundel.

Menjalankan build terpasang itulah yang menemukan P2-13 sampai P2-15. `tauri dev`
melewatkan ketiganya: paket ditemukan dari root repo, sidecar sudah siap sebelum
jendela memuat, dan stderr tetap terbuka. Karena itu uji asap rilis harus memakai
installer, bukan `tauri dev`.

Build 0.1.0 juga dibuat tanpa `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, karena
kredensial hanya ada sebagai secret GitHub dan tidak bisa dibaca dari mesin ini.
`option_env!` menanam nilainya saat kompilasi, jadi cloud save di binary ini mati
dan shell mencetak peringatan saat boot. README dan catatan rilis menyebutkan
batasan itu; build berikutnya dengan kedua variabel di environment akan
mengaktifkannya kembali tanpa perubahan kode.
