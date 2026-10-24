# Sphinx Launcher — brand kit

Kit produksi untuk mark **Sphinx Launcher**: tablet batu yang terbelah oleh celah berbentuk profil wajah.
Dua keping itu adalah dua potong teka-teki — penjaga, bukan piramida.

---

## 1. Siapa yang membuat apa

|                         |                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Mark (bentuk dasar)** | Disediakan oleh pemilik proyek, Raka Mahendra — dibuat dengan alat AI lain (Claude), disimpan di `Dokumen/Logo Sphinx/C/`. Mark itu **tidak digambar ulang** di sini. |
| **Kit produksi**        | Dikerjakan oleh agen AI memakai skill `logo-design` (WorkBuddy): pembersihan file, audit, varian, raster, ikon web, dan dokumen ini.                                  |
| **Skill**               | `C:\Users\Raka Mahendra\.workbuddy-ai\skills\logo-design\SKILL.md`                                                                                                    |
| **Tanggal**             | 23 Oktober 2026                                                                                                                                                       |

**Pernyataan tidak menyalin:** mark ini bukan salinan, trace, atau turunan dari logo mana pun di pustaka
referensi skill `logo-design` (1.432 logo, dipakai hanya untuk mempelajari konstruksi), dan bukan turunan dari
logo Hydra, Steam, Epic, GOG, Heroic, Lutris, atau merek lain. Pustaka referensi dipakai untuk memeriksa
konvensi kategori dan untuk shelf test — bukan sebagai sumber bentuk.

**Dibuat oleh agen AI.** Bentuk mark berasal dari pemilik proyek; seluruh file produksi (SVG varian, PNG,
ikon web, manifest) dihasilkan oleh agen AI dan **belum melalui pemeriksaan mata desainer manusia**.
Jalankan checklist di bagian 8 sebelum rilis publik.

---

## 2. Ide

Celah di tengah tablet membentuk **profil wajah**: dahi, hidung, bibir, dagu, lalu turun ke leher. Baji kecil
di kiri celah adalah mata. Dibaca cepat ia hanya "batu terbelah"; dibaca kedua kali wajahnya muncul.
Itu teka-teki yang dijaga sphinx.

Karakter yang dijaga: misterius, percaya diri, presisi. Semua potongan lurus, chamfer 45°, tanpa lengkung
kecuali mata yang berupa baji.

---

## 3. File

### Master (SVG, sumber kebenaran)

| File                                              | Isi                                        | Pakai untuk                                    |
| ------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| `sphinx-symbol.svg`                               | Simbol penuh, `#111111` di atas transparan | latar terang, cetak, master                    |
| `sphinx-symbol-white.svg`                         | Simbol putih                               | latar gelap — **ini yang dipakai di aplikasi** |
| `sphinx-symbol-small.svg`                         | Potongan ukuran kecil: baji mata dihapus   | 16–24 px (tray terang)                         |
| `sphinx-symbol-small-white.svg`                   | Potongan ukuran kecil, putih               | 16–24 px di latar gelap (tray aplikasi)        |
| `sphinx-symbol-black.svg`                         | Semua cat → `#000000`                      | cetak satu warna                               |
| `sphinx-symbol-square.svg`                        | Simbol di tengah kanvas 256 dengan padding | avatar, sosial                                 |
| `sphinx-symbol-favicon.svg`                       | Kotak ketat untuk tab browser              | `favicon.svg`                                  |
| `sphinx-app-icon.svg`                             | Tablet putih di tile chamfer `#0d0d0d`     | ikon aplikasi, installer                       |
| `sphinx-logo-horizontal.svg`                      | Simbol + wordmark "Sphinx"                 | header, README, splash                         |
| `sphinx-logo-horizontal-black.svg` / `-white.svg` | Versi satu warna lockup                    | cetak / latar gelap                            |

### Raster

