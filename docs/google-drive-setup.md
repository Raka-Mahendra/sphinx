# Google Drive Cloud Save — Setup

Panduan ini adalah langkah yang harus dilakukan **pemilik build** (bukan
pengguna) sebelum cloud save Google Drive bisa dipakai. Sphinx tidak memakai
`googleapis` dan tidak memakai backend Hydra: semua panggilan adalah REST v3
lewat `fetch`, dengan scope tunggal `https://www.googleapis.com/auth/drive.appdata`.

## 1. Ringkasan model

| Hal         | Nilai                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| Scope OAuth | `drive.appdata` saja (tidak ada `drive`, `drive.file`, atau `userinfo`)                                          |
| Penyimpanan | `appDataFolder` — tidak terlihat di Drive biasa, tidak bisa dicari                                               |
| Blob        | `<gameKey>/<sha256>` (content-addressed, satu file per isi unik)                                                 |
| Manifest    | `<gameKey>/snapshots/<version>.json` (immutable, tanpa `index.json`)                                             |
| Metadata    | `appProperties`: `app=sphinx`, `schema=1`, `kind`, `gameKey`, `hash`/`version`/`parent`, `deviceId`, `createdAt` |
| Konflik     | version + re-list setelah tulis; Drive v3 tidak menyediakan ETag/`If-Match` yang dapat diandalkan                |
| Retensi     | default 3 versi (1–10), GC hanya untuk blob tak terujuk berumur > 24 jam                                         |
| Konfirmasi  | default 100 MB, dihitung dari byte baru setelah dedupe                                                           |

Folder `appDataFolder` bersifat per akun Google pengguna. Data yang sama tidak
muncul di "My Drive", tidak bisa dibuka lewat Drive web, dan hilang bila
pengguna menghapus aplikasi dari **Settings → Manage apps** di Drive.

## 2. Buat proyek Google Cloud

1. Buka <https://console.cloud.google.com/projectcreate>.
2. Nama proyek bebas, misalnya `sphinx-cloud-save`. Catat **project ID**.
3. Tidak perlu billing untuk kuota dasar Drive API, tetapi kuota per project
   tetap berlaku (lihat §6).

## 3. Aktifkan Google Drive API

1. **APIs & Services → Library**.
2. Cari **Google Drive API**, buka, klik **Enable**.
3. Tunggu 1–2 menit sampai status enabled.

## 4. OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (aplikasi desktop yang dibagikan ke publik).
3. Isi:
   - App name: `Sphinx`
   - User support email: email dukungan
   - Developer contact: email pengembang
   - App logo (opsional), homepage, dan privacy policy **wajib** bila nanti
     brand verification diminta Google.
4. **Scopes → Add or remove scopes**, tambahkan hanya:
   - `https://www.googleapis.com/auth/drive.appdata`
   - Jangan menambahkan scope Drive lain. `drive.appdata` termasuk
     **non-sensitive**, jadi tidak memerlukan review keamanan penuh; tetap
     perlu kebijakan privasi dan halaman aplikasi yang benar.
5. Simpan. Status awal adalah **Testing**.

### Testing vs Production

| Mode           | Siapa yang bisa login                                         | Refresh token                    |
| -------------- | ------------------------------------------------------------- | -------------------------------- |
| **Testing**    | Maksimal 100 test user (ditambahkan manual di **Test users**) | **Kedaluwarsa 7 hari**           |
| **Production** | Semua pengguna Google                                         | Bertahan sampai dicabut pengguna |

Untuk rilis nyata, klik **Publish app** sampai status **In production**.
Selama masih Testing, pengguna akan dipaksa menghubungkan ulang setiap minggu —
perilaku ini bukan bug Sphinx.

Catatan verifikasi Google saat audit (Oktober 2026):

- `drive.appdata` non-sensitive sehingga umumnya **tidak** memicu review scope;
  Google tetap dapat meminta **brand verification** (logo, nama aplikasi,
  homepage, privacy policy) sebelum menampilkan layar consent tanpa peringatan.
- Selama belum terverifikasi, pengguna melihat layar **"Google hasn't verified
  this app"** dan harus menekan **Advanced → Go to Sphinx**.
- Batas 100 test user hanya berlaku di mode Testing.

