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

| Item | Nilai | Bukti |
| --- | --- | --- |
| Versi paket upstream | `4.1.6` | `package.json` di clone dan direktori kerja |
| Clone upstream | `C:\Users\Raka Mahendra\Dokumen\Projects\hydra-baseline` | `git clone https://github.com/hydralauncher/hydra.git` |
| HEAD upstream saat clone | `a47faed2786b519d0e7579386b5f7c17f8b6a2cb` (2026-10-22) | `git rev-parse HEAD` |
| Tag upstream `v4.1.6` | `5e5dbcc77fe2638daa7e5365cdafdd6cda3f85fb` | `git rev-parse v4.1.6` |
| Commit yang cocok dengan direktori kerja | `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd` (2026-10-20) | diff clone `be492f5` vs direktori kerja |
| Tag lokal `baseline-hydra` | `be492f5e3fc4a37c55d7df2b07faf5f9565c84dd` | `git rev-parse baseline-hydra` |
| Branch kerja | `sphinx/tauri-migration` | `git branch --show-current` |
| Remote upstream | `https://github.com/hydralauncher/hydra.git` | `git remote -v` |

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

| Tool | Versi / status | Bukti |
| --- | --- | --- |
| OS | Windows 10 Pro 19045, 64-bit | `Get-CimInstance Win32_OperatingSystem` |
| Node.js | `v24.20.0` | `node --version` |
| npm | tersedia tetapi `npm.ps1` diblokir ExecutionPolicy | `npm --version` gagal; gunakan `npm.cmd`/`corepack` |
| Corepack | `0.35.0` | `corepack --version` |
| Yarn | `1.22.22` | `corepack yarn --version` |
| Git | `2.55.0.windows.5` | `git --version` |
| Visual Studio 2022 / Build Tools | tidak ada | `Test-Path` untuk kedua lokasi = `False` |
| Rust / Cargo | tidak ada | `C:\Users\Raka Mahendra\.cargo\bin` = `False` |
| Python | `3.14` (user install) | `where.exe python` |

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

| Perintah | Hasil | Log |
| --- | --- | --- |
| `corepack yarn typecheck:node` | exit 0, 12.03 dtk | `%TEMP%\opencode\typecheck-node.log` |
| `corepack yarn typecheck:web` | exit 0, 35.61 dtk | `%TEMP%\opencode\typecheck-web.log` |
| `corepack yarn typecheck` | exit 0, 48.01 dtk | `%TEMP%\opencode\typecheck-full.log` |

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

| Modul | Status | Bukti |
| --- | --- | --- |
| `sharp` | lulus | `sharp=0.35.0 libvips=8.18.3` di Node v24.20.0 |
| `classic-level` | lulus | smoke test buka/put/get/tutup database sementara = `classic-level=ok` |
| `hydra-native.node` | **tidak ada** | `Test-Path native/hydra-native/hydra-native.node` = `False`; tidak ada folder `target` |
| Torrent bridge prebuilt | ada | `libhydra_torrent_bridge.so` (x64 Linux) dan `hydra_torrent_bridge.dll`/`.lib` (x64 Windows static) |

`hydra-native` adalah addon Rust N-API untuk torrent, process listing, image
processing, screenshot, dan hashing/restore cloud save. Tanpa file ini, build
Electron tetap selesai, tetapi fitur yang memanggil addon tidak dapat
diverifikasi atau dijalankan.

## Status dokumen audit

| Dokumen | Status | Temuan utama |
| --- | --- | --- |
| `docs/ipc-inventory.md` | selesai | 311 `registerEvent`, 40 direct `ipcMain.handle`, 351 main receiver unik, 431 nama preload, 3 API preload stale |
| `docs/electron-api-usage.md` | selesai | 9 kelas window, `sandbox:false`, remote renderer, protocol `local:`/`gradient:`, pemetaan Tauri |
| `docs/torrent-audit.md` | selesai | batas torrent, 4 RPC, port `5881`, seeding/state, guardrail migrasi |
| `docs/account-dependent-features.md` | selesai | 109 panggilan `HydraApi.*`, 15 publik eksplisit, 19 subscription-gated, 97 panggilan renderer, peta lima flag |
| `docs/epic-audit.md` | selesai | aset Epic-only, 16 kanal IPC, 88 file/38 test, Python bundled hanya Legendary, unduhan build-time |
| `docs/cloud-save-audit.md` | selesai | dua pipeline Hydra (legacy tar + v2 snapshot), 30 kanal, tidak ada Google Drive, batas 500 file/2 GiB, concurrency 8 |
| `docs/network-calls.md` | selesai | env endpoint, remote `bundle.js`, remote renderer, katalog/Steam, hoster/debrid, emulasi, Epic, telemetri, P2P, listener lokal |
| `docs/baseline-behavior.md` | selesai | startup/quit, close-to-tray, game saat quit/crash, deep link, updater, log, NSIS/portable |

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
  materi. PRD meminta repo publik non-fork yang kosong. Pengguna harus
  membuat/mengonfirmasi repo tersebut sebelum `origin` ditambahkan.
- **Izin:** `git push` belum dilakukan dan memerlukan izin eksplisit pengguna.
- **Keputusan:** konfirmasi SHA baseline final (`be492f5` vs `a47faed` vs
  `v4.1.6`).
- **Keputusan:** arsitektur cloud save Google Drive vs kelanjutan Hydra API;
  lihat `docs/cloud-save-audit.md`.
- **Keputusan:** apakah Sphinx mempertahankan pipeline native v2 dan hanya
  mengganti provider remote, atau membangun ulang cloud save.
- **Keputusan:** apakah installer Sphinx tetap menyimpan userData saat
  uninstall seperti baseline.
- **Catatan:** auto-update masih menunjuk `hydralauncher/hydra`; harus diganti
  sebelum build rilis.

## Langkah berikutnya

1. Pengguna membuat/mengonfirmasi repo publik non-fork `Raka-Mahendra/sphinx`.
2. Tambahkan `origin`, lalu minta izin `git push`.
3. Selesaikan verifikasi `hydra-native.node` (prebuilt atau toolchain).
4. Jalankan runtime Electron `dev`/`start` pada mesin bersih dan catat hasil.
5. Setelah Fase 0 disetujui, mulai Fase 1: feature flags, allowlist IPC, dan
   penghapusan remote renderer/telemetri.

