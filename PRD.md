# PRD — Sphinx Launcher (fork Hydra Launcher → Tauri)

| Item | Isi |
|---|---|
| Versi dokumen | 2.2 (hasil audit baseline dan sesi grill-me Q1–Q14) |
| Repo sumber | https://github.com/hydralauncher/hydra (MIT) |
| Baseline | Hydra **4.1.6** + SHA commit upstream (diisi Fase 0 dari clone ulang). Tag `baseline-hydra` dipasang di commit upstream persis itu |
| Repo proyek | `Raka-Mahendra/sphinx`, **publik**, bukan GitHub fork. `upstream` hanya referensi |
| Produk | **Sphinx Launcher**, versi awal **0.1.0** |
| Lisensi | **Apache-2.0**, `Copyright 2026 Raka Mahendra` |
| Agent pelaksana | opencode, deepseek v4.1 flash 1017; skill `logo-design` dan skill pendukung (lihat PROMPT.md) |
| Platform | Windows 10/11 x64 (prioritas); Linux opsional di Fase 9. macOS di luar cakupan |

---

## 1. Ringkasan

Fork Hydra Launcher dengan perubahan berikut. **Di luar daftar ini, UI, fitur, alur, dan perilaku harus tetap sama.**

1. **Framework**: Electron → **Tauri v2**.
2. **Mesin torrent: tidak diganti.** Tetap `hydra-native` (Rust N-API) + `native/torrent-bridge` (C++ libtorrent), dimuat oleh sidecar Node.
3. **Branding**: Hydra → **Sphinx Launcher**, logo sphinx **dibuat agent** dengan skill `logo-design`.
4. **Tanpa login**: login/akun Hydra dihapus; fitur yang bergantung akun disembunyikan lewat feature flag (kode dipertahankan).
5. **Tanpa Sentry, analytics, dan `workwonders-sdk`**: dihapus total.
6. **Auto-update** lewat GitHub Releases/Tags.
7. **Cloud save Google Drive** milik pengguna, menggantikan Hydra Cloud; memakai ulang pipeline snapshot native v2.
8. **Lisensi Apache-2.0** dengan atribusi MIT Hydra dipertahankan.

Prinsip: perubahan minimal di luar daftar. Kalau ragu apakah sesuatu perlu diubah, jawabannya tidak.

## 2. Tujuan, non-tujuan, batasan

### Tujuan
- Sphinx Launcher berjalan di Tauri v2 dengan tampilan identik Hydra (selain nama, logo, dan bagian akun/cloud yang berubah), termasuk jendela Big Picture.
- Unduhan torrent/magnet tetap berjalan dengan engine bawaan dan setara baseline, juga dari installer di mesin bersih (tanpa Python).
- Tidak ada Electron, Sentry, analytics, `workwonders-sdk`, atau login Hydra di build akhir.
- Pengguna bisa menyimpan dan memulihkan save game ke Google Drive mereka sendiri dengan izin terkecil dan pemakaian kuota minimum.
- Aplikasi memperbarui diri dari GitHub Releases.
- Tidak ada tulisan atau logo Hydra yang terlihat pengguna (kecuali atribusi).
- Ukuran installer dan RAM idle **diukur** di Fase 8 (angka nyata, bukan perkiraan).

### Pernyataan penting
**Node.js LTS adalah runtime yang sengaja dibundel; yang dihapus adalah Electron, bukan Node.** Python tidak lagi dibutuhkan di runtime, build, maupun CI.

### Non-tujuan (dilarang dikerjakan)
- Mendesain ulang UI, menambah fitur baru, refactor besar yang tidak perlu, formatter massal, pindah/rename file besar-besaran.
- Mengganti atau memodifikasi mesin torrent, `DownloadManager`, status, seeding.
- Menulis ulang `src/main` ke Rust. Menulis ulang wrapper torrent ke Rust (jalur masa depan, lihat Backlog).
- Mengubah kontrak ke layanan eksternal non-akun (API katalog, CDN); endpoint tetap konfigurabel lewat `.env`.
- Tingkat risiko, konfirmasi, atau otorisasi bertingkat per kanal IPC (hanya allowlist biner).
- Membangun pengganti lokal untuk achievement atau Epic (Backlog).
- macOS, mobile, build portable.

### Batasan yang diketahui di v1 (ditulis juga di README)
- **Fitur yang hilang**: achievement dan souvenir, koneksi/sync Steam, teman, chat, profil, ulasan, sync library, sync download sources, cloud save Hydra legacy (berlangganan), Epic/legendary, plugin decky. Penyebabnya: bergantung login/server Hydra. Daftar final dikonfirmasi audit Fase 0.
- Definisi achievement berasal dari server Hydra, jadi **tidak ada achievement lokal** di v1.
- Installer Windows **tidak ditandatangani** (setara baseline): SmartScreen/Smart App Control/Defender bisa memberi peringatan.
- Tidak ada build portable. "Restart" saat update berarti instal lalu keluar.
- Fork dengan Google client ID berbeda **tidak berbagi** cloud save; itu bukan bug.
- Sphinx Launcher adalah fork independen, **tidak berafiliasi** dengan tim Hydra Launcher dan tidak mengikuti rilisnya.
- Celah playtime saat sidecar crash diakui dan didokumentasikan.

## 3. Keputusan arsitektur