## 5. Buat OAuth client (Desktop app)

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Desktop app**. Nama: `Sphinx Desktop`.
3. Salin **Client ID** dan **Client secret**.
4. Tidak perlu mengisi redirect URI: Sphinx memakai loopback
   `http://127.0.0.1:<port acak>/callback`, dan client bertipe Desktop
   mengizinkan loopback apa pun pada port lokal.

> **Client ID tidak boleh diganti setelah rilis publik.** Google mengikat
> persetujuan pengguna (grant) ke client ID. Menggantinya memaksa semua
> pengguna menghubungkan ulang, dan `drive.appdata` lama tetap tertinggal di
> akun mereka. Buat client baru hanya untuk build fork/eksperimen.

## 6. Kuota Drive API (dari konsol)

Angka ini berasal dari dokumentasi Google Drive API saat audit; **selalu
periksa ulang** di **IAM & Admin → Quotas** untuk project Anda karena Google
dapat mengubahnya:

| Kuota                         | Nilai saat audit       |
| ----------------------------- | ---------------------- |
| Unit per menit per project    | 1.000.000              |
| Unit per menit per user       | 325.000                |
| Egress per hari per project   | 1 TB                   |
| `files.list`                  | 100 unit per panggilan |
| `files.get` (unduh media)     | 200 unit per panggilan |
| `files.create`/`files.update` | 50 unit per panggilan  |

Konsekuensi desain di Sphinx: `pageSize=1000` + `fields` parsial, filter
`appProperties`, cache daftar ~5 menit, konkurensi unggah 3, backoff
eksponensial + jitter pada 429/403 `rateLimitExceeded`/5xx, dan tanpa polling.
`about.get` dipakai hanya saat halaman Settings dibuka untuk menampilkan sisa
kuota akun.

Bila kuota terlampaui Google membalas **403 `userRateLimitExceeded`** atau
**429**, keduanya ditangani backoff yang sama; tidak ada jalan pintas lewat
batch request karena setiap blob perlu media upload sendiri.

### Batas `appProperties`

