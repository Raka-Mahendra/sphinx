# Sphinx Launcher — Design Brief

Sumber: `PRD.md` §4.D.1. Disusun oleh agen AI (skill `logo-design`, fase Discovery).

## 1. Inti merek

|                 |                                                                              |
| --------------- | ---------------------------------------------------------------------------- |
| Nama            | **Sphinx Launcher**                                                          |
| Apa             | Aplikasi desktop open-source untuk mengelola library game dan mengunduh game |
| Audiens         | Gamer PC yang menghargai tools open-source, rapi, tanpa iklan                |
| Karakter        | Misterius · percaya diri · modern · presisi                                  |
| Metafora inti   | **Penjaga teka-teki** — bukan gurun, bukan piramida, bukan Mesir-hiasan      |
| Jenis tanda     | Simbol pictorial/abstrak yang mengacu ke sphinx + wordmark "Sphinx"          |
| Target terkecil | 16 px (favicon, tray)                                                        |
| Konteks         | UI gelap; butuh versi satu warna dan terbalik; kontras ≥ 3:1                 |

## 2. Asumsi (dinyatakan, bukan ditanyakan)

1. **Bahasa visual**: geometris, tanpa gradien, tanpa bayangan — "presisi" berarti potongan lurus dan sudut eksak,
   bukan detail ilustratif.
2. **Bukan maskot**: sphinx di sini adalah _patung penjaga_, bukan karakter lucu. Wajah tidak digambar detail.
3. **Warna belum diputuskan** di fase konsep. Semua konsep dinilai hitam-putih dulu (greyscale) supaya keputusan
   soal bentuk, bukan selera warna.
4. **Wordmark** pada lembar konsep masih memakai `<text>` (font sistem) — hanya untuk menilai proporsi lockup.
   Di kit final, huruf dibuat sebagai path (outline), tidak bergantung font terpasang.
5. Nama "Sphinx" sudah ditetapkan PRD; tidak ada opsi penamaan ulang di fase ini.

## 3. Konvensi kategori (dan klise yang harus dihindari)

Riset `search_library.py --industry gaming --summary`: 5 logo, 60% mono, 80% geometri lingkaran,
60% negative-space, 100% memakai 1–2 warna. Artinya kategori ini **didominasi lingkaran monokrom** —
peluang pembeda ada di siluet non-lingkaran.

**Klise yang dilarang** (dari brief + hasil riset):

- Piramida / segitiga gurun, mata Horus, kepala firaun generik
- Gamepad, tombol play, joystick, kartrid
- Kucing generik (sphinx = singa berkepala manusia; jangan jadi kucing)
- Gradien rumit, glow, bayangan
- Lingkaran berisi inisial (Steam/Epic/GOG/Heroic/Lutris semuanya di wilayah ini)
- **Hydra** (logo lama: kepala gurita + tentakel di kotak rounded hitam) → konsep apa pun dengan
  banyak anggota tubuh/lekuk organik di dalam kotak akan terasa "Hydra 2.0". Hindari.

## 4. Peta kata

| Sumbu   | Kata                                                                    |
| ------- | ----------------------------------------------------------------------- |
| Nama    | sphinx, singa, nemes (kain kepala), teka-teki, penjaga, gerbang, ambang |
| Tawaran | library, koleksi, unduh, arsip, ambang masuk, kunci                     |
| Sifat   | misterius, tenang, percaya diri, presisi, monolitik, mengawasi          |
| Janji   | "semua game-mu, terjaga di satu tempat"                                 |
| Lawan   | berisik, ramai, lucu, dekoratif, Mesir-turis                            |

**Persilangan yang dipakai:** nemes (kain kepala) × gerbang (masuk ke library) · profil patung × presisi potongan ·
pose duduk × penjaga yang menunggu.

## 5. Arah tanda yang diuji

Tiga jenis berbeda, sengaja:

1. **Abstrak-simetris, vertikal** — kain kepala sebagai gerbang.
2. **Pictorial, asimetris** — profil kepala sebagai patung.
3. **Abstrak, horizontal** — pose duduk sebagai massa rendah.

Ketiganya harus lulus: 16 px, satu warna, terbalik di latar gelap, dan shelf test melawan Hydra/Steam/Epic/GOG.