| # | Keputusan | Alasan |
|---|---|---|
| A1 | **Tauri shell + Node sidecar monolitik.** Rust mengurus jendela, tray, dialog, deep link, single instance, autostart, updater, keychain. `src/main` (1.074 file) berjalan sebagai sidecar Node dengan shim modul `electron`. | Perilaku identik tanpa menulis ulang. |
| A2 | **Pakai ulang `src/preload/index.ts`** (hanya mengimpor `contextBridge` + `ipcRenderer` dari electron, plus `node:crypto`) dengan **shim `electron`** di sisi renderer yang berjalan di atas Tauri `invoke`/`listen`. | Menghindari menulis ulang 2.346 baris dan menjamin signature identik. |
| A3 | Bundler renderer: **Vite biasa** (hapus `electron-vite`). Package manager tetap **yarn v1**. Big Picture (`src/big-picture`, aplikasi Vite terpisah) memakai bridge dan flag yang sama. | Perubahan minimum. |
| A4 | **Mesin torrent = `hydra-native` (napi8, cdylib) + `torrent-bridge` (C++/CMake/vcpkg, prebuilt `x64-windows-static`)**, dipakai apa adanya. Hanya bisa dimuat proses Node, jadi dimuat sidecar. | Mesin nyata di baseline; risiko regresi terendah. |
| A5 | Tidak ada build Python/PyInstaller. Yang dibuild: native addon + bridge bila perlu. | Python hanya dipakai legendary/Epic yang dipangkas. |
| A6 | Identitas: data folder `sphinx-launcher`, bundle id `com.sphinxlauncher.app`, protokol `sphinx://` (hanya `sphinx://run` yang bertahan). Folder/crate `hydra-native` dan `torrent-bridge` **tidak di-rename**. | Tidak bentrok dengan Hydra; cherry-pick tetap mungkin. |
| A7 | **Updater**: repo publik, draft-release lalu publish, UX dua tahap, Rust pemilik state. | Pola `tauri-action` standar. |
| A8 | **Cloud save**: `GoogleDriveProvider` dengan **blob content-addressed + manifest immutable** di `appDataFolder`, scope `drive.appdata`. | Menjaga dedupe per file, snapshot berversi, varian. |
| A9 | Ludusavi tetap dibundel (dipakai `getGameBackupPreview`, `selectGameBackupPath`, `getGameSaveFolder`). Arsip/snapshot dibuat pipeline native v2, bukan ludusavi. | Hasil audit baseline. |
| A10 | Lisensi Apache-2.0 + `Copyright 2026 Raka Mahendra`; MIT Hydra disalin ke `LICENSES/MIT-hydra.txt`. | MIT kompatibel untuk relisensi; notice asli wajib dipertahankan. |
| A11 | **Feature flag**: `src/shared/feature-flags.json`, satu sumber, build-time, tidak bisa diubah pengguna. | Satu nilai mengunci UI, service, dan kanal. |
| A12 | **Allowlist IPC** di-generate saat build dari source; divalidasi di Rust dan diulang di sidecar. | Mencegah XSS di renderer berujung eksekusi penuh. |
| A13 | **Model crash sidecar**: restart + recovery scan; game tidak boleh ikut mati. | Setara baseline, bukan lebih baik. |
| A14 | **Upstream beku**, cherry-pick selektif. | Merge berkala tidak realistis setelah migrasi. |

## 4. Cakupan pekerjaan

### 4.A Migrasi Electron → Tauri

#### 4.A.1 Struktur target (garis besar)

```
sphinx/
├─ src/renderer/            # UI, tidak diubah kecuali shim, branding, bagian akun/cloud
├─ src/big-picture/         # tetap; memakai bridge dan flag yang sama
├─ src/main/                # logika lama → kode sidecar
├─ src/preload/index.ts     # dipakai ulang apa adanya
├─ src/sidecar/             # entry.ts, rpc.ts, electron-shim/
├─ src/tauri-bridge/        # shim `electron` (contextBridge, ipcRenderer) di atas Tauri
├─ src/shared/feature-flags.json
├─ src-tauri/               # Rust: tauri.conf.json, capabilities/, allowlist hasil generate, keychain, supervisor
├─ native/hydra-native, native/torrent-bridge   # TIDAK diubah/di-rename
├─ binaries/                # node (sidecar), ludusavi, tool lain yang sudah ada
├─ branding/                # logo hasil skill logo-design + ikon turunan
├─ scripts/                 # generator allowlist, bump-version, dll.
├─ .github/workflows/       # release.yml
├─ LICENSE  NOTICE  THIRD_PARTY_NOTICES.md  LICENSES/MIT-hydra.txt
├─ docs/                    # MIGRATION_LOG.md, audit, feature-flags.md, upstream-policy.md, google-drive-setup.md, release.md, ...
└─ PRD.md
```

#### 4.A.2 Kontrak IPC dan allowlist
- Renderer → sidecar: `window.electron.<fn>(...)` (dari preload yang dipakai ulang) → shim `ipcRenderer` → `invoke('ipc_invoke', { channel, args })` → Rust → stdin sidecar `{id, channel, args}` → handler lama → `{id, result|error}`. `ipcRenderer.send` → `ipc_send`.
- Sidecar → renderer (`webContents.send`) → Rust `emit("sphinx:ipc-event", {channel, payload})` → listener di shim.
- **RPC dua arah**: sidecar memanggil Rust (dialog, shell, keychain, path, updater) lewat `{id, method, params}`.
- Signature, nama channel, bentuk data persis sama dengan baseline. Error sidecar tetap menjadi `Promise.reject`.
- **Skala (hasil audit)**: 311 kanal `ipcMain.handle` (via `registerEvent`), 748 pemakaian `window.electron.*` di renderer.
- **Allowlist (A12)**:
  - Mencakup `ipcMain.handle`, `ipcMain.on`/`ipcRenderer.send`, dan semua `webContents.send`, termasuk yang didaftarkan kondisional per platform/dev.
  - **Di-generate otomatis saat build** dari source (parse `registerEvent` dan pemanggilan lain), jadi konstanta Rust. Tidak dipelihara tangan. Sumber yang sama menghasilkan `docs/ipc-inventory.md`.
  - Kanal dinamis (mis. `on-update-achievements-${objectId}-${shop}`) lewat **prefiks sesempit mungkin + aturan sufiks**, didokumentasikan.
  - Kanal yang dimatikan feature flag **otomatis tidak masuk** allowlist. Kanal tak dikenal → error keras `channel_not_allowed`.
  - Validasi di **Rust**, diulang di **sidecar**.
  - Tes yang gagal bila source menambah kanal tanpa memperbarui allowlist.
- **Tanpa isolated world**: di Tauri shim berjalan di JS world yang sama dengan renderer. Mitigasinya allowlist Rust. Dokumentasikan konsekuensi ini.

#### 4.A.3 Padanan API Electron → Tauri (inventaris awal; Fase 0 melengkapi dari kode)

