# Branding allowlist — sisa `hydra` yang sah

Fase 2 mengganti merek di permukaan yang dilihat pengguna. Dokumen ini mencatat apa yang **sengaja tidak
diganti** dan kenapa, supaya `grep -ri hydra` di repo ini bisa dibaca tanpa curiga.

Dibuat: 23 Oktober 2026, Fase 2 (§4.D.2 PRD).

## 1. Aturan yang dipakai

| Diganti                                                                                                    | Tidak diganti                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| String terlihat: nilai i18n (35 locale) dan string hardcoded di JSX                                        | Identifier kode: nama variabel, tipe, fungsi, kelas CSS                 |
| Aset visual: ikon jendela, tray, installer, ikon web, logo UI                                              | Nama crate/folder native (`hydra-native`, `torrent-bridge`)             |
| Identitas teknis: `name`, `productName`, `description`, `author`, `appId`, executable, protokol, mime type | URL layanan dan paket pihak ketiga                                      |
| Nama protokol deep link: `hydralauncher://` → `sphinx://`                                                  | Nama plugin pihak ketiga (Decky) dan folder yang diharapkan isi zip-nya |
| Repo URL di README, badge, dan tautan rilis                                                                | Riwayat dokumen (`docs/`) dan catatan baseline                          |

Alasan pemisahan ini: mengganti identifier akan menghasilkan diff besar tanpa manfaat yang terlihat pengguna,
dan di beberapa tempat justru **merusak** (lihat §4).

## 2. Ringkasan hitungan

`grep -ril hydra` (tanpa `node_modules`, `.git`, `out`): **±596 file**.

| Area         | File | Isi utama                                            | Status                         |
| ------------ | ---- | ---------------------------------------------------- | ------------------------------ |
| `src/`       | 502  | identifier, `HYDRA_*`, key i18n `hydra_cloud.*`, URL | sah — lihat §3                 |
| `native/`    | 32   | crate `hydra-native`, path modul, komentar           | sah — dilarang rename oleh PRD |
| `scripts/`   | 17   | nama env, path build, fixture                        | sah                            |
| `docs/`      | 15   | catatan audit historis                               | sah — arsip                    |
| `.github/`   | 6    | nama workflow, cache path, project name              | sah                            |
| `resources/` | 6    | berkas legendary pihak ketiga                        | sah                            |
| `build/`     | 1    | `installer.nsh` membersihkan folder updater lama     | sah — lihat §5                 |

## 3. Yang tidak diganti di `src/`

| Pola                                                         | Contoh                                                                   | Kenapa                                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `HYDRA_*` (192 hit, 61 file)                                 | `HYDRA_ACCOUNT_FEATURES`, `HYDRA_TORRENT_BRIDGE_FROM_SOURCE`             | Nama env var dan feature flag; mengubahnya memutus `.env`, CI, dan tes            |
| `hydraApi`, `hydraUserId`, `hydraApiCall` (305 hit, 86 file) | `src/main/services/hydra-api.ts`                                         | Identifier modul/tipe; PRD hanya mewajibkan string terlihat                       |
| `hydra_cloud.*` (123 hit, 45 file)                           | key i18n `settings.hydra_cloud`                                          | **Key** tidak diubah, hanya **nilainya** (sudah jadi "Cloud Save (Google Drive)") |
| `Downloader.Hydra`                                           | enum di `@types`                                                         | Nilai enum dipakai di data tersimpan; mengganti berarti migrasi data              |
| Kelas CSS/BEM                                                | `.profile-page__stat-hydra-icon`, `&--hydra`, `#hydra-cloud-gradient`    | Internal; tidak terlihat pengguna, dan dipakai bersama `.scss` + `.tsx`           |
| `data-hydra-dialog`                                          | `chat-leaving-modal.tsx`                                                 | Atribut DOM untuk styling/perilaku                                                |
| Nama berkas modul                                            | `hydra-api.ts`, `hydra-auth-context.ts`, `install-hydra-decky-plugin.ts` | Impor relatif di banyak tempat; rename = churn besar                              |

