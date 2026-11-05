package com.luxio.launcher;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.DataInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.zip.GZIPInputStream;

/**
 * Data desa/kelurahan seluruh Indonesia (assets/wilayah.bin.gz, dibuat oleh tools/buat_wilayah.py)
 * untuk mencari kelurahan terdekat dari GPS tanpa internet, lalu mengambil prakiraan cuaca BMKG
 * yang memakai kode kelurahan (adm4).
 */
class Wilayah {
    String[] prov, kab, kecNama, kecKode;
    int[] kabProv, kecKab, lat, lon;
    char[] desaKec, desaAkhir;
    int n;

    static Wilayah muat(Context c) {
        try (InputStream raw = c.getAssets().open("wilayah.bin.gz");
             DataInputStream in = new DataInputStream(new BufferedInputStream(new GZIPInputStream(raw), 65536))) {
            byte[] sig = new byte[4]; in.readFully(sig);
            if (sig[0] != 'L' || sig[3] != '1') return null;
            Wilayah w = new Wilayah();
            int np = in.readUnsignedShort(); w.prov = new String[np];
            for (int i = 0; i < np; i++) w.prov[i] = str(in);
            int nk = in.readUnsignedShort(); w.kab = new String[nk]; w.kabProv = new int[nk];
            for (int i = 0; i < nk; i++) { w.kabProv[i] = in.readUnsignedShort(); w.kab[i] = str(in); }
            int nc = in.readUnsignedShort(); w.kecNama = new String[nc]; w.kecKode = new String[nc]; w.kecKab = new int[nc];
            for (int i = 0; i < nc; i++) { w.kecKab[i] = in.readUnsignedShort(); w.kecKode[i] = str(in); w.kecNama[i] = str(in); }
            w.n = in.readInt(); w.lat = new int[w.n]; w.lon = new int[w.n]; w.desaKec = new char[w.n]; w.desaAkhir = new char[w.n];
            for (int i = 0; i < w.n; i++) { w.lat[i] = in.readInt(); w.lon[i] = in.readInt(); w.desaKec[i] = in.readChar(); w.desaAkhir[i] = in.readChar(); }
            return w;
        } catch (Exception e) { return null; }
    }

    static String str(DataInputStream in) throws Exception {
        byte[] b = new byte[in.readUnsignedShort()]; in.readFully(b); return new String(b, StandardCharsets.UTF_8);
    }

    /** indeks desa terdekat (pencarian linear ±83 ribu titik, cukup cepat untuk sekali per beberapa ratus meter) */
    int terdekat(double la, double lo) {
        int a = (int) Math.round(la * 1e5), b = (int) Math.round(lo * 1e5);
        double kos = Math.cos(Math.toRadians(la));
        int best = -1; double bd = Double.MAX_VALUE;
        for (int i = 0; i < n; i++) {
            double dy = lat[i] - a, dx = (lon[i] - b) * kos, d = dx * dx + dy * dy;
            if (d < bd) { bd = d; best = i; }
        }
        return best;
    }

    String kodeDesa(int i) { return kecKode[desaKec[i]] + "." + String.format(java.util.Locale.ROOT, "%04d", (int) desaAkhir[i]); }

    /** {type:'place', kecamatan, kabupaten|kota, provinsi} */
    JSONObject tempat(int i) throws Exception {
        int c = desaKec[i], k = kecKab[c];
        JSONObject o = new JSONObject();
        o.put("type", "place");
        o.put("kecamatan", kecNama[c]);
        String kb = kab[k];
        if (kb.startsWith("Kota ")) o.put("kota", kb.substring(5));
        else o.put("kabupaten", kb.startsWith("Kabupaten ") ? kb.substring(10) : kb);
        o.put("provinsi", prov[kabProv[k]]);
        o.put("adm4", kodeDesa(i));
        return o;
    }

    /** Prakiraan BMKG terdekat dengan waktu sekarang: {type:'weather', temp, desc, rain, src:'BMKG'} atau null */
    static JSONObject cuacaBmkg(String adm4) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("https://api.bmkg.go.id/publik/prakiraan-cuaca?adm4=" + adm4).openConnection();
            c.setConnectTimeout(8000); c.setReadTimeout(10000);
            c.setRequestProperty("User-Agent", "LuxioVarioLauncher/2");
            if (c.getResponseCode() != 200) return null;
            ByteArrayOutputStream bo = new ByteArrayOutputStream();
            try (InputStream in = c.getInputStream()) { byte[] buf = new byte[8192]; int r; while ((r = in.read(buf)) > 0) bo.write(buf, 0, r); }
            JSONObject j = new JSONObject(bo.toString("UTF-8"));
            JSONArray hari = j.getJSONArray("data").getJSONObject(0).getJSONArray("cuaca");
            long now = System.currentTimeMillis(); JSONObject pilih = null; long beda = Long.MAX_VALUE;
            java.text.SimpleDateFormat f = new java.text.SimpleDateFormat("yyyy-MM-dd HH:mm:ss", java.util.Locale.ROOT);
            f.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            for (int a = 0; a < hari.length(); a++) {
                JSONArray slot = hari.getJSONArray(a);
                for (int b = 0; b < slot.length(); b++) {
                    JSONObject s = slot.getJSONObject(b);
                    long t = f.parse(s.getString("utc_datetime")).getTime();
                    long d = Math.abs(t - now);
                    if (d < beda) { beda = d; pilih = s; }
                }
            }
            if (pilih == null) return null;
            String desc = pilih.optString("weather_desc", "");
            JSONObject o = new JSONObject();
            o.put("type", "weather");
            o.put("temp", pilih.optDouble("t"));
            o.put("desc", desc);
            o.put("rain", desc.toLowerCase(java.util.Locale.ROOT).contains("hujan"));
            o.put("src", "BMKG");
            return o;
        } catch (Exception e) {
            return null;
        } finally { if (c != null) c.disconnect(); }
    }
}
