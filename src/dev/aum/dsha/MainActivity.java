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
public class MainActivity extends Activity implements android.hardware.SensorEventListener {
    private static final String ORIGIN = "https://dsha.local/";
    private static final String TERMUX = "com.termux", RUN = "com.termux.RUN_COMMAND", PERM_RUN = "com.termux.permission.RUN_COMMAND";
    private static final String DSH = "/data/data/com.termux/files/home/.local/bin/dsh", BASH = "/data/data/com.termux/files/usr/bin/bash";
    private static final int REQ_PAIR = 21, REQ_PERM = 22, REQ_NOTIF = 23;
    private WebView web;
    // The preview pane is a second WebView laid over the Inspector's page area. It has
    // no JavascriptInterface at all: a previewed page must never reach the dsh bridge,
    // the bearer token or the UI's storage. It is shown only in the unfolded layout,
    // positioned from the rect the web UI measures for #previewHost.
    private WebView preview;
    private boolean previewCanBack;
    private FrameLayout root;
    private SharedPreferences prefs;
    // DSHA Standalone carries its own dsh (see Backend); "backend" = builtin or termux picks which one the UI talks to.
    private boolean standalone;
    private boolean builtin() { return standalone && !"termux".equals(prefs.getString("backend", "builtin")); }
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> streams = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());
    private String pendingShare;
    private boolean ready, visible;
    private long pausedAt;
    private Runnable afterPerm;
    private android.hardware.SensorManager sensors;
    private android.hardware.Sensor hinge;
    private float hingeAngle = -1, sentAngle = -2;
    private String sentGeom = "";

    // The web UI's theme (system, dark or light) drives the window behind it and the system bar icons.
    private void applyBars(boolean dark) {
        int bg = dark ? 0xff000000 : 0xffffffff;
        root.setBackgroundColor(bg); if (web != null) web.setBackgroundColor(bg);
        if (preview != null) preview.setBackgroundColor(bg);
        android.view.Window w = getWindow();
        w.setStatusBarColor(bg); w.setNavigationBarColor(bg);
        if (Build.VERSION.SDK_INT >= 30) {
            android.view.WindowInsetsController c = w.getInsetsController();
            int m = android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
            if (c != null) c.setSystemBarsAppearance(dark ? 0 : m, m);
        } else {
            android.view.View d = w.getDecorView();
            int m = android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            d.setSystemUiVisibility(dark ? d.getSystemUiVisibility() & ~m : d.getSystemUiVisibility() | m);
        }
        prefs.edit().putBoolean("dark", dark).apply();
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("dsha", MODE_PRIVATE);
        standalone = Backend.available(this);
        if (builtin()) { try { Backend.install(this); } catch (Exception e) { android.util.Log.e("DSHA", "dsh unpack failed", e); } Backend.start(this); }
        root = new FrameLayout(this);
        root.setBackgroundColor(0xff000000);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            v.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets.consumeSystemWindowInsets();
        });
        web = new WebView(this);
        web.setBackgroundColor(0xff000000);
        web.setVerticalScrollBarEnabled(false);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        preview = buildPreview();
        FrameLayout.LayoutParams plp = new FrameLayout.LayoutParams(1, 1);
        preview.setVisibility(android.view.View.GONE);
        root.addView(preview, plp);
        setContentView(root);
        applyBars(prefs.getBoolean("dark", true));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportZoom(false);
        web.addJavascriptInterface(new Bridge(), "Native");
        // Keep the renderer at the app's own priority when the screen is off. During a run RunService
        // makes that a foreground-service priority, so Android doesn't reap the chat mid-run.
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        web.setWebViewClient(new WebViewClient() {
            // If Android kills the renderer anyway, rebuild the Activity (the UI reloads the session
            // from dsh) instead of letting the default handling take the whole app down.
            @Override public boolean onRenderProcessGone(WebView w, RenderProcessGoneDetail d) {
                android.util.Log.w("DSHA", "renderer gone, crashed=" + d.didCrash());
                if (w == web) { root.removeView(web); web.destroy(); web = null; ready = false; main.post(MainActivity.this::recreate); }
                return true;
            }
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
        sensors = getSystemService(android.hardware.SensorManager.class);
        if (Build.VERSION.SDK_INT >= 30 && sensors != null) hinge = sensors.getDefaultSensor(android.hardware.Sensor.TYPE_HINGE_ANGLE);
        web.addOnLayoutChangeListener((v, l, t, r, b, ol, ot, or, ob) -> sendPosture(true));
        handleIntent(getIntent());
        web.loadUrl(ORIGIN + "index.html");
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); handleIntent(i); }
    @Override protected void onResume() {
        super.onResume(); visible = true; if (builtin() && !Backend.running()) Backend.start(this); if (preview != null) preview.onResume(); long away = pausedAt > 0 ? SystemClock.elapsedRealtime() - pausedAt : 0; js("window.native&&native.resume&&native.resume(" + away + ")");
        if (hinge != null) sensors.registerListener(this, hinge, android.hardware.SensorManager.SENSOR_DELAY_UI);
        sendPosture(true);
    }
    @Override protected void onPause() { super.onPause(); visible = false; pausedAt = SystemClock.elapsedRealtime(); if (preview != null) preview.onPause(); if (hinge != null) sensors.unregisterListener(this); }

    // Fold posture for the UI: hinge angle (TYPE_HINGE_ANGLE, -1 when the device has
    // none) plus the physical screen centre in WebView CSS pixels, which is where a
    // book-style fold's hinge sits. The UI decides between cover/dual-pane/tabletop.
    @Override public void onSensorChanged(android.hardware.SensorEvent e) { hingeAngle = e.values[0]; sendPosture(false); }
    @Override public void onAccuracyChanged(android.hardware.Sensor s, int a) {}
    private void sendPosture(boolean force) {
        if (!ready || web == null) return;
        if (!force && Math.abs(hingeAngle - sentAngle) < 4) return;
        int[] loc = new int[2]; web.getLocationOnScreen(loc);
        int sw, sh;
        if (Build.VERSION.SDK_INT >= 30) { android.graphics.Rect b = getWindowManager().getMaximumWindowMetrics().getBounds(); sw = b.width(); sh = b.height(); }
        else { android.util.DisplayMetrics m = new android.util.DisplayMetrics(); getWindowManager().getDefaultDisplay().getRealMetrics(m); sw = m.widthPixels; sh = m.heightPixels; }
        float d = getResources().getDisplayMetrics().density;
        String geom = Math.round((sw / 2f - loc[0]) / d) + "," + Math.round((sh / 2f - loc[1]) / d);
        if (!force && geom.equals(sentGeom) && Math.abs(hingeAngle - sentAngle) < 4) return;
        sentAngle = hingeAngle; sentGeom = geom;
        js("window.native&&native.posture&&native.posture(" + (hinge == null ? -1 : Math.round(hingeAngle)) + "," + geom + ")");
    }
    @Override public void onBackPressed() { js("window.native&&native.back?native.back():0", r -> { if (!"true".equals(r)) super.onBackPressed(); }); }
    @Override protected void onDestroy() { for (HttpURLConnection c : streams.values()) c.disconnect(); pool.shutdownNow(); if (web != null) web.destroy(); if (preview != null) preview.destroy(); super.onDestroy(); }

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
        if (p.endsWith(".woff2")) return "font/woff2"; if (p.endsWith(".ttf")) return "font/ttf"; if (p.endsWith(".png")) return "image/png";
        return "text/plain";
    }

    private void js(String code) { js(code, null); }
    private void js(String code, ValueCallback<String> cb) { main.post(() -> { if (!isDestroyed() && web != null) web.evaluateJavascript(code, cb); }); }

    // ---------- the preview pane ----------
    // A plain WebView: http/https only, no file://, no content://, no bridge. Pages previewed
    // here are arbitrary code, so it gets less power than the chat view, not more.
    private WebView buildPreview() {
        WebView v = new WebView(this);
        v.setBackgroundColor(0xff000000);
        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE); // dev servers pull http assets
        v.setWebViewClient(new WebViewClient() {
            @Override public boolean onRenderProcessGone(WebView w, RenderProcessGoneDetail d) {
                if (w == preview) { root.removeView(preview); preview.destroy(); preview = buildPreview(); preview.setVisibility(android.view.View.GONE); root.addView(preview, new FrameLayout.LayoutParams(1, 1)); }
                return true;
            }
            @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest req) {
                Uri u = req.getUrl();
                String scheme = u == null ? null : u.getScheme();
                if ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) {}
                return true;
            }
            @Override public void onPageStarted(WebView w, String url, android.graphics.Bitmap icon) { postPreviewState(url, true); }
            @Override public void onPageFinished(WebView w, String url) { postPreviewState(url, false); }
            @Override public void onReceivedError(WebView w, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) js("window.native&&native.previewError&&native.previewError(" + JSONObject.quote(String.valueOf(err.getDescription())) + ")");
            }
        });
        v.setWebChromeClient(new WebChromeClient() {
            @Override public void onReceivedTitle(WebView w, String title) { js("window.native&&native.previewTitle&&native.previewTitle(" + JSONObject.quote(title == null ? "" : title) + ")"); }
            @Override public boolean onConsoleMessage(ConsoleMessage m) {
                js("window.native&&native.previewConsole&&native.previewConsole(" + JSONObject.quote(m.message() == null ? "" : m.message()) + "," + JSONObject.quote(String.valueOf(m.messageLevel())) + ")");
                return true;
            }
        });
        return v;
    }
    private void postPreviewState(String url, boolean loading) {
        if (preview != null) previewCanBack = preview.canGoBack();
        js("window.native&&native.previewState&&native.previewState(" + JSONObject.quote(url == null ? "" : url) + "," + previewCanBack + "," + loading + ")");
    }
    private static boolean previewable(String url) {
        if (url == null) return false;
        Uri u = Uri.parse(url);
        String scheme = u.getScheme();
        return ("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && u.getHost() != null;
    }

    private String base() { return builtin() ? Backend.url() : prefs.getString("url", "http://127.0.0.1:8787").replaceAll("/+$", ""); }
    private String token() { return builtin() ? Backend.token(this) : prefs.getString("token", ""); }

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
            prefs.edit().putString("token", tok).putString("url", "http://127.0.0.1:8787").putString("backend", "termux").apply();
            if (standalone) Backend.stop(this);
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
        @JavascriptInterface public void ready() { ready = true; main.post(() -> { deliverShare(); sendPosture(true); }); }
        @JavascriptInterface public String settings() {
            try {
                return new JSONObject().put("url", base()).put("token", token()).put("version", BuildConfigVersion())
                    .put("standalone", standalone).put("backend", builtin() ? "builtin" : "termux").put("running", Backend.running())
                    .put("allFiles", Build.VERSION.SDK_INT >= 30 && Environment.isExternalStorageManager()).toString();
            } catch (JSONException e) { return "{}"; }
        }
        // Standalone only: switch between the built-in dsh and one in Termux, restart it, read its log, grant file access.
        @JavascriptInterface public void setBackend(String b) {
            if (!standalone) return;
            prefs.edit().putString("backend", "termux".equals(b) ? "termux" : "builtin").apply();
            if (builtin()) { try { Backend.install(MainActivity.this); } catch (Exception ignored) {} Backend.start(MainActivity.this); } else Backend.stop(MainActivity.this);
        }
        @JavascriptInterface public void restartBackend() {
            if (!builtin()) return;
            Backend.stop(MainActivity.this);
            main.postDelayed(() -> Backend.start(MainActivity.this), 1500);
        }
        @JavascriptInterface public String backendLog() { return Backend.tail(new File(getFilesDir(), ".dsh/dsh.log"), 3000); }
        @JavascriptInterface public void askAllFiles() {
            if (Build.VERSION.SDK_INT < 30) return;
            main.post(() -> { try { startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getPackageName()))); }
                catch (Exception e) { startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)); } });
        }
        @JavascriptInterface public void saveSettings(String url, String tok) { SharedPreferences.Editor e = prefs.edit().putString("url", url.trim()).putString("token", tok.trim()); if (standalone) { e.putString("backend", "termux"); Backend.stop(MainActivity.this); } e.apply(); }
        @JavascriptInterface public void pairTermux() { main.post(MainActivity.this::pair); }
        @JavascriptInterface public void theme(boolean dark) { main.post(() -> applyBars(dark)); }

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
                    // Coalesce token deltas into one JS call per ~30ms to keep the UI thread free.
                    String q = JSONObject.quote(id);
                    Sse.pump(r, batch -> js("native.ev(" + q + "," + batch + ")"), 30);
                } catch (Exception e) { err = e.getClass().getSimpleName() + ": " + e.getMessage(); }
                HttpURLConnection c = streams.remove(id);
                if (c != null) c.disconnect();
                js("native.end(" + JSONObject.quote(id) + "," + (err == null ? "null" : JSONObject.quote(err)) + ")");
            });
        }
        @JavascriptInterface public void cancel(String id) { HttpURLConnection c = streams.remove(id); if (c != null) pool.execute(c::disconnect); }

        @JavascriptInterface public void haptic() { main.post(() -> { if (web != null) web.performHapticFeedback(HapticFeedbackConstants.KEYBOARD_TAP); }); }
        @JavascriptInterface public void copy(String t) { getSystemService(ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("DSHA", t)); }
        @JavascriptInterface public void share(String t) { main.post(() -> startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, t), null))); }
        @JavascriptInterface public void notify(String title, String text) { main.post(() -> notifyUser(title, text)); }
        @JavascriptInterface public void askNotifications() {
            if (Build.VERSION.SDK_INT >= 33) main.post(() -> requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, REQ_NOTIF));
        }
        // Preview pane: the web UI measures #previewHost in CSS px and passes the rect.
        @JavascriptInterface public boolean previewShow(int left, int top, int width, int height) {
            if (preview == null || width < 1 || height < 1) return false;
            float d = getResources().getDisplayMetrics().density;
            main.post(() -> {
                FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) preview.getLayoutParams();
                lp.leftMargin = Math.round(left * d); lp.topMargin = Math.round(top * d);
                lp.width = Math.max(1, Math.round(width * d)); lp.height = Math.max(1, Math.round(height * d));
                preview.setLayoutParams(lp);
                preview.setVisibility(android.view.View.VISIBLE);
            });
            return true;
        }
        @JavascriptInterface public void previewHide() { main.post(() -> { if (preview != null) preview.setVisibility(android.view.View.GONE); }); }
        @JavascriptInterface public boolean previewOpen(String url) {
            if (preview == null || !previewable(url)) return false;
            main.post(() -> preview.loadUrl(url));
            return true;
        }
        @JavascriptInterface public void previewReload() { main.post(() -> { if (preview != null && preview.getUrl() != null) preview.reload(); }); }
        @JavascriptInterface public boolean previewBack() {
            if (preview == null || !previewCanBack) return false;
            main.post(() -> { if (preview.canGoBack()) preview.goBack(); });
            return true;
        }
        @JavascriptInterface public void previewExternal(String url) {
            if (!previewable(url)) return;
            main.post(() -> { try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); } catch (Exception ignored) {} });
        }
        @JavascriptInterface public boolean visible() { return visible; }
        // A run is live: hold the CPU and keep this process unfrozen until dsh goes idle (see RunService).
        @JavascriptInterface public void keepAwake() { RunService.start(MainActivity.this, base(), token()); }
        @JavascriptInterface public boolean batteryExempt() { return getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getPackageName()); }
        @JavascriptInterface public void askBatteryExempt() {
            main.post(() -> { try { startActivity(new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName()))); }
                catch (Exception e) { try { startActivity(new Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); } catch (Exception ignored) {} } });
        }
    }

    private String BuildConfigVersion() {
        try { return getPackageManager().getPackageInfo(getPackageName(), 0).versionName; } catch (Exception e) { return "?"; }
    }
}