| File                                            | Ukuran            | Pakai untuk                                      |
| ----------------------------------------------- | ----------------- | ------------------------------------------------ |
| `png/sphinx-symbol-1024.png`                    | 1024², transparan | master raster                                    |
| `png/sphinx-symbol-white-1024.png`              | 1024², transparan | master raster (gelap)                            |
| `png/sphinx-app-icon-1024.png`                  | 1024², tile gelap | `yarn tauri icon`, `resources/icon.png`          |
| `png/sphinx-symbol-small-256.png`               | 256²              | turunan potongan kecil                           |
| `png/sphinx-logo-horizontal-1760.png`           | 1760 lebar        | README, halaman web                              |
| `png/tray-16.png`, `tray-32.png`, `tray-64.png` | 16/32/64          | tray icon (latar terang)                         |
| `png/tray-white-32.png`                         | 32                | tray icon (latar gelap)                          |
| `brand-sheet.png`                               | 1240×860          | lembar ringkas: mark, lockup, ikon, kartu simpan |

### Ilustrasi turunan

`source/sphinx-save-card.svg` → `src/renderer/src/assets/emulation/icons/sphinx-save-card.png` (512²).
Kartu memori "Sphinx Classics" untuk layar cloud save emulator; menggantikan ilustrasi berlogo Hydra.

### Web / PWA — folder `web/`

`favicon.ico` (16/32/48), `favicon-16/32/48.png`, `apple-touch-icon.png` (180), `icon-192.png`,
`icon-512.png`, `maskable-512.png`, `site.webmanifest`, `head-snippet.html`.
Simbol transparan untuk di dalam aplikasi: `sphinx-symbol-512.png`, `sphinx-symbol-white-512.png`.

### Sumber dan proses

- `source/` — file asli yang disediakan pemilik (`sphinx-symbol-supplied.svg`, `sphinx-lockup-supplied.svg`),
  disimpan apa adanya kecuali metadata C2PA dibuang.
- `process/` — brief, longlist 12 ide, catatan konsep, lembar konsep, `preview.html`, dan `explore/` berisi
  sepuluh percobaan yang dibuang beserta alasannya. Tiga konsep final di `process/concepts/` (A Profil,
  B Monogram, C Teka-teki) **ditolak pemilik proyek** — disimpan sebagai jejak proses, bukan sebagai arah
  yang dipakai. Mark yang dipakai adalah yang disediakan pemilik, lihat §1.

---

## 4. Warna

Mark ini **monokrom sejak desain**. Tidak ada warna merek yang ditetapkan di fase ini.

| Nama  | HEX       | RGB           | Pakai                           |
| ----- | --------- | ------------- | ------------------------------- |
| Ink   | `#111111` | 17, 17, 17    | mark di latar terang            |
| Paper | `#F5F5F2` | 245, 245, 242 | latar terang (disarankan)       |
| Tile  | `#0D0D0D` | 13, 13, 13    | latar gelap aplikasi, tile ikon |
| White | `#FFFFFF` | 255, 255, 255 | mark di latar gelap             |

Kontras: `#111111` di `#F5F5F2` = **16,4:1**; `#FFFFFF` di `#0D0D0D` = **19,5:1**. Keduanya jauh di atas
minimum 3:1 yang diminta brief.

Kalau nanti butuh satu warna merek (mis. untuk tombol atau aksen), jalankan:

```bash
python <skill>/scripts/export_variants.py branding/sphinx-symbol.svg --mono "#HEX" --only mono
```

---

## 5. Clear space dan ukuran minimum

**Clear space** = tinggi satu "keping" tablet, yaitu **¼ tinggi mark**, di keempat sisi. Tidak ada teks,
tepi panel, atau elemen lain di dalam zona itu.

**Ukuran minimum**

| Versi                        | Minimum      | Catatan                             |
| ---------------------------- | ------------ | ----------------------------------- |
| `sphinx-symbol.svg`          | 24 px        | di bawah 24 px, celah mulai menyatu |
| `sphinx-symbol-small.svg`    | 16 px        | potongan khusus untuk tray/favicon  |
| `sphinx-logo-horizontal.svg` | 120 px lebar | di bawah itu wordmark tidak terbaca |

Di 16 px, simbol penuh masih terbaca sebagai "tablet gelap dengan celah terang", tapi detail wajah hilang.
Itu wajar dan sudah diuji (lihat `process/renders/px16.png`).

---

