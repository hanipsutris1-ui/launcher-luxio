package com.luxio.launcher;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.location.Address;
import android.location.Geocoder;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Debug;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.Base64;
import android.view.KeyEvent;
import android.view.SoundEffectConstants;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;

/**
 * Launcher Luxio VARIO: satu layar WebView (assets/www) + jembatan VarioBridge ke sistem head unit.
 * Aset dilayani dari https://appassets.androidplatform.net/ supaya modul JavaScript (three.js) bisa dimuat.
 */
public class MainActivity extends Activity {
    static final String HOST = "appassets.androidplatform.net";
    static final String ROOT = "https://" + HOST + "/";
    static boolean doaPertama = true;

    final Handler h = new Handler(Looper.getMainLooper());
    FrameLayout root;
    WebView web, panel;
    boolean siap, tampil, doaTunggu;
    long layarMati, waktuTunggu;

    SharedPreferences pref;
    LocationManager lm;
    Location akhir;
    float trip, laju, arah;
    double lat, lon;
    long fixTerakhir;
    Location lokasiGeo;

    MediaSessionManager msm;
    MediaController ctl;
    boolean izinMusik;
    String kunciSampul = "", sampulData = "";
    AudioManager am;
    AudioFocusRequest fokus;

    static final int PILIH_GAMBAR = 7;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        pref = getSharedPreferences("luxio", MODE_PRIVATE);
        trip = pref.getFloat("trip", 0f);
        am = (AudioManager) getSystemService(AUDIO_SERVICE);
        getWindow().setStatusBarColor(0xff07090c);
        getWindow().setNavigationBarColor(0xff07090c);

