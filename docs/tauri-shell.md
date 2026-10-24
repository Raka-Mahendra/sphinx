# Fase 3 — Shell Tauri v2 (PRD §4.A.1, §4.A.5)

Dibuat: 24 Oktober 2026. Dokumen ini mencatat apa yang ada, dari mana setiap keputusan API diambil,
dan apa yang masih terbuka.

## 1. Yang ditambahkan

| Jalur                                          | Isi                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/Cargo.toml`                         | Crate `sphinx-launcher` 0.1.0, `tauri` v2, `tauri-build` v2                                                                |
| `src-tauri/build.rs`                           | `tauri_build::build()` standar                                                                                             |
| `src-tauri/src/main.rs`                        | Entrypoint biner + `windows_subsystem = "windows"` untuk rilis                                                             |
| `src-tauri/src/lib.rs`                         | Builder, hook page-load, pembuat jendela Big Picture                                                                       |
| `src-tauri/tauri.conf.json`                    | `productName` "Sphinx Launcher", identifier `com.sphinxlauncher.app`, versi 0.1.0                                          |
| `src-tauri/capabilities/default.json`          | Capability minimal (`core:default`, hanya jendela `main`)                                                                  |
| `src-tauri/icons/`                             | Hasil `yarn tauri icon branding/png/sphinx-app-icon-1024.png` (desktop saja; `android/` dan `ios/` dari generator dihapus) |
| `vite.config.ts`                               | Aplikasi Vite biasa untuk renderer (port 5173)                                                                             |
| `vite.config.big-picture.ts`                   | Aplikasi Vite terpisah untuk Big Picture (port 5174)                                                                       |
| `src/renderer/src/tauri-placeholder-bridge.ts` | Stub `window.electron` sementara (lihat §4)                                                                                |

`package.json`: `dev` → `tauri dev`, `build` → `tauri build`, plus `dev:renderer`, `build:renderer`,
`dev:big-picture`, `build:big-picture`. Skrip Electron **tidak dihapus** — dipindah ke `electron:dev`,
`electron:start`, `electron:build`, `electron:build:win|mac|linux` (dipensiunkan di Fase 8).

Kode Electron (`src/main`, `src/preload`, `electron.vite.config.ts`, `electron-builder.yml`) tidak disentuh.

## 2. Jendela: pemetaan Electron → Tauri

Sumber perilaku: `docs/baseline-behavior.md` §2–3 dan `src/main/services/window-manager.ts:100-142`.

| Electron (baseline)                       | Tauri v2                                                              | Catatan                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `width: 1200, height: 860`                | `width: 1200, height: 860`                                            | persis                                                                                                   |
| `minWidth: 1024, minHeight: 600`          | `minWidth: 1024, minHeight: 600`                                      | persis                                                                                                   |
| `show: false` + tampil di `ready-to-show` | `visible: false` + `show()` di `on_page_load(Finished)`               | Tauri tidak punya `ready-to-show`; hook page-load adalah padanan terdokumentasi                          |
| `backgroundColor: "#1c1c1c"`              | `backgroundColor: "#1c1c1c"`                                          | persis                                                                                                   |
| `titleBarStyle: "hidden"` + overlay 34 px | `decorations: false` + `titleBarStyle: "Overlay"`                     | lihat §5.1 — ada jurang fungsi                                                                           |
| `sandbox: false`                          | tidak ada padanan                                                     | WebView Tauri selalu terisolasi dari host; ini perbedaan yang menguntungkan, didokumentasikan            |
| Big Picture: fullscreen, frameless        | `WebviewWindowBuilder` di Rust: `fullscreen(true).decorations(false)` | `window-manager.ts:502-515`; jendela dibuat on-demand, label `big-picture`, URL `big-picture/index.html` |

## 3. Sumber (source-driven)

Setiap API Tauri v2 yang dipakai diverifikasi ke dokumentasi resmi, bukan dari ingatan:

| API/keputusan                                                                            | Sumber                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Skema `tauri.conf.json` v2 (top-level, `build`, `app.security`, `app.windows`)           | https://v2.tauri.app/reference/config/                                                                                                                                                                                         |
| `build.devUrl` / `frontendDist` / `beforeDevCommand` dan contoh config Vite              | https://v2.tauri.app/start/frontend/vite/#example-configuration                                                                                                                                                                |
| `WindowConfig` (nama field, tipe, `backgroundColor`, `dragDropEnabled`)                  | https://docs.rs/tauri-utils/latest/tauri_utils/config/struct.WindowConfig.html                                                                                                                                                 |
| `TitleBarStyle` (`Visible`/`Transparent`/`Overlay`, terdokumentasi macOS)                | https://docs.rs/tauri-utils/latest/tauri_utils/enum.TitleBarStyle.html                                                                                                                                                         |
| `Builder::on_page_load`, `PageLoadPayload::event()`, `PageLoadEvent::{Started,Finished}` | https://docs.rs/tauri/latest/tauri/struct.Builder.html , https://docs.rs/tauri/latest/tauri/webview/struct.PageLoadPayload.html , https://docs.rs/tauri/latest/tauri/webview/enum.PageLoadEvent.html                           |
| `Webview::window()`, `Manager` untuk webview                                             | https://docs.rs/tauri/latest/tauri/webview/struct.Webview.html                                                                                                                                                                 |
| `build.target` (`chrome105` Windows / `safari15` non-Windows)                            | pola dari https://v2.tauri.app/start/frontend/vite/ ; nilai non-Windows dinaikkan ke `safari15` karena entry renderer memakai _top-level await_ (butuh Chrome 89+/Safari 15+) — `safari13` bawaan panduan akan ditolak esbuild |
| Capability minimal (`core:default`)                                                      | https://v2.tauri.app/learn/window-customization/#permissions dan https://v2.tauri.app/security/capabilities/                                                                                                                   |

## 4. Placeholder `window.electron` (sementara)

Renderer memanggil `globalThis.electron.*` sejak baris pertama bootstrap (`main.tsx`:
`await globalThis.electron.isStaging()`). Tanpa preload, itu `undefined` dan UI langsung mati.

`tauri-placeholder-bridge.ts` dipasang sebagai import pertama `main.tsx` dan hanya aktif kalau
`globalThis.electron` belum ada (jadi no-op di Electron). Ia mengembalikan nilai kosong untuk semua
kanal dan mencatat setiap kanal yang dipanggil — log itu jadi masukan allowlist Fase 4.

**Sudah dihapus di Fase 4.** Penggantinya `src/tauri-bridge/`, yang memasang `src/preload/index.ts`
apa adanya dan meneruskan `invoke`/`send`/`on` ke shell. Lihat `docs/sidecar.md` §3.

## 5. Jurang yang diketahui

1. **Window Controls Overlay.** Electron memakai `titleBarOverlay` (tombol min/max/close native
   digambar di atas konten web, tinggi 34 px, warna kustom). `TitleBarStyle::Overlay` Tauri
   terdokumentasi untuk macOS; di Windows kita memakai `decorations: false`, artinya tombol jendela
   harus digambar UI sendiri. Header UI sudah punya `-webkit-app-region: drag` untuk menyeret;
   tombol kontrol jendela ditambahkan di Fase 6 (jendela).
2. **Drag-and-drop.** `dragDropEnabled: false` dipakai karena renderer memakai HTML5 drag-and-drop
   (`@atlaskit/pragmatic-drag-and-drop`) yang rusak di WebView2 kalau handler drag Tauri aktif
   (terdokumentasi di `WindowConfig::drag_drop_enabled`). Konsekuensinya drop file OS dari Explorer
   tidak sampai ke UI — perlu penanganan khusus di fase berikutnya bila baseline memang memakainya.
3. **CSP.** Sementara mengikuti kebutuhan UI yang ada (gambar/media dari `https:`, inline style,
   eval untuk dev). Tightening menyusul Fase 4/5 bersama allowlist IPC.
4. **`tauri-build` dan lockfile.** `Cargo.lock` sekarang ada dan ikut di-commit: crate sudah
   benar-benar dibangun (lihat catatan lingkungan di §7).

### Perbedaan perilaku yang teramati di Fase 4

Diukur di `yarn tauri dev`, dibandingkan dengan `docs/baseline-behavior.md`:

| Hal                                            | Baseline (Electron)                                                       | Sphinx (Tauri)                                 | Dampak                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Isolated world                                 | `contextBridge` menyembunyikan `electron` dari halaman                    | `window.electron` adalah properti global biasa | Halaman bisa menimpanya; batas pindah ke allowlist Rust + CSP                                  |
| Muat renderer dari remote                      | `MAIN_VITE_LAUNCHER_SUBDOMAIN` memuat `https://release-v<versi>.<domain>` | dihapus; selalu bundel sendiri                 | Tidak ada eksekusi kode dari konfigurasi                                                       |
| `setOpacity`, `setFocusable`, `setProgressBar` | bekerja                                                                   | `not_implemented`                              | Main window tidak diredupkan saat Big Picture terbuka; progres unduhan tidak muncul di taskbar |
| `ready-to-show`                                | dari renderer                                                             | dari `PageLoadEvent::Finished` di Rust         | Setara; jendela tampil setelah halaman pertama selesai                                         |
| Boot pertama setelah cache Vite dihapus        | ~10 dtk                                                                   | ~2 menit di mesin ini                          | Hanya soal dev (optimasi dependensi Vite), bukan runtime                                       |

