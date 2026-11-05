# Luxio VARIO Launcher

Launcher Android untuk head unit TopWay TS10 / UIS7862 (Android 12, layar 1280×800) di Daihatsu Luxio VARIO.

- **Tampilan**: `app/src/main/assets/www/` — HTML/JS + three.js, tema showroom gelap dengan mobil 3D (`luxio_vario_hu.glb`).
- **Android**: `app/src/main/java/com/luxio/launcher/MainActivity.java` — WebView layar penuh + jembatan `VarioBridge`
  (aplikasi, MediaSession, GPS & trip, lokasi kecamatan, sinyal lampu kota `OUT_DARK_START/STOP`, wallpaper galeri, bunyi klik sistem).
- Aset dilayani dari `https://appassets.androidplatform.net/` supaya modul JavaScript bisa dimuat.
- **Build**: setiap push ke `main` membangun APK lewat GitHub Actions dan menerbitkannya di Releases.

Mengganti mobil 3D: tukar `app/src/main/assets/www/luxio_vario_hu.glb`, lalu push.

Kredit: suara doa Mishary Rashid Alafasy (everyayah.com) · terjemahan Kemenag RI · cuaca BMKG · three.js (MIT) · huruf Overpass (OFL).
