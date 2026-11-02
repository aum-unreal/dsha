package dev.aum.dsha;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.*;

// Keeps a run going with the phone locked. While dsh has any run live, this foreground service
// holds a partial wake lock (the CPU stays on for dsh, in Termux or built in) and keeps DSHA's
// process out of the cached-app freezer, so the event stream and the end-of-run notification
// survive. The UI starts it when it sees a run; it asks dsh's /api/health every 20 s and stops
// itself once nothing has been running for two checks in a row, so a missed run_end can't leave it on.
public class RunService extends Service {
    private static final String TAG = "dsh:run";
    private static volatile String base = "", token = "";
    private PowerManager.WakeLock lock;
    private final Handler h = new Handler(Looper.getMainLooper());
    private int idle;
    private Thread checker;

    static void start(Context c, String url, String tok) {
        base = url; token = tok;
        try { c.startForegroundService(new Intent(c, RunService.class)); } catch (Exception e) { android.util.Log.w("DSHA", "run service", e); }
    }

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent i, int flags, int id) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("working", "Run in progress", NotificationManager.IMPORTANCE_LOW));
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE);
        Notification n = new Notification.Builder(this, "working").setSmallIcon(R.drawable.ic_stat).setContentTitle("dsh is working")
            .setContentText("Keeps running with the screen off").setContentIntent(open).setOngoing(true).build();
        if (Build.VERSION.SDK_INT >= 34) startForeground(3, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE); else startForeground(3, n);
        if (lock == null) {
            lock = getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, TAG);
            lock.setReferenceCounted(false);
        }
        lock.acquire(6 * 3600_000L); // a ceiling, not the expected length: the checks release it
        idle = 0;
        if (checker == null) { checker = new Thread(this::watch, "dsh-run-watch"); checker.start(); }
        return START_NOT_STICKY;
    }

    private void watch() {
        try {
            while (!Thread.interrupted()) {
                Thread.sleep(20_000);
                Boolean live = live();
                if (live == null || live) idle = 0; // dsh unreachable: keep waiting rather than drop a run mid-step
                else if (++idle >= 2) { h.post(this::stopSelf); return; }
            }
        } catch (InterruptedException ignored) {}
    }

    // true/false from dsh's health check; null when dsh can't be reached.
    private static Boolean live() {
        try {
            HttpURLConnection c = (HttpURLConnection) new URL(base + "/api/health").openConnection();
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setConnectTimeout(4000); c.setReadTimeout(8000);
            if (c.getResponseCode() != 200) return null;
            ByteArrayOutputStream b = new ByteArrayOutputStream(); byte[] buf = new byte[4096]; int n;
            try (InputStream in = c.getInputStream()) { while ((n = in.read(buf)) > 0) b.write(buf, 0, n); }
            JSONArray r = new JSONObject(b.toString("UTF-8")).optJSONArray("running");
            return r != null && r.length() > 0;
        } catch (Exception e) { return null; }
    }

    @Override public void onDestroy() {
        if (checker != null) checker.interrupt();
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }
}