## 6. Prasyarat alat (mesin pengembang)

- Rust (rustup) + **MSVC Build Tools** (linker) — resmi disyaratkan Tauri di Windows:
  https://v2.tauri.app/start/prerequisites/
- WebView2 Runtime (sudah ada di Windows 10/11).
- `yarn` (corepack) untuk skrip `beforeDevCommand`.

Catatan lingkungan: sesi agen ini tidak punya hak elevasi UAC, jadi MSVC Build Tools tidak bisa
dipasang lewat winget (installer membatalkan diri, exit 1602). Verifikasi runtime di mesin ini
dilakukan dengan toolchain GNU portable; hasil dan batasannya dicatat di §7.

## 7. Verifikasi

Semua perintah di bawah dijalankan pada 24 Oktober 2026. Bukti lengkap (daftar pesan konsol) ada di
`docs/evidence/fase3-tauri-dev-console.json` dan screenshot di `docs/evidence/fase3-tauri-dev-ui.png`.

| Klaim                                 | Perintah                                                         | Hasil                                                                                                                                   |
| ------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer build dengan Vite biasa      | `npx vite build --config vite.config.ts`                         | `built` (35,7 s) → `out/renderer`                                                                                                       |
| Big Picture build dengan Vite biasa   | `npx vite build --config vite.config.big-picture.ts`             | `built` (28,1 s) → `out/big-picture`                                                                                                    |
| Ikon dari master                      | `yarn tauri icon branding/png/sphinx-app-icon-1024.png`          | 17 berkas desktop di `src-tauri/icons/` (`icon.ico`, `icon.icns` termasuk)                                                              |
| Typecheck                             | `npx tsc --noEmit -p tsconfig.node.json` dan `tsconfig.web.json` | bersih, keduanya                                                                                                                        |
| Format                                | `npx prettier --check` pada berkas yang disentuh                 | bersih                                                                                                                                  |
| Rust shell compile + `yarn tauri dev` | `yarn tauri dev`                                                 | lihat catatan lingkungan di bawah                                                                                                       |
| UI utama tampil                       | —                                                                | `sphinx-launcher.exe` hidup, `MainWindowTitle = "Sphinx Launcher"`, `Responding = True`; renderer: `#root` 2 anak, `scrollHeight = 802` |

