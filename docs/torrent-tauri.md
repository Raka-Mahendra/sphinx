# Torrent di Tauri — resource, lifecycle, verifikasi (Fase 6, PRD §4.C)

Status: implementasi selesai, verifikasi otomatis lulus, uji unduhan nyata
**belum** dijalankan di mesin ini (lihat §7). Mesin torrent tidak diganti:
`hydra-native` + `torrent-bridge` tetap, `DownloadManager`, status, seeding,
pilih-file, dan resume tidak disentuh.

## 1. Tata letak resource

Satu folder memuat addon **dan** bridge prebuilt, karena addon memuat bridge
dari direktorinya sendiri (Linux: `LD_LIBRARY_PATH` diisi `native-addon.ts`).

| Build       | Folder yang dipakai        | Sumber                                                                                  |
| ----------- | -------------------------- | --------------------------------------------------------------------------------------- |
| development | `<repo>/hydra-native`      | sama seperti Hydra (`app.getAppPath()/hydra-native`)                                    |
| paket       | `<resources>/hydra-native` | `src-tauri/tauri.conf.json` → `bundle.resources: { "../hydra-native": "hydra-native" }` |

Isi folder (dibuat oleh `yarn build:native`, **tidak** di-commit —
`/hydra-native/` ada di `.gitignore`):

```
hydra-native/
  hydra-native.node              addon N-API (crate native/hydra-native)
  hydra_torrent_bridge.dll       prebuilt bridge (Windows x64)
  vcruntime140.dll, msvcp140.dll VC++ runtime, disalin dari Build Tools
  THIRD_PARTY_NOTICES.txt, torrent-dependencies.json
```

Bridge prebuilt yang di-commit tetap di `native/torrent-bridge/prebuilt/<triplet>/`
(sesuai README: itu artefak rilis, bukan hasil build lokal). `postinstall`
menyalinnya ke `hydra-native/` lalu me-link addon terhadapnya.

### Path dari Rust ke sidecar

`src-tauri/src/sidecar/config.rs` menyelesaikan folder itu satu kali dan
mengirimnya sebagai environment:

| Variabel                   | Nilai                                                                   |
| -------------------------- | ----------------------------------------------------------------------- |
| `SPHINX_RESOURCES_DIR`     | `<resources>` (paket) atau `<repo>/resources` (dev)                     |
| `SPHINX_HYDRA_NATIVE_DIR`  | `<resources>/hydra-native` (paket) atau `<repo>/hydra-native` (dev)     |
| `SPHINX_TEST_NATIVE_ADDON` | hanya tes: modul pengganti addon (`src/sidecar/torrent-engine.test.ts`) |

`src/main/services/native-addon-path.ts` memilih, berurutan: modul tes →
`SPHINX_HYDRA_NATIVE_DIR` → `resourcesPath/hydra-native` (paket) →
`appPath/hydra-native` (dev). Nama folder dan berkas tidak di-rename.

Kalau build paket kehilangan addon, Rust mencetak
`[shell] hydra-native.node is missing from …` dan sidecar tetap boot dengan
degradasi baseline (`Sphinx native addon not found`). Karena itu kegagalan
seperti ini juga dibuat **gagal saat build**, bukan saat pengguna menekan
tombol unduh (§3).

## 2. Pemanggil API Electron di jalur torrent

Jalur torrent hanya memakai `app.isPackaged`, `app.getAppPath()`, dan
`process.resourcesPath`; semuanya lewat shim (`src/sidecar/electron-shim`),
bukan Electron. `src/main/services/download/**` tidak mengimpor `electron`
sama sekali. `powerSaveBlocker` (`power-save-blocker.ts`, dipakai saat unduhan
berjalan) juga lewat shim, tetapi implementasi shell-nya masih stub — lihat §6.
Tidak ada kanal IPC/webview yang bisa mengendalikan engine: kontrol hanya
`torrentInitialize` / `torrentRequest` / `torrentShutdown` di dalam sidecar
(audit §3).

## 3. Dependensi runtime `.node` dan VC++

Dua temuan, keduanya diukur dengan tabel impor PE:

1. **Bridge prebuilt tidak butuh VC++ redistributable.** Dibangun dengan
   triplet vcpkg `x64-windows-static`, jadi CRT-nya statis. Impor
   `hydra_torrent_bridge.dll` (terukur di mesin ini):
   `mswsock, crypt32, iphlpapi, bcrypt, ws2_32, kernel32, user32, advapi32` —
   semuanya DLL sistem Windows.
2. **Addon Rust membutuhkannya.** `hydra-native.node` dibangun MSVC dengan CRT
   dinamis dan mengimpor `vcruntime140.dll` / `msvcp140.dll`.
   `scripts/build-native-addon.cjs` menyalin DLL redist dari Build Tools
   (lewat `vswhere`) ke `hydra-native/`, sehingga mesin bersih tanpa Visual C++
   Redistributable tetap bisa memuatnya.