| Electron | Padanan |
|---|---|
| `BrowserWindow` (utama, Big Picture, notifikasi, dll.) | `WebviewWindow`; jendela custom dipertahankan |
| `ipcMain`/`ipcRenderer`/`webContents.send` | Shim + RPC sidecar + allowlist |
| `app.getPath/getVersion/quit/isPackaged` | Command Rust, diteruskan ke sidecar |
| `shell.*`, `dialog.*` | `tauri-plugin-opener`, `tauri-plugin-dialog` |
| `Tray`, `Menu` | Tray bawaan Tauri |
| `protocol.handle` (file lokal) | `register_uri_scheme_protocol`/asset protocol (cek nama protokol) |
| `setAsDefaultProtocolClient`, `second-instance` | `tauri-plugin-deep-link` + `tauri-plugin-single-instance` |
| `electron-updater` / `UpdateManager` | `tauri-plugin-updater` (4.E) |
| `auto-launch` | `tauri-plugin-autostart` |
| `Notification` | `tauri-plugin-notification` |
| `crashReporter` | Hilang bersama Electron; pengganti: log lokal (lihat §9) |
| `<webview>` (jika dipakai) | `iframe`/jendela anak (risiko R2) |
| `session.webRequest`, `net` | Sidecar (Node fetch/proxy) atau `tauri-plugin-http` |
| `sharp`, `hydra-native` (N-API), `classic-level`, `node-7z`, `winreg`, `detect-drives` | Tetap di sidecar; verifikasi di Node bundel (N-API ABI stabil; `classic-level` diverifikasi Fase 0) |
| `electron-log` | Logger ke file + console |

#### 4.A.4 Sidecar dan siklus hidup
- Bundle `src/main` + `src/sidecar` dengan esbuild; alias `electron` → `src/sidecar/electron-shim` (hanya API yang benar-benar dipakai; sisanya melempar `NotImplementedInShim: <api>`). Node LTS dipin dan dikemas sebagai `externalBin`.
- **Shutdown bertahap**: Rust meminta sidecar shutdown bersih lewat RPC (termasuk `torrentShutdown` agar resume data tersimpan) dengan timeout, baru kill paksa.
- **Heartbeat**: ping berkala dengan timeout dari Rust; sidecar yang menggantung di-kill lalu di-restart.
- **Supervisor menunggu proses lama benar-benar mati** sebelum spawn baru (kunci eksklusif `classic-level`/LevelDB; mencegah dua engine torrent).
- IPC yang sedang berjalan saat sidecar mati ditolak dengan `sidecar_restarted`; UI menampilkan indikator "menyambung ulang". Listener event tetap hidup (emit dari Rust).
- Setelah **3 restart per menit**: berhenti dan tampilkan dialog dengan tombol "Coba lagi".
- **Recovery scan** saat sidecar start: deteksi ulang game yang masih berjalan dari executable tercatat di LevelDB; lanjutkan sesi playtime dengan ID sesi unik dan tanda `resumed` (tanpa persistensi baru; celah saat crash didokumentasikan); torrent lanjut dari resume data (hash recheck boleh, duplikasi/korupsi tidak); antrean unduhan dari LevelDB dibangun ulang.
- **Game tidak boleh ikut mati** saat sidecar crash, update, atau app ditutup normal: spawn game terlepas dari sidecar (job object/detached; **dibuktikan dengan tes**, termasuk perilaku plugin shell Tauri saat app keluar). Target = setara baseline Electron (audit Fase 0 mencatat perilaku baseline).

#### 4.A.5 Konfigurasi dan keamanan
- `tauri.conf.json`: `productName` "Sphinx Launcher", identifier `com.sphinxlauncher.app`, jendela sama dengan perilaku Electron lama. Capabilities minimal, CSP ketat yang tetap mengizinkan domain yang dipakai UI.
- **Wajib dibuktikan di dokumentasi Tauri v2** (bukan diasumsikan): command kustom hanya bisa dipanggil jendela berizin; iframe/konten remote tidak bisa `invoke`; `remote.urls` tidak dibuka tanpa perlu.
- Uji komponen berat terhadap WebView2/WebKitGTK: `hls.js`, Monaco, TipTap, `react-shadow`, `framer-motion`, drag-and-drop.
- Skrip: `dev` → `tauri dev`, `build` → `tauri build`, tambah `build:sidecar`. Pertahankan `husky` + `commitlint`.

### 4.B Akun, pemangkasan fitur, Sentry/analytics

#### 4.B.1 Inti yang dipertahankan (anonim) dan yang dipangkas
- **Tetap**: katalog + detail/aset game, unduhan torrent + download sources, library lokal (tambah/hapus/favorit/koleksi/playtime), emulator/RetroArch/LaunchBox, pengaturan, tema, i18n, Big Picture, cloud save Google Drive (baru).
- **Disembunyikan**: achievement + souvenir, koneksi/sync Steam, teman, chat, profil, ulasan, sync library, sync download sources, cloud save Hydra legacy, Epic/legendary, plugin decky.
- Hasil audit: dari 251 call site `HydraApi` hanya 16 yang `needsAuth: false` (katalog, aset game, mulai unduhan, download sources, shop details retroarch/launchbox, decky info). Klasifikasi ini **heuristik**; diverifikasi runtime terhadap API nyata di Fase 0/1, dan jalur yang menolak anonim dicatat, bukan dipaksa.

#### 4.B.2 Feature flag
- `src/shared/feature-flags.json`: JSON (bukan modul TS), diimpor renderer, big-picture, dan sidecar, dan dibaca generator allowlist.
- Flag per fitur dengan induk, maksimal sekitar 5–6: `HYDRA_ACCOUNT_FEATURES` (induk: teman, chat, profil, ulasan, sync library, sync download sources), `ACHIEVEMENTS`, `STEAM_INTEGRATION`, `EPIC_INTEGRATION`, `HYDRA_CLOUD_LEGACY`. Hubungan induk-anak di `docs/feature-flags.md`.
- Flag hanya untuk fitur **disembunyikan tapi kodenya dipertahankan**. Login UI, Sentry, dan `workwonders-sdk` dihapus total tanpa flag.
- Pertama, periksa perilaku baseline untuk pengguna belum login dan manfaatkan jalur itu (app = pengguna anonim permanen), baru sembunyikan sisa titik masuk.
- Saat flag `false`:
  - **Semua titik masuk UI disembunyikan** (menu, tombol, rute, notifikasi, bagian Settings) di renderer **dan** big-picture (mis. `use-user-details.hook.ts`).
  - **Service latar tidak dijalankan** (achievement watcher, SSE, sync worker, epic sync, steam sync).
  - Kanal terkait tidak ada di allowlist; panggilan mengembalikan `feature_unavailable` (log level debug); semua pemanggil di renderer tertangani.
  - Data LevelDB fitur itu **tidak dihapus** (ledger `HYDRA_CLOUD_LEGACY` dibiarkan).