### Cara UI diverifikasi

`tauri dev` tidak meneruskan konsol webview ke terminal, dan jendela asli tidak bisa di-screenshot dari
dalam sesi agen ini. Jadi verifikasi render dilakukan dengan menjalankan **bundle yang sama** (dev server
`http://localhost:5173`) di dalam `BrowserWindow` Electron berbasis Chromium, lalu membaca DOM dan
menangkap pesan konsol. Hasil:

- `document.getElementById("root").childElementCount = 2`, `scrollHeight = 802` — React ter-mount dan UI
  utama tampil (sidebar Home/Catalogue/Library/Downloads/Settings, header, tab katalog, footer versi).
- Tidak ada pelanggaran CSP, tidak ada error alias/Vite, tidak ada error konfigurasi.
- Sisa pesan konsol hanyalah konsekuensi backend yang sengaja kosong: `Expected an array from
/catalogue/featured, received (undefined)` (guard milik aplikasi sendiri) dan beberapa
  `Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'filter')` yang timbul
  karena `hydraApi.get()` masih stub.

### Bug yang ditemukan dan diperbaiki saat verifikasi

Placeholder Fase 3 awalnya mengembalikan **Promise** untuk semua metode, termasuk `on*`. Preload
mengembalikan fungsi unsubscribe **secara sinkron** (`src/preload/index.ts:478-484`), dan renderer
menyerahkan nilai itu langsung ke cleanup `useEffect`. Akibatnya muncul
`TypeError: unsubscribe is not a function` (13 kali) dan tiga error boundary terpicu. Sudah diperbaiki:
metode `on*` kini mengembalikan fungsi unsubscribe sinkron, sesuai preload. Setelah perbaikan: 0 error
jenis itu.