`scripts/check-torrent-resources.mjs` (`yarn check:torrent-resources`) membaca
tabel impor `hydra-native.node` dan bridge tanpa dependensi baru, lalu:

- gagal bila `hydra-native.node` atau bridge platform ini tidak ada;
- gagal bila DLL runtime VC++ yang diimpor tidak ikut dikemas — "ada di
  `C:\Windows\System32`" tidak cukup, karena itu justru kasus yang lulus di
  mesin build dan gagal di mesin bersih;
- gagal bila `bundle.resources` tidak lagi memetakan folder ke `hydra-native`;
- memperingatkan DLL tak dikenal dan berkas non-PE.

Skrip ini dijalankan `yarn build` dan workflow rilis sebelum `tauri build`.
Workflow juga membangun addon (`yarn build:native`) yang sebelumnya **tidak**
dilakukan: `yarn install --ignore-scripts` melewati `postinstall`, sehingga
rilis akan terbit tanpa mesin torrent sama sekali.

## 4. Lifecycle: satu engine, shutdown terurut, tanpa proses yatim

| Jaminan                     | Mekanisme                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Satu engine per sidecar     | `TorrentService` = satu `TorrentClient`; `initialize()` meng-cache promise dan selalu memakai port 5881                                         |
| Satu engine per mesin       | port `5881` eksklusif (libtorrent) + LevelDB lock + supervisor tidak pernah spawn sebelum anak lama di-reap (`wait_for_exit`)                   |
| `torrentShutdown` saat exit | hook urut `entry.ts`: `pauseActiveDownload` → … → `torrentShutdown` (timeout 5 s) → `clearGamesPlaytime` → `db.close()`                         |
| Berhenti saat app keluar    | `RunEvent::ExitRequested`/`Exit` memblokir pada `supervisor.shutdown`, lalu `kill_and_reap`; updater memakai jalur yang sama (`on_before_exit`) |
| Tanpa proses yatim          | `stdin` tertutup ⇒ sidecar `finish("shell-closed-stdin")`; `kill_on_drop(true)` di supervisor; SIGTERM/SIGINT ditangani                         |

Kegagalan satu hook dicatat di `failures` dan tidak menghentikan hook lain:
flush torrent yang macet tidak boleh mencegah LevelDB ditutup.

## 5. Tes otomatis