        root = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(0xff07090c);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setVerticalScrollBarEnabled(false);
        web.setHorizontalScrollBarEnabled(false);
        web.setSoundEffectsEnabled(true);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);   // doa berbunyi otomatis saat HU menyala
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        web.addJavascriptInterface(new VarioBridge(), "VarioBridge");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String p = u.getPath();
                if (p == null || p.equals("/")) p = "/index.html";
                try {
                    InputStream in = getAssets().open("www" + p);
                    WebResourceResponse res = new WebResourceResponse(mime(p), mime(p).startsWith("text") || p.endsWith(".js") ? "utf-8" : null, in);
                    java.util.Map<String, String> hd = new java.util.HashMap<>();
                    hd.put("Cache-Control", "no-cache");
                    hd.put("Access-Control-Allow-Origin", "*");
                    res.setResponseHeaders(hd);
                    return res;
                } catch (Exception e) {
                    return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
                }
            }
            @Override public void onPageFinished(WebView v, String url) {
                siap = true;
                kirimGps(); kirimMedia(true); kirimHome();
                if (doaPertama) doaPertama = false;   // doa pertama diputar oleh halaman setelah mobil dimuat
            }
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                if (HOST.equals(r.getUrl().getHost())) return false;
                bukaUri(r.getUrl().toString()); return true;
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        web.loadUrl(ROOT + "index.html");

        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        daftar(layarRx, f);
        IntentFilter p = new IntentFilter(Intent.ACTION_PACKAGE_ADDED);
        p.addAction(Intent.ACTION_PACKAGE_REMOVED);
        p.addAction(Intent.ACTION_PACKAGE_CHANGED);
        p.addDataScheme("package");
        daftar(paketRx, p);
        // sinyal lampu kota dari com.tw.service (terbukti di logcat HU, 31 Okt 2026)
        IntentFilter l = new IntentFilter();
        l.addAction("com.zjinnova.zlink.action.OUT_DARK_START");
        l.addAction("com.zjinnova.zlink.action.OUT_DARK_STOP");
        l.addAction("net.easyconn.navi.night");
        l.addAction("net.easyconn.navi.daytime");
        daftar(lampuRx, l);

        if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) mulaiGps();
        else requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION}, 1);
        mulaiMedia();
        h.post(detak);
    }

    void daftar(BroadcastReceiver r, IntentFilter f) {
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(r, f, Context.RECEIVER_EXPORTED);
        else registerReceiver(r, f);
    }

    static String mime(String p) {
        String q = p.toLowerCase(Locale.ROOT);
        if (q.endsWith(".html")) return "text/html";
        if (q.endsWith(".js") || q.endsWith(".mjs")) return "text/javascript";
        if (q.endsWith(".css")) return "text/css";
        if (q.endsWith(".json")) return "application/json";
        if (q.endsWith(".glb")) return "model/gltf-binary";
        if (q.endsWith(".woff2")) return "font/woff2";
        if (q.endsWith(".png")) return "image/png";
        if (q.endsWith(".jpg") || q.endsWith(".jpeg")) return "image/jpeg";
        if (q.endsWith(".webp")) return "image/webp";
        if (q.endsWith(".mp3")) return "audio/mpeg";
        return "application/octet-stream";
    }

    @Override protected void onResume() {
        super.onResume();
        tampil = true;
        if (!izinMusik) mulaiMedia();
        kirimHome();
        if (doaTunggu) {
            doaTunggu = false;
            if (SystemClock.elapsedRealtime() - waktuTunggu < 5 * 60000) js("tampilDoa()");
        }
    }

    @Override protected void onPause() { super.onPause(); tampil = false; }

    @Override protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        if (i != null && i.hasCategory(Intent.CATEGORY_HOME)) js("kembali()");
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { js("kembali()"); }      // launcher tidak boleh tertutup

    @Override public void onRequestPermissionsResult(int k, String[] izin, int[] hasil) {
        if (hasil.length > 0 && hasil[0] == PackageManager.PERMISSION_GRANTED) mulaiGps();
    }

    @Override protected void onActivityResult(int kode, int hasil, Intent data) {
        super.onActivityResult(kode, hasil, data);
        if (kode != PILIH_GAMBAR || hasil != RESULT_OK || data == null || data.getData() == null) return;
        final Uri u = data.getData();
        new Thread(() -> {
            try (InputStream in = getContentResolver().openInputStream(u)) {
                Bitmap bm = BitmapFactory.decodeStream(in);
                if (bm == null) return;
                float sk = Math.min(1f, 1600f / Math.max(bm.getWidth(), bm.getHeight()));
                if (sk < 1f) bm = Bitmap.createScaledBitmap(bm, Math.round(bm.getWidth() * sk), Math.round(bm.getHeight() * sk), true);
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                bm.compress(Bitmap.CompressFormat.JPEG, 85, bo);
                String d = "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
                JSONObject o = new JSONObject(); o.put("type", "wallpaper"); o.put("data", d);
                event(o);
            } catch (Exception e) { }
        }).start();
    }

    @Override protected void onDestroy() {
        h.removeCallbacksAndMessages(null);
        try { unregisterReceiver(layarRx); unregisterReceiver(paketRx); unregisterReceiver(lampuRx); } catch (Exception e) { }
        if (lm != null) lm.removeUpdates(dengarGps);
        if (ctl != null) ctl.unregisterCallback(ctlCb);
        if (msm != null) msm.removeOnActiveSessionsChangedListener(sesiBerubah);
        web.destroy();
        super.onDestroy();
    }

    void js(final String perintah) {
        if (!siap) return;
        h.post(() -> web.evaluateJavascript("try{" + perintah + "}catch(e){}", null));
    }

    void event(JSONObject o) { js("window.vario&&vario.onEvent(" + o + ")"); }

    /* ===== doa: layar menyala lagi setelah mati >= 1 menit ===== */
    void tampilDoa() {
        if (tampil && siap) js("tampilDoa()");
        else { doaTunggu = true; waktuTunggu = SystemClock.elapsedRealtime(); }
    }

    final BroadcastReceiver layarRx = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            if (Intent.ACTION_SCREEN_OFF.equals(i.getAction())) {
                layarMati = SystemClock.elapsedRealtime();
            } else if (layarMati > 0 && SystemClock.elapsedRealtime() - layarMati >= 60000) {
                layarMati = 0;
                h.postDelayed(MainActivity.this::tampilDoa, 800);
            }
        }
    };

    final BroadcastReceiver paketRx = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) { js("window.muatApp&&muatApp()"); }
    };

    final BroadcastReceiver lampuRx = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            String a = i.getAction();
            boolean on = a != null && (a.endsWith("OUT_DARK_START") || a.endsWith(".night"));
            pref.edit().putBoolean("lampu", on).apply();
            try { JSONObject o = new JSONObject(); o.put("type", "lampu"); o.put("on", on); event(o); } catch (Exception e) { }
        }
    };

    /* ===== Home bawaan ===== */
    boolean jadiHome() {
        try {
            ResolveInfo r = getPackageManager().resolveActivity(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY);
            return r != null && r.activityInfo != null && getPackageName().equals(r.activityInfo.packageName);
        } catch (Exception e) { return true; }
    }

    void kirimHome() {
        try { JSONObject o = new JSONObject(); o.put("type", "home"); o.put("isDefault", jadiHome()); event(o); } catch (Exception e) { }
    }

    /* ===== GPS: kecepatan, arah, trip, nama lokasi ===== */
    void mulaiGps() {
        try {
            lm = (LocationManager) getSystemService(LOCATION_SERVICE);
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, dengarGps, Looper.getMainLooper());
        } catch (Exception e) { }
    }

    final LocationListener dengarGps = new LocationListener() {
        @Override public void onLocationChanged(Location l) {
            fixTerakhir = SystemClock.elapsedRealtime();
            laju = l.hasSpeed() ? l.getSpeed() : 0f;
            if (l.hasBearing()) arah = l.getBearing();
            lat = l.getLatitude(); lon = l.getLongitude();
            boolean akurat = !l.hasAccuracy() || l.getAccuracy() <= 30;
            if (akhir != null && akurat && laju * 3.6f >= 3) {
                float d = akhir.distanceTo(l);
                if (d < 2000) { trip += d / 1000f; pref.edit().putFloat("trip", trip).apply(); }
            }
            if (akurat) akhir = l;
            if (lokasiGeo == null || lokasiGeo.distanceTo(l) > 300) { lokasiGeo = l; geocode(lat, lon); }
            kirimGps();
        }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
    };

    void kirimGps() {
        boolean ada = fixTerakhir > 0 && SystemClock.elapsedRealtime() - fixTerakhir < 5000;
        if (!ada) return;
        try {
            JSONObject o = new JSONObject();
            o.put("type", "gps"); o.put("lat", lat); o.put("lon", lon); o.put("speed", laju); o.put("bearing", arah); o.put("trip", trip);
            event(o);
        } catch (Exception e) { }
    }

    static String buang(String s, String awalan) {
        if (s == null) return null;
        return s.regionMatches(true, 0, awalan, 0, awalan.length()) ? s.substring(awalan.length()).trim() : s;
    }

    void geocode(final double glat, final double glon) {
        new Thread(() -> {
            try {
                List<Address> res = new Geocoder(this, new Locale("id", "ID")).getFromLocation(glat, glon, 1);
                if (res == null || res.isEmpty()) return;
                Address a = res.get(0);
                JSONObject o = new JSONObject();
                o.put("type", "place");
                String kec = a.getLocality() != null ? a.getLocality() : a.getSubLocality();
                if (kec != null) o.put("kecamatan", buang(buang(kec, "Kecamatan"), "Kec."));
                String sub = a.getSubAdminArea();
                if (sub != null) {
                    if (sub.toLowerCase(Locale.ROOT).startsWith("kota")) o.put("kota", buang(sub, "Kota"));
                    else o.put("kabupaten", buang(buang(sub, "Kabupaten"), "Kab."));
                }
                if (a.getAdminArea() != null) o.put("provinsi", a.getAdminArea());
                event(o);
            } catch (Exception e) { }   // geocoder butuh internet; tanpa itu launcher memakai lokasi terakhir
        }, "luxio-geocode").start();
    }

    final Runnable detak = new Runnable() {
        @Override public void run() {
            kirimGps();
            if (ctl != null) kirimMedia(false);
            h.postDelayed(this, 1000);
        }
    };

    /* ===== musik: MediaSession aplikasi aktif (perlu izin akses notifikasi) ===== */
    final MediaSessionManager.OnActiveSessionsChangedListener sesiBerubah = this::pilihSesi;

    void mulaiMedia() {
        msm = (MediaSessionManager) getSystemService(MEDIA_SESSION_SERVICE);
        ComponentName cn = new ComponentName(this, PendengarMusik.class);
        try {
            List<MediaController> l = msm.getActiveSessions(cn);
            msm.addOnActiveSessionsChangedListener(sesiBerubah, cn);
            izinMusik = true;
            pilihSesi(l);
        } catch (SecurityException e) {
            izinMusik = false;
            kirimMedia(true);
        }
    }

    void pilihSesi(List<MediaController> l) {
        MediaController pilih = null;
        if (l != null) for (MediaController c : l) {
            PlaybackState st = c.getPlaybackState();
            if (st != null && st.getState() == PlaybackState.STATE_PLAYING) { pilih = c; break; }
            if (pilih == null) pilih = c;
        }
        if (ctl != null && (pilih == null || !ctl.getSessionToken().equals(pilih.getSessionToken()))) {
            ctl.unregisterCallback(ctlCb); ctl = null;
        }
        if (pilih != null && ctl == null) { ctl = pilih; ctl.registerCallback(ctlCb, h); }
        kirimMedia(true);
    }

    final MediaController.Callback ctlCb = new MediaController.Callback() {
        @Override public void onPlaybackStateChanged(PlaybackState s) {
            if (s != null && s.getState() != PlaybackState.STATE_PLAYING && msm != null && izinMusik) {
                try { pilihSesi(msm.getActiveSessions(new ComponentName(MainActivity.this, PendengarMusik.class))); return; } catch (SecurityException e) { }
            }
            kirimMedia(false);
        }
        @Override public void onMetadataChanged(MediaMetadata m) { kirimMedia(true); }
        @Override public void onSessionDestroyed() {
            if (ctl != null) ctl.unregisterCallback(ctlCb);
            ctl = null;
            mulaiMedia();
        }
    };

    static String teks(MediaMetadata m, String... kunci) {
        for (String k : kunci) { CharSequence t = m.getText(k); if (t != null && t.length() > 0) return t.toString(); }
        return "";
    }

    void kirimMedia(boolean sampul) {
        try {
            JSONObject o = new JSONObject();
            o.put("type", "media");
            MediaMetadata m = ctl == null ? null : ctl.getMetadata();
            if (m == null) { o.put("active", false); event(o); return; }
            PlaybackState st = ctl.getPlaybackState();
            boolean main = st != null && st.getState() == PlaybackState.STATE_PLAYING;
            long pos = st == null ? 0 : st.getPosition();
            if (main && st.getLastPositionUpdateTime() > 0)
                pos += (long) ((SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime()) * st.getPlaybackSpeed());
            if (sampul) perbaruiSampul(m);
            o.put("active", true);
            o.put("title", teks(m, MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE));
            o.put("artist", teks(m, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_ALBUM_ARTIST, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, MediaMetadata.METADATA_KEY_ALBUM));
            o.put("dur", Math.max(0, m.getLong(MediaMetadata.METADATA_KEY_DURATION)));
            o.put("pos", Math.max(0, pos));
            o.put("playing", main);
            o.put("app", labelApp(ctl.getPackageName()));
            o.put("pkg", ctl.getPackageName());
            if (sampul) o.put("art", sampulData);
            event(o);
        } catch (Exception e) { }
    }

    void perbaruiSampul(MediaMetadata m) {
        Bitmap art = m.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
        if (art == null) art = m.getBitmap(MediaMetadata.METADATA_KEY_ART);
        String kunci = art == null ? "" : art.getWidth() + "x" + art.getHeight() + ":" + art.getGenerationId() + teks(m, MediaMetadata.METADATA_KEY_TITLE);
        if (kunci.equals(kunciSampul)) return;
        kunciSampul = kunci;
        if (art == null) { sampulData = ""; return; }
        Bitmap kecil = Bitmap.createScaledBitmap(art, 200, 200 * art.getHeight() / Math.max(1, art.getWidth()), true);
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        kecil.compress(Bitmap.CompressFormat.JPEG, 82, bo);
        sampulData = "data:image/jpeg;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
    }

    String labelApp(String pkg) {
        try { PackageManager pm = getPackageManager(); return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString(); }
        catch (Exception e) { return ""; }
    }

    void bukaUri(String u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(u)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); }
        catch (Exception e) { h.post(() -> Toast.makeText(this, "Tidak bisa membuka tautan", Toast.LENGTH_SHORT).show()); }
    }

    boolean buka(String pkg, boolean samping) {
        Intent it = getPackageManager().getLaunchIntentForPackage(pkg);
        if (it == null) return false;
        it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        if (samping) it.addFlags(Intent.FLAG_ACTIVITY_LAUNCH_ADJACENT | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
        final Intent fi = it;
        h.post(() -> { try { startActivity(fi); } catch (Exception e) { } });
        return true;
    }

    static String ikon64(Drawable d) {
        int n = 112;
        Bitmap bm = Bitmap.createBitmap(n, n, Bitmap.Config.ARGB_8888);
        d.setBounds(0, 0, n, n);
        d.draw(new Canvas(bm));
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        bm.compress(Bitmap.CompressFormat.PNG, 100, bo);
        return "data:image/png;base64," + Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP);
    }

    /* ===== panel web YouTube di area kanan ===== */
    void tampilPanel(String url, int x, int y, int w, int hh) {
        float dpr = getResources().getDisplayMetrics().density;
        float sk = web.getScale() > 0 ? web.getScale() : dpr;
        if (panel == null) {
            panel = new WebView(this);
            panel.setBackgroundColor(Color.BLACK);
            WebSettings s = panel.getSettings();
            s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setMediaPlaybackRequiresUserGesture(false);
            panel.setWebViewClient(new WebViewClient());
            panel.setWebChromeClient(new WebChromeClient());
            root.addView(panel);
        }
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(Math.round(w * sk), Math.round(hh * sk));
        lp.leftMargin = Math.round(x * sk); lp.topMargin = Math.round(y * sk);
        panel.setLayoutParams(lp);
        panel.setVisibility(View.VISIBLE);
        if (panel.getUrl() == null) panel.loadUrl(url);
    }

    /** Fungsi yang dipanggil index.html lewat window.VarioBridge */
    class VarioBridge {
        @JavascriptInterface public void openApp(String pkg) {
            if (!buka(pkg, false)) h.post(() -> Toast.makeText(MainActivity.this, "Aplikasi tidak terpasang", Toast.LENGTH_SHORT).show());
        }
        @JavascriptInterface public boolean openSplit(String pkg) { return buka(pkg, true); }
        @JavascriptInterface public void showWebPanel(String url, int x, int y, int w, int hh) { h.post(() -> tampilPanel(url, x, y, w, hh)); }
        @JavascriptInterface public void hideWebPanel() { h.post(() -> { if (panel != null) { panel.setVisibility(View.GONE); panel.onPause(); } }); }

        @JavascriptInterface public String getApps() {
            JSONArray out = new JSONArray();
            try {
                PackageManager pm = getPackageManager();
                Intent q = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> l = new ArrayList<>(pm.queryIntentActivities(q, 0));
                Collections.sort(l, new ResolveInfo.DisplayNameComparator(pm));
                HashSet<String> sudah = new HashSet<>();
                for (ResolveInfo r : l) {
                    String p = r.activityInfo.packageName;
                    if (p.equals(getPackageName()) || !sudah.add(p)) continue;
                    JSONObject o = new JSONObject();
                    o.put("pkg", p);
                    o.put("label", r.loadLabel(pm).toString());
                    o.put("icon", ikon64(r.loadIcon(pm)));
                    out.put(o);
                }
            } catch (Exception e) { }
            return out.toString();
        }

        @JavascriptInterface public void mediaControl(final String k) {
            h.post(() -> {
                if (ctl != null) {
                    MediaController.TransportControls t = ctl.getTransportControls();
                    if ("next".equals(k)) t.skipToNext();
                    else if ("prev".equals(k)) t.skipToPrevious();
                    else if ("pause".equals(k)) t.pause();
                    else t.play();
                } else {
                    if (!izinMusik) { bukaIntent(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)); return; }
                    int kode = "next".equals(k) ? KeyEvent.KEYCODE_MEDIA_NEXT : "prev".equals(k) ? KeyEvent.KEYCODE_MEDIA_PREVIOUS : KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE;
                    am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_DOWN, kode));
                    am.dispatchMediaKeyEvent(new KeyEvent(KeyEvent.ACTION_UP, kode));
                }
            });
        }

        @JavascriptInterface public void pickImage() {
            Intent i = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
            h.post(() -> { try { startActivityForResult(Intent.createChooser(i, "Pilih wallpaper"), PILIH_GAMBAR); } catch (Exception e) { } });
        }

        @JavascriptInterface public void saveSettings(String json) { pref.edit().putString("cfg", json).apply(); }
        @JavascriptInterface public String loadSettings() {
            String s = pref.getString("cfg", null);
            if (s == null) return null;
            try {   // status lampu kota terakhir dari siaran HU ikut dipakai
                JSONObject o = new JSONObject(s);
                if (pref.contains("lampu")) o.put("lampuKota", pref.getBoolean("lampu", false));
                o.put("trip", trip);
                return o.toString();
            } catch (Exception e) { return s; }
        }

        @JavascriptInterface public void resetTrip() { h.post(() -> { trip = 0; akhir = null; pref.edit().putFloat("trip", 0f).apply(); kirimGps(); }); }

        @JavascriptInterface public void duckMusic(boolean on) {
            if (on) {
                fokus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
                am.requestAudioFocus(fokus);
            } else if (fokus != null) { am.abandonAudioFocusRequest(fokus); fokus = null; }
        }

        @JavascriptInterface public String getMemInfo() {
            try {
                ActivityManager a = (ActivityManager) getSystemService(ACTIVITY_SERVICE);
                Debug.MemoryInfo[] mi = a.getProcessMemoryInfo(new int[]{android.os.Process.myPid()});
                return "{\"appMB\":" + (mi[0].getTotalPss() / 1024f) + "}";
            } catch (Exception e) { return null; }
        }

        @JavascriptInterface public void clearCache() { h.post(() -> { web.clearCache(true); web.reload(); }); }
        @JavascriptInterface public boolean isDefaultHome() { return jadiHome(); }
        @JavascriptInterface public void setHome() { bukaIntent(new Intent(Settings.ACTION_HOME_SETTINGS)); }
        @JavascriptInterface public String getVersion() {
            try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return ""; }
        }
        @JavascriptInterface public void klik() { h.post(() -> web.playSoundEffect(SoundEffectConstants.CLICK)); }
    }

    void bukaIntent(final Intent i) {
        h.post(() -> { try { startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); } catch (Exception e) { } });
    }
}