### Catatan lingkungan (penting)

Repo ada di `C://Users//Raka Mahendra\Dokumen\Projects\sphinx` — **path mengandung spasi**. Dua hal:

1. **Toolchain.** Mesin ini tidak punya MSVC Build Tools (prasyarat resmi Tauri untuk Windows), dan
   penginstalannya butuh elevasi UAC yang tidak tersedia di sesi agen. Verifikasi Rust memakai toolchain
   GNU portable (MinGW-w64 UCRT + `stable-x86_64-pc-windows-gnu`).
2. **Spasi di path.** `tauri-winres` memanggil `windres`/`cc1` tanpa mengutip path, jadi build gagal
   langsung di path repo (`cc1.exe: fatal error: Mahendra\Dokumen\...`). Karena itu build dan
   `yarn tauri dev` dijalankan dari **salinan repo tanpa spasi** (`C://Users//Public//build//sp`, dengan
   `node_modules` di-junction ke aslinya). Isi `src-tauri/` identik dengan yang ada di repo ini.

Artinya: kode, konfigurasi, dan ikon terbukti benar dan berjalan. **Yang belum terbukti** adalah perilaku di
mesin ber-MSVC — itu target resmi PRD dan seharusnya mulus; ulangi di sana dengan perintah di bagian
berikutnya.

## 8. Ulangi di mesin ber-MSVC

```sh
# prasyarat: rustup + workload "Desktop development with C++" + WebView2
corepack yarn install
yarn tauri icon branding/png/sphinx-app-icon-1024.png
yarn dev              # atau:
yarn stage:node && yarn build   # `build` sudah memanggil stage:node
```

Catatan saat mengulang:

- `yarn build` menjalankan `tauri build`, yang butuh `frontendDist` (`../out/renderer`);
  `beforeBuildCommand` (`yarn build:renderer`) membuatnya.
- Jendela Big Picture **tidak** memuat `out/big-picture`. Ia memuat renderer yang sama di rute
  `#/big-picture` (lihat `src/renderer/src/main.tsx`), jadi `yarn build:big-picture` hanya perlu
  dijalankan kalau `src/big-picture` dipakai sebagai aplikasi mandiri. Fase 4 memverifikasinya:
  jendela Big Picture memuat `http://localhost:5173/#/big-picture`.
- Ikon di `src-tauri/icons/` berasal dari `branding/png/sphinx-app-icon-1024.png`; kalau mark berubah,
  jalankan `yarn tauri icon` lagi.
- `Cargo.lock` sudah di-commit.
- `yarn build` menyalin Node yang sedang dipakai ke
  `src-tauri/binaries/node-<triple>.exe` (`bundle.externalBin`). Di mesin MSVC triple-nya
  `x86_64-pc-windows-msvc`; berkas GNU yang mungkin tertinggal akan diabaikan.
- Versi belum menyatu: `tauri.conf.json` dan `Cargo.toml` = 0.1.0, `package.json` masih 4.1.6. Skrip
  `bump-version` (Fase 5) yang akan menyelaraskan ketiganya.