- Tanpa override env di build produksi; tes memakai mock modul.
- Epic: pastikan dulu `hydra-epic-process.exe`, `windows-epic-process`, `managed-legendary.pyz`, `prepare-legendary.cjs` memang khusus Epic sebelum dikeluarkan dari bundel. Enum `shop` untuk Epic tetap ada. Runtime Python, legendary, `.pyz`, dan `hydra-epic-process.exe` tidak masuk installer.

#### 4.B.3 Login, Sentry, analytics, workwonders
- **Login**: hapus UI login, token akun, refresh token, dan cabang auth deep link (`window-manager.ts`, sekitar baris 884). Deep link `run` tetap; `auth`, `steam-connected`, `update-account` hilang bersama fitur yang dipangkas.
- **Sentry**: hapus `@sentry/react`, init + tracing + replay di `src/renderer/src/main.tsx`, dan DSN `RENDERER_VITE_SENTRY_DSN`. Tidak ada upload sourcemap yang terlihat di baseline (verifikasi). `crashReporter.start({uploadToServer:false})` tidak mengirim apa pun; dibiarkan di Fase 1 dan hilang bersama Electron.
- **`workwonders-sdk`**: dihapus beserta `workwondersJwt` dan seluruh koneksi ke `workwonders.app` (widget pihak ketiga yang butuh login Hydra).
- `docs/network-calls.md` mencatat semua panggilan keluar yang tersisa (API katalog, GitHub Releases, Google bila Drive dihubungkan) dan **verifikasi apakah ludusavi mengunduh manifest dari internet**.

### 4.C Torrent: engine bawaan dipertahankan

- Engine: `hydra-native` + `torrent-bridge`. Yang tidak boleh berubah: `DownloadManager`, status/progres, seeding, pilih file, resume, pengaturan torrent (`src/main/services/torrent-service.ts` → `TorrentClient` → `NativeAddon.torrentInitialize/torrentRequest/torrentShutdown`).
- Path `.node` dan resource diteruskan Rust ke sidecar (env `SPHINX_RESOURCES_DIR`); mode dev tetap seperti Hydra. Pemanggil API Electron di kode ini diganti hanya lewat shim.
- Verifikasi dependensi `.node`/prebuilt (mis. perlu VC++ runtime tambahan atau tidak) di mesin bersih.
- Crate `hydra-native` dan folder `torrent-bridge` **tidak di-rename**.

**Kriteria penerimaan torrent (setara baseline):**
- Magnet dan `.torrent` mulai mengunduh ke folder pilihan; progres, kecepatan, peer/seed sama.
- Jeda, lanjut, batal, hapus dengan/tanpa file; pilih sebagian file.
- Restart app dan kill sidecar: unduhan lanjut tanpa duplikasi/korupsi (hash recheck boleh).
- **Engine tunggal**; berhenti saat app keluar; tidak ada proses yatim.
- Berjalan dari installer di mesin bersih **tanpa Python**.

> Jalur masa depan (tidak dikerjakan): bridge C++ tidak disentuh; wrapper N-API bisa ditulis ulang sebagai command Rust Tauri bila sidecar dipensiunkan.

### 4.D Branding

#### 4.D.1 Logo memakai skill `logo-design`
Agent membuat logo sendiri dengan skill `logo-design` (jika skill tidak ditemukan: berhenti dan lapor). Alur skill: brief → riset konvensi → konsep → audit → **checkpoint** (berhenti, tunggu pilihan pengguna) → kit.

Brief:
- **Merek**: Sphinx Launcher, aplikasi desktop open-source untuk mengelola library game dan mengunduh game.
- **Karakter**: misterius, percaya diri, modern, presisi ("penjaga teka-teki", bukan gurun/piramida).
- **Jenis tanda**: simbol pictorial/abstrak yang mengacu ke sphinx (siluet kepala/profil, pose duduk, bentuk teka-teki) + wordmark "Sphinx"; terbaca di 16 px.
- **Hindari**: piramida, mata Horus, kepala firaun generik, gamepad, tombol play, joystick, kucing generik, gradien rumit.
- **Pembeda**: tidak mirip logo Hydra maupun launcher lain (Steam, Epic, GOG, Heroic, Lutris); jalankan uji "shelf test" dan uji rekan skill.
- **Warna**: nuansa gelap; bagus di latar gelap, ada versi satu warna dan terbalik; kontras minimal 3:1.
- Logo di `assets/library` skill hanya referensi: **dilarang disalin**.

Aturan: 8–12 ide → 3 konsep SVG → `svg_audit.py`, `concept_sheet.py`, `preview_sheet.py` → **berhenti di checkpoint** → setelah dipilih: SVG master, satu warna, terbalik, PNG 1024, `export_variants.py --web-icons`, lalu `yarn tauri icon`. Jika model tidak bisa melihat gambar, jangan mengaku sudah memeriksa visual; pengguna menilai di checkpoint. Simpan di `branding/` + `branding/README.md` (proses, skill, pernyataan tidak menyalin referensi, dibuat oleh agen AI).

#### 4.D.2 Penggantian aset dan nama
- Aset: `resources/icon.png`, tray, splash/loading, favicon, komponen logo UI, gambar installer, logo README.
- Teks tampilan dan **semua locale i18n**: "Hydra" → "Sphinx" pada string terlihat (sesuaikan tata bahasa); "Hydra Cloud" → "Cloud Save (Google Drive)".
- Identitas teknis: `name`/`productName`/`description`/`author`, nama executable/installer, `appId`, folder data, kunci registri/shortcut, protokol `sphinx://`.
- **Jangan** rename folder/crate `hydra-native` dan `torrent-bridge`; daftarkan di `docs/branding-allowlist.md` beserta sisa `grep -ri hydra` yang sah (atribusi, URL layanan, nama paket pihak ketiga).
- URL layanan eksternal tidak diubah selain dijadikan konfigurabel via `.env`.

### 4.E Updater dan rilis