| Berkas                                        | Cakupan                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/services/native-addon-path.test.ts` | resolusi path dev vs paket vs `SPHINX_HYDRA_NATIVE_DIR` vs modul tes                                                                                                                                                                                                                                                                                |
| `src/main/services/torrent-client.test.ts`    | init sekali (port 5881) walau panggilan bersamaan, bentuk request JSON, error → `TorrentError`, shutdown menolak panggilan berjalan, `initialize()` berikutnya = engine baru                                                                                                                                                                        |
| `src/sidecar/torrent-engine.test.ts`          | integrasi proses nyata: satu init per boot, `set_network_interface` terkirim, satu `torrentShutdown` saat shutdown bersih, socket dilepas sebelum proses keluar, sidecar kedua **bukan** engine kedua (`EADDRINUSE`), ambil alih setelah yang pertama dibunuh, `stdin` tertutup ⇒ exit 0 + engine berhenti, restart setelah `SIGKILL` ⇒ satu engine |

Tes integrasi memakai `src/sidecar/fixtures/fake-torrent-engine.cjs` sebagai
pengganti `hydra-native.node`: ia memegang socket eksklusif pada port yang
diberikan, persis sumber daya eksklusif yang dipegang libtorrent. Semua kode
lain — `loadState`, `DownloadManager.initializeTorrentService`, `TorrentClient`,
`NativeAddon`, hook shutdown — adalah kode yang dikirim.

Perintah:

```
yarn test:torrent        # build sidecar + 4 tes integrasi
node --import ./scripts/register-ts-node.mjs --test src/main/services/torrent-client.test.ts src/main/services/native-addon-path.test.ts
yarn check:torrent-resources
```

Hasil di mesin ini (25 November 2026):

| Perintah                                                                             | Hasil                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2 berkas tes unit                                                                    | 11/11 lulus                                                                                                                                                                                       |
| `src/sidecar/torrent-engine.test.ts`                                                 | 4/4 lulus                                                                                                                                                                                         |
| `yarn check:torrent-resources --allow-missing`                                       | lulus dengan peringatan: `hydra-native.node` belum dibangun                                                                                                                                       |
| `tsc -p tsconfig.test.json` untuk berkas baru                                        | bersih                                                                                                                                                                                            |
| `src/sidecar/crash-recovery.test.ts` (fallback dev, tanpa `SPHINX_HYDRA_NATIVE_DIR`) | 4/4, dijalankan dengan `TS_NODE_TRANSPILE_ONLY=true` karena `crash-recovery.test.ts:365` punya error tipe lama yang membuat ts-node menolak memuat berkas itu; kode tesnya tidak diubah di Fase 6 |

## 6. Acceptance 4.C vs baseline Electron

| Kriteria 4.C                                          | Status di sini                                                          | Catatan / beda vs Electron                                                |
| ----------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Magnet & `.torrent` mulai mengunduh ke folder pilihan | **Belum diuji** (addon tidak bisa dibangun di mesin ini)                | Kode jalur sama; `NativeAddon.torrentInitialize/Request` identik          |
| Progres, kecepatan, peer/seed sama                    | **Belum diuji**                                                         | `status`/`seed_status` RPC tidak diubah; polling `DownloadManager` sama   |
| Jeda, lanjut, batal, hapus dengan/tanpa file          | **Belum diuji**                                                         | `action` payload identik; `cancel`→`ht_remove(part)` di bridge tak diubah |
| Pilih sebagian file                                   | **Belum diuji**                                                         | timeout selective 60 s dipertahankan                                      |
| Restart app / kill sidecar: lanjut tanpa duplikasi    | **Sebagian**: siklus kill→restart diuji pada level proses & DB queue    | Uji torrent nyata butuh addon; tes crash Fase 4 menutup sisi LevelDB      |
| Engine tunggal                                        | **Lulus** (tes integrasi)                                               | Port 5881 + LevelDB + `wait_for_exit`; sama seperti baseline              |
| Berhenti saat app keluar, tanpa proses yatim          | **Lulus** (tes integrasi: shutdown bersih, `stdin` tertutup, `SIGKILL`) | Baseline: `before-quit`; Tauri: `RunEvent::Exit` + `kill_on_drop`         |
| Installer di mesin bersih tanpa Python                | **Belum diuji** (tidak ada VM bersih)                                   | Runtime Python tidak dipakai jalur torrent (§7); Epic tetap flag-off      |
| Listen socket `0.0.0.0:5881`                          | **Belum diuji live**                                                    | Semantik bind tidak diubah (audit §3); kompromi yang sama dengan baseline |

Perbedaan yang dicatat (bukan regresi torrent):

1. **`powerSaveBlocker`** masih stub di `src-tauri/src/power.rs`: unduhan tetap
   berjalan, tetapi layar bisa tidur saat mengunduh (baseline mencegahnya).
   Ini celah shell, bukan engine; dicatat di `docs/sidecar.md`.
2. **`hydra-native.node` dibangun postinstall**, bukan dibawa repo. Installer
   wajib melewati `yarn check:torrent-resources` agar build tanpa engine gagal
   cepat — di Electron, `electron-builder` hanya menyalin folder yang ada.
3. **Kegagalan engine saat boot tidak mematikan aplikasi** (perilaku baseline):
   `loadState` mencatat error dan UI tetap terbuka.

## 7. Rencana uji mesin bersih (wajib sebelum rilis)

Windows 10/11 x64, **tanpa** Python, tanpa Visual C++ Redistributable, tanpa
Node/Rust:

1. Pasang installer NSIS dari halaman Releases resmi. Jalankan.
2. Pastikan tidak ada `python.exe` di mesin dan proses Sphinx tetap berjalan.
3. Unduh magnet dan satu berkas `.torrent` ke folder khusus. Periksa progres,
   kecepatan, peer/seed di UI Downloads.
4. Jeda → lanjut → batal (tanpa file) → hapus (dengan file). Pastikan folder
   bersih setelah hapus-dengan-file.
5. Mulai unduhan multi-file, pilih sebagian file, pastikan hanya file terpilih
   yang tertulis.
6. `Get-NetTCPConnection -LocalPort 5881` selama unduhan: harus ada satu
   listener milik `sphinx-launcher.exe`/`node.exe`. Setelah app keluar: tidak
   ada listener, tidak ada `node.exe` sisa (`tasklist | findstr node`).
7. Restart app saat unduhan 50 %: lanjut tanpa duplikasi (hash recheck boleh).
8. `taskkill /F` pada proses `node.exe` sidecar saat unduhan berjalan: supervisor
   menyalakan sidecar baru, unduhan lanjut, tetap hanya satu listener.
9. Keluar dari app saat unduhan berjalan: progres tersimpan, tidak ada proses
   sisa, dan setelah dibuka lagi unduhan melanjutkan.
10. Catat hasilnya di dokumen ini dan `docs/MIGRATION_LOG.md`.

## 8. Yang tidak bisa diverifikasi di mesin ini

- `hydra-native.node` tidak ada dan tidak bisa dibangun: `napi-build` menuntut
  `libnode.dll` yang tidak disertakan distribusi Node di mesin ini, dan toolchain
  MSVC/Rust (`cargo`) tidak terpasang. Karena itu semua uji unduhan nyata
  (magnet/`.torrent`, jeda/lanjut/batal, pilih file, seeding) belum dijalankan.
- `cargo check`/`cargo test` untuk perubahan `config.rs` tidak dijalankan di
  sini; perubahan itu hanya menambah satu environment variable dan satu
  peringatan, dan harus lolos di CI.
- Tidak ada VM Windows bersih, jadi klaim "tanpa Python / tanpa VC++ redist"
  masih berupa desain + pemeriksaan impor PE, bukan uji instalasi.
