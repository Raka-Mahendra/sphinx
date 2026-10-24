# Konsep — apa yang dibangun, apa yang dibuang

Tiga konsep final ada di `concepts/`. Semua hitam-putih dulu (tanpa warna) supaya yang dinilai bentuknya.
Sepuluh percobaan yang gagal disimpan di `concepts/explore/` — bukan sampah, tapi bukti arah yang sudah dicoba
dan alasan kenapa ditinggalkan.

## Yang final

|     | Nama          | Jenis      | Ide satu kalimat                                                                                        |
| --- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------- |
| A   | **Profil**    | pictorial  | Kepala sphinx dalam profil, dipotong lurus seperti batu; satu mata bulat sebagai satu-satunya lengkung. |
| B   | **Monogram**  | letterform | Huruf S geometris dengan ujung terpotong datar, dibangun dari dua busur — tanpa font.                   |
| C   | **Teka-teki** | symbolic   | Tanda tanya tebal: sphinx adalah penjaga teka-teki, jadi tandanya adalah teka-tekinya.                  |

## Hasil audit (`svg_audit.py`)

```
a-profil.svg    100/100   bbox fill 0.48   margin 52/52/24/24   anchor 18
b-monogram.svg   98/100   bbox fill 0.22*  anchor 3   (masih stroke — lihat catatan)
c-teka.svg       98/100   bbox fill 0.22*  anchor 11  (masih stroke — lihat catatan)
```

\* `bbox fill` rendah pada B dan C adalah artefak alat: audit menghitung bbox dari garis tengah path dan
mengabaikan lebar stroke. Secara render keduanya mengisi kanvas sampai margin 24.

**Dua peringatan yang tersisa dan disengaja:**

1. **B dan C masih memakai `stroke`, bukan fill.** Ini boleh di tahap konsep (skill mengizinkan stroke untuk
   eksplorasi), tapi **wajib di-outline sebelum jadi master**. Kalau B atau C dipilih, langkah pertama kit adalah
   mengubah stroke jadi path terisi.
2. **A sempat kena peringatan `near-miss-angle`** (47,7° / 87,8° / 31°). Sudah disnap ke 45°/90°/45° — skor naik
   dari 90 ke 100.

## Uji 16 px (dari lembar konsep)

Ini yang menentukan rekomendasi, bukan selera:

- **A** → jadi bintik hitam. Kepala profil memang lebih tinggi daripada lebar (122×168), jadi di 16 px tinggal
  gumpalan. **Tidak lulus syarat brief.**
- **B** → tetap terbaca sebagai "S". Lulus.
- **C** → tetap terbaca sebagai "?". Lulus, dan paling khas di ukuran itu.

## Yang dibuang, dan kenapa

| Percobaan                         | Terbaca sebagai               | Pelajaran                                                 |
| --------------------------------- | ----------------------------- | --------------------------------------------------------- |
| Gerbang (arch + kaki melebar)     | huruf "A" / mulut terowongan  | Kaki melebar = piramida. Dilarang brief.                  |
| Nemes depan (dua lappet + celah)  | celana panjang                | Dua kaki vertikal + celah = celana, bukan kepala.         |
| Nemes depan (versi celah sempit)  | tugu nisan                    | Bawah rata + atas melengkung = batu nisan. Konotasi mati. |
| Topeng (belah ketupat + dua slot) | nisan / koin kasino           | Slot tidak terbaca sebagai lappet.                        |
| Penjaga (bust + plinth)           | vas di atas alas              | Simetri + alas lebar = piramida/vas.                      |
| Duduk (siluet menyamping)         | pistol / setrika / sepatu bot | Siluet duduk tanpa ruang negatif (kaki, ekor) jadi benda. |
| Totem (lebar–sempit–lebar)        | huruf "I"                     | Terlalu abstrak; tidak ada sphinx-nya.                    |
| Profil + bib lappet               | sirip / rok                   | Lappet ke depan menghilangkan leher, massa jadi aneh.     |
| Profil + pita nemes               | topi tambang / robot          | Detail garis di kepala bersaing dengan mata.              |
| Profil + mata celah               | topeng robot                  | Mata celah membunuh kesan wajah.                          |

**Kesimpulan proses:** kepala manusia dalam siluet padat hampir selalu terbaca "kepala generik" — tidak ada
ciri khas di konturnya. Yang khas dari sphinx adalah **nemes** (kain kepala), dan nemes dalam tampak depan
selalu jatuh ke "piramida" atau "celana". Karena itu tiga final sengaja bergeser: satu pictorial yang jujur
(A, dengan kelemahan 16 px yang diakui), satu letterform (B), satu symbolic (C).

## Rekomendasi

**C — Teka-teki.** Alasan:

1. Satu-satunya yang kuat di 16 px _dan_ punya karakter. Lockup "? Sphinx" langsung terbaca sebagai
   "teka-teki sphinx" — cerita mereknya jalan tanpa penjelasan.
2. Sesuai brief: "bentuk teka-teki" adalah salah satu dari tiga acuan yang diminta.
3. Tidak menabrak larangan: bukan piramida, bukan mata, bukan firaun, bukan gamepad, bukan kucing, bukan Hydra.

**Risiko yang harus kamu tahu:** tanda tanya di UI bisa terbaca sebagai tombol "bantuan". Mitigasi: tanda ini
selalu tampil bersama wordmark di dalam aplikasi, dan ikon aplikasi memakai tanda ini di atas tile gelap —
bukan sebagai glyph telanjang di toolbar. Kalau kamu menilai risiko itu terlalu besar, **B (Monogram)** adalah
pilihan paling aman, dan **A (Profil)** pilihan paling pictorial kalau kamu mau mengorbankan keterbacaan 16 px.

## Catatan kejujuran

- Saya bisa melihat render PNG (sharp/librsvg), jadi penilaian visual di atas berdasarkan gambar yang benar-benar
  saya lihat — bukan tebakan dari kode.
- `preview.html` belum saya lihat sebagai halaman jadi (tidak ada browser headless di mesin ini); isinya
  dihasilkan `preview_sheet.py` dan perlu kamu buka sendiri.
- Wordmark di lockup masih `<text>` font sistem (Segoe UI). Hanya untuk menilai proporsi; di kit final huruf
  dibuat sebagai path.
- Semua logo di `assets/library` skill hanya dipelajari sebagai referensi konstruksi. Tidak ada yang disalin
  atau di-trace.