- **Repo dan baseline**: Fase 0 meng-clone `hydralauncher/hydra` dengan riwayat lengkap lalu push ke `Raka-Mahendra/sphinx` (bukan GitHub fork); fallback `git init` + commit baseline bertag `baseline-hydra`. Bandingkan direktori kerja saat ini dengan clone; selisih dicatat sebagai perubahan lokal.
- **Electron updater dinonaktifkan sejak Fase 1** (`electron-builder.yml` `publish` dan `autoUpdater.setFeedURL` di `src/main/index.ts` masih menunjuk `hydralauncher/hydra`).
- `tauri-plugin-updater`: `bundle.createUpdaterArtifacts: true`, `pubkey`, endpoint `https://github.com/Raka-Mahendra/sphinx/releases/latest/download/latest.json`. Tauri memvalidasi seluruh `latest.json` sebelum cek versi, jadi tiap entri platform harus lengkap dan valid.
- **Dua jenis kunci berbeda**: minisign updater (`TAURI_SIGNING_PRIVATE_KEY`, dibuat dengan `tauri signer generate`, secret Actions + cadangan offline, **tidak di repo**) vs Authenticode Windows (tidak dipakai di v1). Penyimpanan dan cadangan terpisah.
- **Workflow `release.yml`**: hanya di repo ini, hanya tag `v*`, `contents: write` hanya di job rilis, tanpa secret untuk PR dari fork. **Draft release**: semua platform dibangun dulu, satu job akhir mem-publish, sehingga tidak ada rilis parsial yang terlihat sebagai "latest" (verifikasi opsi `tauri-action`). `latest.json` awalnya hanya Windows; Linux menyusul di Fase 9.
- **Versi**: satu sumber; skrip `bump-version` menyelaraskan `package.json`, `Cargo.toml`, `tauri.conf.json` dari tag; tes CI gagal bila ketiganya ≠ tag. Numerik murni tanpa akhiran pra-rilis (verifikasi batasan format versi MSI/WiX sebelum memakai `-beta`). Tag `vX.Y.Z`; rilis publik pertama **v0.1.0**. Rilis uji `v0.0.1`/`v0.0.2` hanya di repo uji terpisah atau draft/pra-rilis yang dihapus sesudahnya.
- **UX dua tahap dipertahankan**: Rust pemilik state; `src/main/services/update-manager.ts` menjadi klien RPC tipis (`update_check`, `update_download`, `update_install`) yang membentuk ulang payload `autoUpdaterEvent` persis seperti baseline (`update-available`, `update-downloaded`). Di Windows app otomatis keluar saat langkah install; `on_before_exit` menjalankan shutdown bertahap sidecar (yang memuat torrent) dan menutup legendary bila berjalan. Installer tidak boleh gagal karena `node.exe`/`hydra-native.node` terkunci.
- **Installer**: target **NSIS saja** (MSI tidak dikirim, setelah verifikasi dokumentasi), opsi disamakan dengan `electron-builder.yml` (per-user/per-machine, oneClick, pilih direktori), `installMode: passive`. Portable tidak didukung; logika `PORTABLE_EXECUTABLE_FILE` dinonaktifkan.
- **Tanpa tanda tangan Authenticode di v1** (setara baseline). Mitigasi: `SHA256SUMS` dilampirkan di Release; README menjelaskan SmartScreen ("More info → Run anyway"), bahwa tiap rilis baru bisa memicunya lagi, dan instalasi hanya dari halaman Releases resmi; langkah signing opsional di workflow aktif hanya bila secret sertifikat ada (verifikasi `signCommand` Windows Tauri).
- **Gerbang keputusan**: bila uji di Windows 10/11 bersih menunjukkan installer atau update mandiri **diblokir total** (bukan sekadar peringatan, termasuk Smart App Control), signing menjadi prasyarat rilis publik.

### 4.F Cloud save Google Drive

#### 4.F.1 Perilaku
- Settings (di tempat Hydra Cloud berada): **Hubungkan / Putuskan Google Drive**. Halaman game memakai ulang UI backup/cloud save yang ada: unggah, daftar versi, pulihkan, hapus versi. Pengaturan backup otomatis dan cek versi cloud saat game dibuka mengikuti yang sudah ada di Hydra.
- **Pipeline v2 dipakai ulang** (`cloud_save/{hashing,local_snapshot,manifest,restore,upload}`, `upload-local-game-snapshot.ts`, `create-remote-snapshot-from-local-state.ts`): hashing native, snapshot lokal, manifest, restore, `SnapshotVariant`, `baseVersion`. `GoogleDriveProvider` **hanya mengganti tujuan upload/restore** (sebelumnya presigned URL ke Hydra API). Jalur legacy `SubscriptionRequiredError` dihapus.

#### 4.F.2 OAuth dan scope
- Scope tunggal: **`https://www.googleapis.com/auth/drive.appdata`**. Dilarang menambah scope tanpa persetujuan pemilik proyek. Terverifikasi: `about.get` menerima `drive.appdata`, jadi nama/email dan `storageQuota` tidak butuh scope tambahan (ketersediaan field diverifikasi runtime).
- Authorization Code + **PKCE (S256)** + redirect **loopback** `http://127.0.0.1:<port acak>/callback`, `state`, `access_type=offline`, di **browser sistem**. Server loopback hanya hidup selama login.
- Refresh token di **keychain OS** lewat command Rust (crate `keyring`) yang dipanggil sidecar via RPC; tidak pernah di file biasa/log. Tanpa keychain: token hanya di memori dan pengguna diberi tahu di UI.
- Putuskan: revoke di `https://oauth2.googleapis.com/revoke`, hapus entri keychain, tawarkan hapus data cloud (konfirmasi). `invalid_grant` → status terputus + ajakan hubungkan ulang.
- **Satu client resmi ditanam saat build.** Client ID **tidak boleh berganti** setelah rilis publik (`appDataFolder` terikat client ID); proyek Google Cloud dibuat sekali sebagai proyek tetap. Client ID/secret diinjeksi lewat secret GitHub Actions, tidak pernah di repo. Build lokal tanpa kredensial tetap jalan: tombol nonaktif + pesan "Google Drive belum dikonfigurasi di build ini". Fork menimpa lewat env build `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`, tanpa UI. Client secret desktop di binary diterima sebagai risiko wajar.
- `docs/google-drive-setup.md`: proyek Google Cloud, Drive API, consent screen External, scope `drive.appdata`, client tipe **Desktop app**, terbitkan ke **Production** (status Testing membuat refresh token kedaluwarsa 7 hari), hasil verifikasi dokumentasi Google (brand verification, batas pengguna, layar "unverified app", kewajiban privacy policy/homepage) dan angka kuota Drive API dari konsol.