Dari [dokumentasi custom file properties](https://developers.google.com/workspace/drive/api/guides/properties)
(Google, diakses 25 November 2026):

| Batas                                                     | Nilai    |
| --------------------------------------------------------- | -------- |
| Properti kustom per file (semua sumber)                   | 100      |
| Properti privat per aplikasi per file                     | 30       |
| Panjang satu string properti (kunci **dan** nilai, UTF-8) | 124 byte |

Sphinx menulis 9 kunci (`app`, `schema`, `kind`, `gameKey`, `hash`/`version`,
`parent`, `deviceId`, `createdAt`), jauh di bawah 30. Nilai terpanjang adalah
`deviceId` (UUID, 36 karakter) dan `createdAt` (ISO-8601, 24 karakter);
`gameKey` adalah `"<shop>-<objectId>"` yang normalnya < 40 karakter. Tidak ada
nilai yang mendekati 124 byte, dan properti tidak bersarang (nilai selalu
string) — batas ini diverifikasi saat audit, bukan asumsi.

## 7. Menanam client ke build

Client **tidak pernah** masuk repo. Nilai dibaca saat kompilasi oleh Rust
(`src-tauri/src/sidecar/config.rs`, `option_env!`) lalu diteruskan ke sidecar
sebagai `SPHINX_GOOGLE_CLIENT_ID` / `SPHINX_GOOGLE_CLIENT_SECRET`.

### Build resmi (GitHub Actions)

Tambahkan repository secret:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Workflow `.github/workflows/tauri-release.yml` meneruskannya ke step
**Build the bundle**. Tanpa secret ini, installer tetap terbangun tetapi tombol
**Hubungkan Google Drive** nonaktif dengan pesan
"Google Drive belum dikonfigurasi di build ini".

### Build lokal

```bash
GOOGLE_CLIENT_ID="...apps.googleusercontent.com" \
GOOGLE_CLIENT_SECRET="..." \
node scripts/build-sidecar.mjs
# lalu build Tauri seperti biasa
```

Fork yang ingin memakai client sendiri cukup menimpa env yang sama saat build;
tidak ada UI untuk mengganti client ID, dan client resmi tidak boleh diubah
setelah rilis.

## 8. Verifikasi acceptance 4.F.6

| Kriteria                                   | Cara memeriksa                                                               | Status   |
| ------------------------------------------ | ---------------------------------------------------------------------------- | -------- |
| URL otorisasi hanya berisi `drive.appdata` | `pkce.test.ts` → "requests only drive.appdata with offline access and S256"  | otomatis |
| Token tidak ada di data/log                | Perintah grep di bawah                                                       | manual   |
| File tidak tampak di Drive biasa           | Login, unggah satu save, buka <https://drive.google.com> → "My Drive" kosong | manual   |
| Refresh token di keychain OS               | Setelah login, buka Credential Manager (Windows) → entri `Sphinx Launcher`   | manual   |
| Putuskan menghapus grant                   | Setelah **Putuskan**, cek <https://myaccount.google.com/permissions>         | manual   |

### Grep data & log (Windows, PowerShell)

Tutup Sphinx terlebih dahulu agar tidak ada token di memori yang ikut tertulis.

```powershell
$roots = @(
  "$env:APPDATA\Sphinx",
  "$env:LOCALAPPDATA\Sphinx",
  "$env:APPDATA\sphinx"
)
foreach ($root in $roots) {
  if (Test-Path $root) {
    Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue |
      Select-String -Pattern 'refresh_token|ya29\.|1//0' -List -ErrorAction SilentlyContinue
  }
}
```

Tidak boleh ada hasil. Yang diharapkan: hanya file
`google-drive-settings.json` (retensi/ambang konfirmasi) dan
`google-drive-device-id` (UUID perangkat) — keduanya tidak rahasia.

### Langkah uji manual login (butuh akun Google nyata)

1. Isi `GOOGLE_CLIENT_ID`/`SECRET` (§7), build, jalankan Sphinx.
2. **Settings → Integrations → Google Drive → Hubungkan**.
3. Browser sistem terbuka. Periksa address bar: harus
   `accounts.google.com`, dan bila diminta detail izin, hanya
   "See, edit, create and delete only the specific Google Drive files you use
   with this app" (itu teks untuk `drive.appdata`).
4. Setujui. Browser menampilkan "You may now close this window", Sphinx
   kembali dan status menjadi **Connected**.
5. Buka game, jalankan **Backup ke cloud**; tunggu selesai.
6. Buka <https://drive.google.com> → **My Drive** harus tetap kosong. Cek
   **Settings → Manage apps** → Sphinx → jumlah file bertambah.
7. Ubah save, backup lagi; buka halaman snapshot dan pastikan versi bertambah
   serta restore versi lama berhasil.
8. Tutup Sphinx, buka lagi: status harus tetap **Connected** (token dari
   keychain). Bila keychain tidak tersedia, Sphinx menampilkan peringatan
   "koneksi berakhir saat Sphinx ditutup" dan status menjadi terputus setelah
   restart.
9. **Putuskan** → pilih **hapus data cloud** → cek Drive **Manage apps** dan
   <https://myaccount.google.com/permissions>: grant harus hilang.
10. Uji `invalid_grant`: cabut akses dari halaman permissions, lalu backup
    lagi. Sphinx harus menampilkan status terputus dengan ajakan
    menghubungkan ulang, bukan error mentah.

## 9. Troubleshooting

| Gejala                                          | Penyebab / tindakan                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| "Google Drive belum dikonfigurasi di build ini" | Build tanpa `GOOGLE_CLIENT_ID`; lihat §7                                           |
| Login berhasil, tapi besok minta login lagi     | Consent screen masih **Testing** (refresh token 7 hari); publish ke Production     |
| `storageQuotaExceeded`                          | Kuota Drive akun pengguna penuh; Sphinx menampilkan pesan khusus, bukan retry      |
| 403 `rateLimitExceeded` / 429                   | Backoff otomatis; bila berulang, kurangi frekuensi backup atau cek kuota project   |
| `invalid_grant`                                 | Grant dicabut/kedaluwarsa; hubungkan ulang dari Settings                           |
| Keychain tidak tersedia                         | Token hanya di memori; koneksi hilang saat aplikasi ditutup                        |
| Konflik "cloud/lokal/keduanya"                  | Dua perangkat menulis versi yang sama; backup lokal dibuat lebih dulu bila memilih |
