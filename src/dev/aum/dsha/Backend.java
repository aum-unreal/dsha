package dev.aum.dsha;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.system.Os;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;
import org.json.*;

// DSHA Standalone: dsh runs inside the app. The APK carries Termux's Node as lib/arm64-v8a/libnode.so
// (with its libraries; see build.sh and scripts/prepare-runtime.sh) and dsh's source as assets/dsh.
// This foreground service unpacks dsh into files/, keeps `node dsh.mjs serve` alive on loopback and
// shows the "dsh is running" notification. The Termux build has no libnode.so and never starts it.
public class Backend extends Service {
    static final int PORT = 8788; // a Termux dsh may hold 8787 on the same phone
    static final String STOP = "dev.aum.dsha.STOP_DSH";
    private static java.lang.Process proc;
    private static volatile boolean stopping;
    private static final List<Long> crashes = new ArrayList<>();

    static boolean available(Context c) { return new File(c.getApplicationInfo().nativeLibraryDir, "libnode.so").exists(); }
    static boolean running() { return proc != null && proc.isAlive(); }
    static String url() { return "http://127.0.0.1:" + PORT; }
    static File home(Context c) { return c.getFilesDir(); }
    static File config(Context c) { return new File(home(c), ".dsh/config.json"); }

    // Unpack dsh when this APK differs from the one that unpacked it, and write dsh's config the first time.
    static synchronized void install(Context c) throws Exception {
        File h = home(c), dsh = new File(h, "dsh"), stamp = new File(dsh, ".apk");
        String apk = String.valueOf(c.getPackageManager().getPackageInfo(c.getPackageName(), 0).lastUpdateTime);
        if (!apk.equals(read(stamp))) {
            deleteTree(dsh); copyAssets(c, "dsh", dsh); write(stamp, apk);
        }
        new File(h, "projects").mkdirs();
        // `node` on PATH for the model's scripts: a symlink into nativeLibraryDir, the one place the app may exec from.
        File bin = new File(h, "bin"), node = new File(bin, "node"); bin.mkdirs();
        String target = new File(c.getApplicationInfo().nativeLibraryDir, "libnode.so").getPath();
        try { if (!target.equals(Os.readlink(node.getPath()))) { node.delete(); Os.symlink(target, node.getPath()); } }
        catch (Exception e) { node.delete(); try { Os.symlink(target, node.getPath()); } catch (Exception ignored) {} }
        File cfg = config(c);
        if (!cfg.exists()) {
            byte[] r = new byte[24]; new SecureRandom().nextBytes(r); StringBuilder t = new StringBuilder();
            for (byte x : r) t.append(String.format("%02x", x));
            cfg.getParentFile().mkdirs();
            write(cfg, new JSONObject().put("host", "127.0.0.1").put("port", PORT).put("token", t.toString()).put("cwd", new File(h, "projects").getPath()).toString(1));
        }
    }
    static String token(Context c) { try { return new JSONObject(read(config(c))).getString("token"); } catch (Exception e) { return ""; } }

    static void start(Context c) { stopping = false; c.startForegroundService(new Intent(c, Backend.class)); }
    static void stop(Context c) { c.startService(new Intent(c, Backend.class).setAction(STOP)); }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent i, int flags, int id) {
        if (i != null && STOP.equals(i.getAction())) { stopping = true; kill(); stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY; }
        Notification n = notification();
        if (Build.VERSION.SDK_INT >= 34) startForeground(2, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); else startForeground(2, n);
        if (!running()) new Thread(this::launch, "dsh").start();
        return START_STICKY;
    }

    private Notification notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("backend", "dsh backend", NotificationManager.IMPORTANCE_MIN));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, Backend.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE);
        return new Notification.Builder(this, "backend").setSmallIcon(R.drawable.ic_stat).setContentTitle("dsh is running").setContentText("The agent backend inside DSHA").setContentIntent(open)
            .addAction(new Notification.Action.Builder(null, "Stop", stop).build()).setOngoing(true).build();
    }

    // Runs dsh and restarts it if it dies, unless it keeps dying (5 times in a minute), so a broken unpack can't spin.
    private void launch() {
        try {
            install(this);
            File h = home(this), log = new File(h, ".dsh/dsh.log");
            if (log.length() > 1_000_000) log.delete();
            ProcessBuilder pb = new ProcessBuilder(new File(getApplicationInfo().nativeLibraryDir, "libnode.so").getPath(), new File(h, "dsh/dsh.mjs").getPath(), "serve")
                .directory(h).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.appendTo(log));
            Map<String, String> e = pb.environment();
            e.put("LD_LIBRARY_PATH", getApplicationInfo().nativeLibraryDir);
            e.put("HOME", h.getPath());
            e.put("TMPDIR", getCacheDir().getPath());
            e.put("SHELL", "/system/bin/sh");
            e.put("PATH", new File(h, "bin").getPath() + ":" + e.getOrDefault("PATH", "/system/bin"));
            e.put("DSH_TEMP_ROOTS", getCacheDir().getPath());
            e.put("DSH_STANDALONE", "1");
            synchronized (Backend.class) { if (running()) return; proc = pb.start(); }
            int code = proc.waitFor();
            if (stopping) return;
            long now = System.currentTimeMillis();
            synchronized (crashes) { crashes.add(now); crashes.removeIf(t -> now - t > 60000); if (crashes.size() >= 5) { stopSelf(); return; } }
            append(log, "[DSHA] dsh exited with " + code + ", restarting\n");
            Thread.sleep(1000);
            if (!stopping) launch();
        } catch (Exception ex) {
            try { append(new File(home(this), ".dsh/dsh.log"), "[DSHA] could not start dsh: " + ex + "\n"); } catch (Exception ignored) {}
            stopSelf();
        }
    }

    private static void kill() { java.lang.Process p = proc; proc = null; if (p != null) { p.destroy(); try { if (!p.waitFor(2, java.util.concurrent.TimeUnit.SECONDS)) p.destroyForcibly(); } catch (InterruptedException ignored) {} } }
    @Override public void onDestroy() { stopping = true; kill(); RunService.stopFor(url()); super.onDestroy(); }

    static String read(File f) { try (InputStream in = new FileInputStream(f)) { ByteArrayOutputStream b = new ByteArrayOutputStream(); pipe(in, b); return b.toString("UTF-8"); } catch (IOException e) { return ""; } }
    static String tail(File f, int n) { String s = read(f); return s.length() > n ? s.substring(s.length() - n) : s; }
    static void append(File f, String s) throws IOException { f.getParentFile().mkdirs(); try (OutputStream o = new FileOutputStream(f, true)) { o.write(s.getBytes(StandardCharsets.UTF_8)); } }
    private static void pipe(InputStream in, OutputStream o) throws IOException { byte[] buf = new byte[16384]; int n; while ((n = in.read(buf)) > 0) o.write(buf, 0, n); }
    static void write(File f, String s) throws IOException { f.getParentFile().mkdirs(); try (OutputStream o = new FileOutputStream(f)) { o.write(s.getBytes(StandardCharsets.UTF_8)); } }
    static void deleteTree(File f) { File[] k = f.listFiles(); if (k != null) for (File x : k) deleteTree(x); f.delete(); }
    static void copyAssets(Context c, String path, File dest) throws IOException {
        String[] kids = c.getAssets().list(path);
        if (kids == null || kids.length == 0) { dest.getParentFile().mkdirs(); try (InputStream in = c.getAssets().open(path); OutputStream o = new FileOutputStream(dest)) { pipe(in, o); } return; }
        for (String k : kids) copyAssets(c, path + "/" + k, new File(dest, k));
    }
}