#### 4.F.3 Model penyimpanan di Drive
- **Blob content-addressed**: satu file per hash unik, `<gameKey>/<hash>`. **Manifest immutable** per versi snapshot: `<gameKey>/snapshots/<version>.json` (files, variants, parent). **Tanpa `index.json` mutable.**
- `appProperties` sebagai indeks cepat: `app=sphinx`, `schema=1`, `gameKey`, `hash`/`version`/`parent`, `deviceId` (UUID acak per instalasi), `createdAt`. Batas ukuran `appProperties` diverifikasi ke dokumentasi.
- `gameKey` **generik** terhadap nilai `shop` (tanpa daftar toko hardcoded); enum `shop` dipertahankan.
- **Commit**: daftar manifest → cek head == `baseVersion` → unggah blob yang belum ada → buat manifest `version+1` dengan `parent=baseVersion` → daftar ulang untuk mendeteksi manifest kembar dengan versi sama (→ konflik, dialog 4.F.5). Jika `aggregateHash` == head → lewati commit.
- **Wajib dibuktikan**: apakah `ETag`/`If-Match` benar-benar didukung `files.update` sebelum bergantung padanya.
- **GC mark-and-sweep**: hapus blob hanya jika tidak dirujuk manifest mana pun **dan** lebih tua dari masa tenggang (usul 24 jam); dijalankan hanya setelah retensi memangkas manifest. Retensi menghitung **versi**, bukan blob (default 3 per game, rentang 1–10).

#### 4.F.4 Hemat kuota
- Dedupe per hash; unggah hanya blob baru.
- Ambang konfirmasi ukuran (default 100 MB, dapat diatur) dihitung dari **byte baru setelah dedupe**.
- Konkurensi unggah 3–4 (bukan 8 seperti baseline) dengan backoff adaptif (verifikasi batas laju tulis Drive); backoff eksponensial + jitter untuk 429, 403 `rateLimitExceeded`, dan 5xx; pesan jelas untuk `storageQuotaExceeded`.
- Selalu `fields` parsial, `pageSize` besar, filter `appProperties`; cache daftar (TTL ±5 menit) dan invalidasi setelah unggah/hapus; **tanpa polling** (sinkron hanya saat aksi manual, game ditutup bila diaktifkan, atau halaman game dibuka).
- Kuota API Drive dibagi seluruh pengguna per proyek; aturan di atas berlaku lebih ketat karenanya.
- Tampilkan pemakaian cloud save (blob yang masih dirujuk) dan sisa kuota Drive (`about.get`).

#### 4.F.5 Konflik
Simpan hash sinkron terakhir per game. Bila cloud lebih baru **dan** save lokal berubah sejak sinkron terakhir (atau ditemukan manifest kembar) → dialog: pakai cloud / pakai lokal / simpan keduanya (backup lokal dibuat dulu). Pakai dialog Hydra yang ada bila tersedia.

#### 4.F.6 Kriteria penerimaan
- Login Google di browser sistem; URL otorisasi hanya berisi scope `drive.appdata`.
- Unggah, daftar, pulihkan, hapus versi bekerja; blob identik tidak diunggah ulang; retensi dan GC bekerja aman; varian (RetroArch) tetap utuh.
- File tidak tampak di Drive biasa, hanya di data aplikasi.
- Putuskan: token dicabut dan entri keychain hilang. Tidak ada token di log atau berkas biasa (`grep`).
- Tes otomatis terhadap mock Drive (multipart/resumable, 401→refresh, 429 backoff, pruning, dedupe, GC, manifest kembar) dan untuk PKCE/loopback.

### 4.G Lisensi
- **Langkah pertama**: salin `LICENSE` MIT asli ke `LICENSES/MIT-hydra.txt` (verbatim, hak cipta asli Hydra) sebelum menggantinya.
- `LICENSE` baru = Apache License 2.0, `Copyright 2026 Raka Mahendra`.
- `NOTICE` dan README: nama + tahun, atribusi Hydra Launcher (MIT), pernyataan fork independen/tidak berafiliasi.
- `package.json` `license: "Apache-2.0"`, `Cargo.toml` `license = "Apache-2.0"`, `bundle.copyright`/`licenseFile`. Header `SPDX-License-Identifier: Apache-2.0` hanya untuk file **baru**; file turunan Hydra tidak diubah.
- `THIRD_PARTY_NOTICES.md`: libtorrent (BSD-3), Tauri, Node.js, ludusavi, dependensi utama beserta lisensi dan versi. Python/PyInstaller tidak ada di daftar.
- Catatan: panduan teknis, bukan nasihat hukum.

### 4.H Hubungan dengan upstream (beku)
- `baseline-hydra` adalah titik akhir sinkronisasi. Tanpa merge berkala; cherry-pick selektif (`git cherry-pick -x`) dicatat di `docs/upstream-policy.md`.
- **Ambil**: keamanan, crash, kompatibilitas API dan format data, perbaikan modul yang tidak kita ubah (`hydra-native`, `torrent-bridge`, unduhan). **Tolak**: fitur yang dimatikan flag; perubahan Electron/updater/Sentry/login.
- Agar cherry-pick tetap mungkin: tanpa formatter massal, tanpa rename/pindah file besar, kode baru di file baru, perubahan file upstream minimal, commit per topik.
- Pantau rilis upstream (changelog/Releases), terutama perubahan API backend Hydra yang bisa memutus katalog, aset game, dan download sources.

## 5. Fase kerja dan gerbang

Fase selesai hanya jika acceptance criteria terbukti lewat perintah/hasil nyata dan dicatat di `docs/MIGRATION_LOG.md`.