## 4. Yang **tidak boleh** diganti (pernah dicoba, lalu dibatalkan)

Dua tempat ini adalah nama yang **dimiliki pihak lain**, bukan merek kita. Rename otomatis sempat menyentuhnya
dan sudah dikembalikan:

1. `src/main/constants.ts` — `HYDRA_DECKY_PLUGIN_LOCATION` menunjuk folder `homebrew/plugins/Hydra`. Folder itu
   adalah nama plugin Decky milik Hydra; kalau diganti, aplikasi mencari folder yang tidak ada dan instalasi
   plugin gagal.
2. `src/main/services/decky-plugin.ts` — `path.join(extractPath, "Hydra")` adalah nama folder **di dalam zip**
   plugin Hydra. Diganti = ekstraksi gagal.

Catatan: label UI untuk fitur ini sudah menjadi "Sphinx Decky Plugin" (string terlihat), padahal yang dipasang
tetap plugin Hydra. **Fitur ini warisan Hydra dan sebaiknya dihapus di §4.B**, bukan di-rebrand.

## 5. Sisa yang sah dan disengaja

| Lokasi                                       | Isi                                                      | Alasan                                                                                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `build/installer.nsh`                        | `RMDir /r "$LOCALAPPDATA\hydralauncher-updater"`         | Membersihkan folder updater **Hydra** saat uninstall — justru harus tetap "hydralauncher"                                                                                                   |
| `resources/legendary/managed.py`             | `sys.argv = ["hydra-legendary", ...]`                    | Berkas pihak ketiga (legendary), tidak disentuh                                                                                                                                             |
| `src/main/services/common-redist-manager.ts` | `github.com/hydralauncher/hydra-common-redist`           | Repo redistribusi pihak ketiga; mengganti = unduhan gagal                                                                                                                                   |
| `package.json`                               | `steam-shortcut-editor` → `github.com/hydralauncher/...` | Fork paket npm pihak ketiga                                                                                                                                                                 |
| `.env` / `.env.example`                      | `HYDRA_*`                                                | Kunci konfigurasi; lihat §3                                                                                                                                                                 |
| `docs/**`, `PRD.md`                          | Semua                                                    | Arsip dan rencana; menulis ulang akan menghapus jejak audit                                                                                                                                 |
| Fixture tes                                  | `C:/Users/Hydra/...`, `hydralauncher-4.1.3-setup.exe`    | Data uji; tidak terlihat pengguna. Sebagian berkas tes sengaja **dikembalikan utuh** karena mengganti nama pengguna di fixture tanpa mengganti path literal di sekitarnya membuat tes gagal |
| `.github/workflows/*`                        | `hydra-vcpkg-archives`, `native/hydra-native`            | Nama cache dan path crate                                                                                                                                                                   |

## 6. Yang masih terbuka

1. **String langganan yang sudah mati.** Setelah "Hydra Cloud" → "Cloud Save (Google Drive)" diterapkan
   mekanis, beberapa string berbunyi janggal karena fiturnya (gift/langganan) memang akan dihapus di §4.B:
   `notifications_page.cloud_gift_*`, `settings.allow_cloud_gifts`, `settings.renew_subscription`,
   `settings.become_subscriber`, `hydra_cloud.subscription_tour_title`,
   `game_details.downloader_requires_hydra_cloud`. Hapus bersama fiturnya, jangan diperbaiki satu per satu.
2. **`docs/screenshot.png` masih menampilkan UI Hydra** (judul jendela, ikon lama). Perlu diambil ulang setelah
   aplikasi bisa dijalankan dengan merek baru.
3. **Wordmark lockup masih berbasis stroke** — lihat `branding/README.md` §7.
4. **Pemeriksaan merek dagang** untuk "Sphinx" belum dilakukan.
