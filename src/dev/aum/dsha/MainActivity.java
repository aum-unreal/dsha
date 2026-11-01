package dev.aum.dsha;

import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.view.HapticFeedbackConstants;
import android.webkit.*;
import android.widget.FrameLayout;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

// Native shell for the DSHA web UI. The UI never talks to the network itself:
// every backend call goes through the Bridge below (HTTP + SSE to dsh), which
// also drives Termux (RUN_COMMAND) to start the backend and fetch its token.
public class MainActivity extends Activity {
    private static final String ORIGIN = "https://dsha.local/";
    private static final String TERMUX = "com.termux", RUN = "com.termux.RUN_COMMAND", PERM_RUN = "com.termux.permission.RUN_COMMAND";
    private static final String DSH = "/data/data/com.termux/files/home/.local/bin/dsh", BASH = "/data/data/com.termux/files/usr/bin/bash";
    private static final int REQ_PAIR = 21, REQ_PERM = 22, REQ_NOTIF = 23;
    private WebView web;
    private SharedPreferences prefs;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> streams = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private String pendingShare;
    private boolean ready, visible;
    private Runnable afterPerm;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("dsha", MODE_PRIVATE);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xff000000);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        web.setBackgroundColor(0xff000000);
        web.setVerticalScrollBarEnabled(false);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        web.addJavascriptInterface(new Bridge(), "Native");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView w, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!u.toString().startsWith(ORIGIN)) return new WebResourceResponse("text/plain", "utf-8", 403, "Blocked", null, null);
                String p = u.getPath(); if (p == null || p.equals("/")) p = "/index.html";
                try { return new WebResourceResponse(mime(p), "utf-8", getAssets().open(p.substring(1))); }
                catch (IOException e) { return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, null); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!u.toString().startsWith(ORIGIN)) { try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {} return true; }
                return false;
            }
        });
        handleIntent(getIntent());
        web.loadUrl(ORIGIN + "index.html");
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); handleIntent(i); }
    @Override protected void onResume() { super.onResume(); visible = true; js("window.native&&native.resume&&native.resume()"); }
    @Override protected void onPause() { super.onPause(); visible = false; }
    @Override public void onBackPressed() { js("window.native&&native.back?native.back():0", r -> { if (!"true".equals(r)) super.onBackPressed(); }); }
    @Override protected void onDestroy() { for (HttpURLConnection c : streams.values()) c.disconnect(); pool.shutdownNow(); web.destroy(); super.onDestroy(); }

    private void handleIntent(Intent i) {
        if (i == null || !Intent.ACTION_SEND.equals(i.getAction())) return;
        String t = i.getStringExtra(Intent.EXTRA_TEXT), sub = i.getStringExtra(Intent.EXTRA_SUBJECT);
        if (t == null) return;
        pendingShare = sub != null && !t.contains(sub) ? sub + "\n\n" + t : t;
        if (ready) deliverShare();
    }
    private void deliverShare() { if (pendingShare == null) return; js("native.shared(" + JSONObject.quote(pendingShare) + ")"); pendingShare = null; }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html"; if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css"; if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".woff2")) return "font/woff2"; if (p.endsWith(".png")) return "image/png";
        return "text/plain";
    }

    private void js(String code) { js(code, null); }
    private void js(String code, ValueCallback<String> cb) { main.post(() -> { if (!isDestroyed()) web.evaluateJavascript(code, cb); }); }

    private String base() { return prefs.getString("url", "http://127.0.0.1:8787").replaceAll("/+$", ""); }
    private String token() { return prefs.getString("token", ""); }

    private HttpURLConnection open(String method, String path) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(base() + path).openConnection();
        c.setRequestMethod(method);
        c.setRequestProperty("Authorization", "Bearer " + token());
        c.setConnectTimeout(4000);
        return c;
    }

    private static String readAll(InputStream in) throws IOException {
        if (in == null) return "";
        ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[16384]; int n;
        while ((n = in.read(buf)) > 0) b.write(buf, 0, n);
        return b.toString("UTF-8");
    }

    // Termux runs `dsh start && dsh token` and hands stdout back through a PendingIntent.
    private void pair() {
        if (checkSelfPermission(PERM_RUN) != PackageManager.PERMISSION_GRANTED) {
            afterPerm = this::pair; requestPermissions(new String[]{PERM_RUN}, REQ_PERM); return;
        }
        try {
            Intent i = new Intent(RUN).setClassName(TERMUX, "com.termux.app.RunCommandService");
            i.putExtra("com.termux.RUN_COMMAND_PATH", BASH);
            i.putExtra("com.termux.RUN_COMMAND_ARGUMENTS", new String[]{"-c", DSH + " start >/dev/null 2>&1; " + DSH + " token"});
            i.putExtra("com.termux.RUN_COMMAND_BACKGROUND", true);
            PendingIntent pi = createPendingResult(REQ_PAIR, new Intent(), PendingIntent.FLAG_ONE_SHOT | PendingIntent.FLAG_MUTABLE);
            i.putExtra("com.termux.RUN_COMMAND_PENDING_INTENT", pi);
            startService(i);
        } catch (Exception e) {
            js("native.paired(null," + JSONObject.quote("Could not reach Termux: " + e.getMessage()) + ")");
        }
    }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_PAIR) { super.onActivityResult(req, res, data); return; }
        Bundle r = data == null ? null : data.getBundleExtra("result");
        String out = r == null ? "" : String.valueOf(r.getString("stdout", "")).trim();
        String err = r == null ? "no result from Termux" : String.valueOf(r.getString("stderr", "")).trim() + " " + String.valueOf(r.getString("errmsg", "")).replace("null", "").trim();
        String tok = out.isEmpty() ? "" : out.substring(out.lastIndexOf('\n') + 1).trim();
        if (tok.matches("[A-Za-z0-9_-]{16,}")) {
            prefs.edit().putString("token", tok).putString("url", "http://127.0.0.1:8787").apply();
            js("native.paired(true,null)");
        } else js("native.paired(null," + JSONObject.quote(err.trim().isEmpty() ? "Termux returned no token. Is dsh installed? (" + out + ")" : err.trim()) + ")");
    }

    @Override public void onRequestPermissionsResult(int req, String[] p, int[] g) {
        boolean ok = g.length > 0 && g[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_PERM) {
            Runnable r = afterPerm; afterPerm = null;
            if (ok && r != null) r.run();
            else js("native.paired(null," + JSONObject.quote("DSHA needs the \"Run commands in Termux\" permission to start dsh. Grant it in Android settings → Apps → DSHA → Permissions.") + ")");
        }
    }

    private void notifyUser(String title, String text) {
        if (visible) return;
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != PackageManager.PERMISSION_GRANTED) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("runs", "Agent runs", NotificationManager.IMPORTANCE_DEFAULT));
        PendingIntent pi = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        nm.notify(1, new Notification.Builder(this, "runs").setSmallIcon(R.drawable.ic_stat).setContentTitle(title).setContentText(text).setStyle(new Notification.BigTextStyle().bigText(text)).setContentIntent(pi).setAutoCancel(true).build());
    }

    class Bridge {
        @JavascriptInterface public void ready() { ready = true; main.post(MainActivity.this::deliverShare); }
        @JavascriptInterface public String settings() {
            try { return new JSONObject().put("url", base()).put("token", token()).put("version", BuildConfigVersion()).toString(); } catch (JSONException e) { return "{}"; }
        }
        @JavascriptInterface public void saveSettings(String url, String tok) { prefs.edit().putString("url", url.trim()).putString("token", tok.trim()).apply(); }
        @JavascriptInterface public void pairTermux() { main.post(MainActivity.this::pair); }

        // Async HTTP. Result arrives as native.done(id, status, bodyText).
        @JavascriptInterface public void request(String id, String method, String path, String body) {
            pool.execute(() -> {
                int status = 0; String text;
                try {
                    HttpURLConnection c = open(method, path);
                    c.setReadTimeout(120000);
                    if (body != null && !body.isEmpty()) {
                        c.setDoOutput(true); c.setRequestProperty("Content-Type", "application/json");
                        try (OutputStream o = c.getOutputStream()) { o.write(body.getBytes(StandardCharsets.UTF_8)); }
                    }
                    status = c.getResponseCode();
                    text = readAll(status >= 400 ? c.getErrorStream() : c.getInputStream());
                    c.disconnect();
                } catch (Exception e) { text = "{\"error\":" + JSONObject.quote("Can't reach dsh at " + base() + " (" + e.getClass().getSimpleName() + ")") + "}"; }
                js("native.done(" + JSONObject.quote(id) + "," + status + "," + JSONObject.quote(text) + ")");
            });
        }

        // Server-sent events. Each event JSON → native.ev(id, json); end → native.end(id, error).
        @JavascriptInterface public void stream(String id, String path) {
            pool.execute(() -> {
                String err = null;
                try {
                    HttpURLConnection c = open("GET", path);
                    c.setReadTimeout(60000); // server pings every 15s
                    c.setRequestProperty("Accept", "text/event-stream");
                    streams.put(id, c);
                    int st = c.getResponseCode();
                    if (st != 200) throw new IOException("HTTP " + st + " " + readAll(c.getErrorStream()));
                    BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8));
                    StringBuilder batch = new StringBuilder(); long last = 0; String line;
                    while ((line = r.readLine()) != null) {
                        if (!line.startsWith("data: ")) continue;
                        // Coalesce token deltas into one JS call per ~30ms to keep the UI thread free.
                        batch.append(batch.length() == 0 ? "[" : ",").append(line.substring(6));
                        long now = SystemClock.uptimeMillis();
                        if (now - last > 30 || !r.ready()) { js("native.ev(" + JSONObject.quote(id) + "," + batch + "])"); batch.setLength(0); last = now; }
                    }
                    if (batch.length() > 0) js("native.ev(" + JSONObject.quote(id) + "," + batch + "])");
                } catch (Exception e) { err = e.getClass().getSimpleName() + ": " + e.getMessage(); }
                HttpURLConnection c = streams.remove(id);
                if (c != null) c.disconnect();
                js("native.end(" + JSONObject.quote(id) + "," + (err == null ? "null" : JSONObject.quote(err)) + ")");
            });
        }
        @JavascriptInterface public void cancel(String id) { HttpURLConnection c = streams.remove(id); if (c != null) pool.execute(c::disconnect); }

        @JavascriptInterface public void haptic() { main.post(() -> web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP)); }
        @JavascriptInterface public void copy(String t) { getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("DSHA", t)); }
        @JavascriptInterface public void share(String t) { main.post(() -> startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, t), null))); }
        @JavascriptInterface public void notify(String title, String text) { main.post(() -> notifyUser(title, text)); }
        @JavascriptInterface public void askNotifications() {
            if (Build.VERSION.SDK_INT >= 33) main.post(() -> requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF));
        }
        @JavascriptInterface public boolean visible() { return visible; }
    }

    private String BuildConfigVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }
}