| Fase | Isi | Acceptance criteria |
|---|---|---|
| 0 | Clone penuh → push ke `Raka-Mahendra/sphinx`; tag `baseline-hydra`; diff terhadap direktori kerja; audit lengkap; klasifikasi `needsAuth` + verifikasi runtime jalur anonim; verifikasi `hydra-native`/`sharp`/`classic-level` di Node; catat perilaku baseline (app ditutup/crash saat game berjalan; opsi NSIS) | Build Electron asli sukses; semua dokumen audit terisi (ipc-inventory, electron-api-usage, torrent-audit, account-dependent-features, cloud-save-audit, network-calls, epic-audit, baseline-behavior) |
| 1 | Di atas Electron: hapus login/Sentry/workwonders; feature flag JSON + sembunyikan fitur (UI, service, handler); nonaktifkan updater Electron; lisensi Apache-2.0 + NOTICE | App jalan sebagai pengguna anonim tanpa layar login; nol request telemetry/workwonders/endpoint flag; tes per-flag lulus; `LICENSE`, `NOTICE`, `LICENSES/MIT-hydra.txt` benar |
| 2 | Branding: nama, i18n, identitas, **logo lewat skill** (berhenti di checkpoint); generator allowlist dari source (sadar flag) + tes paritas | Logo disetujui; app Electron bernama dan berlogo Sphinx; allowlist `grep hydra`; generator menghasilkan daftar dan tes gagal bila ada kanal baru |
| 3 | Kerangka Tauri: `src-tauri`, Vite renderer + big-picture, jendela utama | `yarn tauri dev` menampilkan UI |
| 4 | Sidecar + shim electron (preload dipakai ulang) + bridge + allowlist (Rust + sidecar) + 4 tes crash | Semua kanal terdaftar; library, katalog, pengaturan, Big Picture bekerja seperti baseline; tes crash lulus: kill sidecar saat game berjalan (game hidup, playtime lanjut), saat unduhan (lanjut tanpa duplikasi), kill paksa lalu LevelDB terbuka lagi, sidecar menggantung terdeteksi dan di-restart |
| 5 | Fitur platform; updater Tauri + workflow draft-release; uji Windows 10 & 11 bersih | Checklist platform lulus; update `v0.0.1`→`v0.0.2` (repo uji) sukses tanpa file terkunci dan tanpa proses tersisa; SmartScreen (unduhan browser vs update mandiri), Smart App Control, dan Defender dicatat terpisah; `SHA256SUMS` benar |
| 6 | Torrent native di Tauri: path resource, spawn/shutdown, engine tunggal, tanpa Python | Acceptance 4.C lulus di mesin bersih; nol proses sisa |
| 7 | Cloud save Google Drive | Acceptance 4.F.6 lulus |
| 8 | Pembersihan dan paket: hapus Electron, `yarn tauri build`, dokumen; ukur installer dan RAM idle | Installer terbentuk; `grep` electron/sentry/analytics bersih (Node diizinkan); tidak ada Python/legendary/`.pyz`/`hydra-epic-process.exe` di installer; DoD terpenuhi |
| 9 | (Opsional, hanya jika diminta) Linux | `.deb`/`.AppImage` jalan; `latest.json` menyusul |

## 6. Pengujian

### 6.1 Checklist manual (Windows 10 dan 11 bersih)
- **Platform**: start, kontrol jendela custom, tray, single instance, deep link `sphinx://run`, autostart, notifikasi, ikon/nama di Taskbar/Start Menu/Add-Remove Programs.
- **Fitur inti** (bandingkan dengan baseline Electron): library, tambah game, katalog dan pencarian, halaman game, unduhan, pengaturan, ganti bahasa, tema, Big Picture. Tidak ada layar/tombol login dan fitur yang dipangkas.
- **Torrent**: seluruh daftar 4.C dari installer di mesin bersih. **Cloud save**: 4.F.6. **Update**: 4.E.
- **Jaringan**: pantau lalu lintas keluar saat idle; hanya yang tercantum di `docs/network-calls.md`.
- **Stabilitas**: skenario crash/restart 4.A.4; tutup app → tidak ada proses `node` tersisa.
- **Distribusi**: SmartScreen, Smart App Control, Defender (false positive untuk paket berisi `node.exe`, addon native, engine torrent).

### 6.2 Otomatis
- Pertahankan `yarn test`, `typecheck`, `lint`, `format-check`; jalankan typecheck/lint untuk flag `true` **dan** `false`.
- Tambah: generator allowlist vs source; protokol RPC + allowlist (Rust dan sidecar); spawn/shutdown engine native dan resolusi path resource; empat skenario crash; per-flag (handler/service tidak aktif, kanal tidak di allowlist, UI tidak dirender di renderer dan big-picture, nol request jaringan); `GoogleDriveProvider` (mock Drive); PKCE/loopback; konsistensi versi tiga berkas vs tag.

## 7. Risiko dan mitigasi

| ID | Risiko | Mitigasi |
|---|---|---|
| R1 | Perbedaan WebView2/WebKitGTK vs Chromium | Uji komponen berat; perbaikan tertarget |
| R2 | `<webview>`, modifikasi header, CORS longgar bergantung Electron | Inventaris Fase 0; iframe/jendela anak, proxy sidecar, `tauri-plugin-http` |
| R3 | Shim `electron` tidak lengkap; tanpa isolated world | `NotImplementedInShim`; allowlist Rust |
| R4 | Tanpa login, jalur `needsAuth:false` ternyata menolak anonim | Verifikasi runtime; catat, jangan paksa |
| R5 | API backend Hydra berubah/dibatasi memutus katalog/aset/download sources | Endpoint konfigurabel; pantau upstream; pesan error jelas |
| R6 | Loader `.node`, path resource bridge, atau dua engine torrent | Fase 6; env resource dari Rust; supervisor menunggu proses lama mati |
| R7 | Installer unsigned: SmartScreen/Smart App Control/Defender | Uji Fase 5; SHA256SUMS; gerbang keputusan signing |
| R8 | Modul native non-N-API (mis. `classic-level`) bermasalah di Node bundel | Verifikasi Fase 0; versi Node dipin |
| R9 | Kebocoran flag (fitur mati tetap jalan lewat kanal lain) | Allowlist dari flag + tes per-flag |
| R10 | OAuth berstatus Testing (token 7 hari) atau consent screen belum siap | `docs/google-drive-setup.md`; Production |
| R11 | Client secret terbaca dari binary | Wajar untuk desktop; PKCE; scope `drive.appdata` saja |
| R12 | Kunci minisign hilang/bocor | Secret Actions + cadangan offline; dokumentasi rotasi |
| R13 | Semantik konkurensi Drive (ETag belum terbukti), batas laju | Manifest immutable; konkurensi rendah; bukti dokumentasi |
| R14 | Model flash tidak bisa menilai logo secara visual | Audit/preview skill; pengguna menilai di checkpoint |
| R15 | Kuota Drive pengguna penuh | Pesan jelas; retensi kecil; dedupe |
| R16 | Kehilangan state saat sidecar crash | Recovery scan; celah playtime didokumentasikan |
| R17 | File terkunci saat update atau game ikut mati | Shutdown bertahap; tes mesin bersih; job object terbukti |
| R18 | Kewajiban lisensi dependensi | Bagian 4.G |