## 6. Latar yang diizinkan

| Latar             | Versi                                                            |
| ----------------- | ---------------------------------------------------------------- |
| `#0D0D0D` / gelap | `-white`                                                         |
| `#F5F5F2` / putih | default (`#111111`)                                              |
| Foto / gameplay   | tile gelap di belakang mark, atau `-white` dengan bayangan tipis |
| Warna merek solid | `-white` (kontras putih di atas warna jenuh biasanya aman)       |

**Jangan:** menaruh versi hitam di atas latar gelap, memberi gradien, bayangan, glow, atau outline pada mark,
memutar, memiringkan, memberi stroke, atau mengubah rasio celah.

---

## 7. Catatan produksi (yang diubah agen, dan yang belum)

**Diubah:**

1. **Metadata C2PA dibuang.** File asli 8.370 byte, 7.774 di antaranya metadata penandatanganan. Master
   sekarang 596 byte. Isi geometri tidak diubah satu titik pun.
2. **`role="img"` + `<title>` + `<desc>`** ditambahkan untuk aksesibilitas.
3. **Potongan ukuran kecil** (`sphinx-symbol-small.svg`) dibuat dengan menghapus baji mata — satu-satunya
   perubahan bentuk, dan hanya untuk 16–24 px.
4. **Tile ikon aplikasi** dibuat dengan chamfer 45° yang sama dengan mark, supaya ikon terbaca sebagai satu
   objek, bukan "kotak di dalam kotak".

**Belum, dan perlu diketahui:**

1. **Wordmark masih berbasis stroke** (`stroke-width="16"`), bukan path terisi. Render benar di browser dan
   di `yarn tauri icon`, tapi **wajib di-outline** sebelum dikirim ke percetakan, plotter, atau bordir.
   Di Inkscape: _Path → Stroke to Path_, lalu _Path → Union_.
2. **Celah selebar 14 unit pada kanvas 256** (0,875 px di 16 px). Sengaja tidak dilebarkan di master karena
   itu mengubah proporsi desain pemilik. Kalau tray 16 px terasa pudar, pakai `sphinx-symbol-small.svg`
   atau lebarkan celah 2–3 unit khusus untuk ukuran itu.
3. **Belum ada pemeriksaan merek dagang.** "Sphinx" adalah kata umum dan banyak produk memakainya; sebelum
   rilis publik, jalankan pencarian di basis data merek (EUIPO, USPTO, DJKI) dan reverse image search.
4. **Belum ada varian stacked** (simbol di atas wordmark). Kalau nanti dibutuhkan untuk splash vertikal,
   bisa diturunkan dari lockup horizontal tanpa mengubah bentuk.

---

## 8. Checklist sebelum rilis

- [ ] Buka `sphinx-symbol-white.svg` di `#0D0D0D` pada 16, 24, 32, 64, 256 px — celah harus tetap terbaca.
- [ ] Buka `sphinx-logo-horizontal.svg` pada 120 px lebar — "Sphinx" harus terbaca.
- [ ] Cetak hitam-putih di kertas biasa (laser) — chamfer tidak boleh menggumpal.
- [ ] Jalankan `yarn tauri icon branding/png/sphinx-app-icon-1024.png` di Fase 3 setelah `src-tauri` ada.
- [ ] Shelf test: taruh ikon di sebelah Steam, Epic, GOG, Heroic, Lutris di taskbar — harus terbeda.
- [ ] Pemeriksaan merek dagang (lihat 7.3).

---

## 9. Audit

```
sphinx-symbol.svg               100/100  · 1 warna · 39 anchor · bbox fill 0.77 · tanpa stroke/gradient/text
sphinx-symbol-white.svg         100/100  · sama, putih
sphinx-symbol-small.svg         100/100  · 34 anchor (baji mata dihapus)
sphinx-app-icon.svg              99/100  · 2 warna (tile + mark) · INFO: mark di atas tile penuh
sphinx-logo-horizontal.svg       99/100  · 78 anchor · INFO: wordmark memakai stroke
```

Dijalankan dengan `svg_audit.py` dari skill `logo-design`, setelah metadata C2PA dibuang.