## 8. Definition of Done
1. `yarn tauri build` menghasilkan installer NSIS Windows yang terpasang dan berjalan; ukuran installer dan RAM idle terukur dan dicatat.
2. Checklist 6.1 lulus; tidak ada regresi dibanding baseline kecuali yang tercatat sebagai batasan di §2.
3. Acceptance 4.C (torrent), 4.E (update), 4.F.6 (cloud save) lulus.
4. Tidak ada Electron, Sentry, analytics, `workwonders-sdk`, atau login Hydra tersisa (**Node diizinkan**); tidak ada nama/logo Hydra terlihat kecuali atribusi.
5. Logo sphinx hasil skill terpasang di seluruh aset dan disetujui.
6. Engine torrent native berjalan dari installer di mesin bersih tanpa Python; tidak ada Python/legendary/`.pyz`/`hydra-epic-process.exe` di installer.
7. `latest.json` + `SHA256SUMS` benar; versi tiga berkas = tag.
8. Dokumen tersedia: `LICENSE` (Apache-2.0), `NOTICE`, `LICENSES/MIT-hydra.txt`, `THIRD_PARTY_NOTICES.md`, README, `docs/` (MIGRATION_LOG, feature-flags, upstream-policy, google-drive-setup, release, network-calls, branding-allowlist, ipc-inventory dan allowlist ter-generate).
9. Tidak ada uji Epic. Semua butir wajib-dibuktikan (§10) tercatat hasilnya.
10. Semua perubahan di branch dengan conventional commits yang rapi.

## 9. Keputusan default dan butir kecil

| Hal | Keputusan |
|---|---|
| Platform | Windows dulu; Linux opsional Fase 9 |
| Repo | `Raka-Mahendra/sphinx` publik; bukan fork; upstream beku |
| Versi | 0.1.0 (numerik murni) |
| Hak cipta | 2026 Raka Mahendra (Apache-2.0) |
| Feature flag | JSON build-time, satu sumber |
| Installer | NSIS saja, tanpa portable, unsigned v1 |
| Folder data | `sphinx-launcher`; tanpa migrasi dari Hydra |
| `crashReporter` | Dibiarkan di Fase 1 (tidak mengirim apa pun) dan hilang bersama Electron; pengganti: log lokal (sidecar menulis uncaught exception ke file log; Rust menulis panic ke log). Minidump bisa jadi backlog |
| Ledger LevelDB `HYDRA_CLOUD_LEGACY` | Dibiarkan (data pengguna tidak dihapus); sidecar tidak menjalankan kode legacy-nya |
| Retensi cloud save | 3 versi/game (1–10); GC masa tenggang 24 jam; konfirmasi ukuran 100 MB |
| Bundle id | `com.sphinxlauncher.app` |

## 10. Butir wajib dibuktikan (bukan diasumsikan)

**Tauri**
1. Capability + command kustom: hanya jendela berizin; iframe/konten remote tidak bisa `invoke`; `remote.urls` minimal.
2. `on_before_exit`; `download()`/`install()` terpisah; perilaku Windows saat install.
3. Opsi `tauri-action` untuk draft → publish; validasi `latest.json` seluruh platform.
4. Opsi NSIS (per-user/per-machine, oneClick), `installMode`, target bundle, batasan format versi MSI/WiX, `signCommand`.
5. Modul native di Node bundel: `hydra-native`, `sharp`, `classic-level`.

**Windows**
6. Job object/detached spawn: game selamat dari crash sidecar, update, dan penutupan app; perilaku plugin shell Tauri saat app keluar.
7. Perilaku baseline Electron saat app ditutup/crash dengan game berjalan + cara `watchProcesses()` memulihkan playtime (target = setara).
8. SmartScreen (unduhan browser vs update mandiri) dan Smart App Control di Windows 11.
9. False positive Defender untuk paket berisi `node.exe`, addon native, engine torrent.

**Drive / Google**
10. `ETag`/`If-Match` pada `files.update`.
11. Batas ukuran `appProperties`.
12. Batas laju tulis dan konkurensi aman.
13. Ketersediaan field `about.get` (email/nama) dengan `drive.appdata`.
14. Brand verification / batas pengguna / layar unverified / privacy policy untuk scope non-sensitif di Production.
15. Angka kuota Drive API dari konsol.

**Baseline dan kode**
16. Klaim `needsAuth:false` terhadap API nyata.
17. `hydra-epic-process.exe`, `windows-epic-process`, `managed-legendary.pyz`, `prepare-legendary.cjs` khusus Epic (jangan buang yang dipakai bersama).
18. Python hanya dipakai legendary (sebelum dihapus dari CI).
19. Apakah ludusavi mengunduh manifest dari internet.

**Rilis**
20. Kunci minisign: cadangan offline, penyimpanan terpisah dari Authenticode; pemegang kunci = pemilik repo.
21. Celah playtime saat crash terdokumentasi dan diterima.

## 11. Backlog pasca-migrasi
1. **Achievement Lokal**: sumber definisi (Steam Web API / file lokal / lain) dan mekanisme deteksi unlock saat ini.
2. **Epic Lokal**: autentikasi legendary tanpa server Hydra, lokasi penyimpanan status koneksi, apakah Python tetap dibundel.
3. **Pensiun sidecar**: torrent ke Rust memakai C++ bridge yang sama (wrapper N-API → command Rust).
4. **Authenticode signing**: prasyarat bila Fase 5 menunjukkan blokir total.
5. **Linux**: Fase 9; `latest.json` menyusul.
6. Minidump/crash log lokal untuk Rust dan sidecar.
