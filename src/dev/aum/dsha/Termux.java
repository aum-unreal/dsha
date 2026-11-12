package dev.aum.dsha;

import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.provider.MediaStore;
import android.system.Os;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import org.json.JSONObject;

// DSHA Standalone's own Termux ("route L", kb decision dsha/0004). The Standalone app id, dev.aum.ds, is exactly as
// long as com.termux, so the official bootstrap (assets/termux/bootstrap-aarch64.zip, from scripts/prepare-runtime.sh)
// unpacks at files/usr with every "/data/data/com.termux" swapped byte for byte for "/data/data/dev.aum.ds".
// Android won't execve files in app storage but lets /system/bin/linker64 map them: bash starts as `linker64 bash`
// (dsh's sh() in tools.mjs does the same) and termux-exec's linker preload sends every later exec through linker64.
// apt's .debs are repacked for this prefix by a dpkg wrapper (assets/termux/tx-dpkg). proot ships in the APK as
// libproot.so with its loader (files/tx-bin/proot shims it), so proot-distro's distributions run too.
// First start: unpack (local, no network), then the bootstrap's second stage, apt update and the base packages, in
// the background. dsh keeps working meanwhile; its shell is Android's sh until bin/bash exists.
final class Termux {
    static final String OLD = "/data/data/com.termux";
    static final String PKGS = "git gh proot proot-distro";
    static final String SETUP = "1"; // bump to rerun the package step on existing installs
    private static Thread worker;

    static boolean supported(Context c) {
        if (c.getPackageName().length() != "com.termux".length()) return false;
        try { return new File(data(c), "files").getCanonicalPath().equals(c.getFilesDir().getCanonicalPath()) && c.getAssets().list("termux").length > 0; }
        catch (IOException e) { return false; }
    }
    static String data(Context c) { return "/data/data/" + c.getPackageName(); }
    static File usr(Context c) { return new File(c.getFilesDir(), "usr"); }
    static File bin(Context c) { return new File(c.getFilesDir(), "tx-bin"); }
    static File state(Context c) { return new File(c.getFilesDir(), ".dsh/termux.json"); }
    static File log(Context c) { return new File(c.getFilesDir(), ".dsh/termux-setup.log"); }

    // What dsh's process gets on top of its own environment; tools.mjs builds the bash tool's environment from it.
    static void env(Context c, Map<String, String> e) {
        if (!supported(c)) return;
        String lib = c.getApplicationInfo().nativeLibraryDir;
        e.put("DSH_TERMUX_PREFIX", usr(c).getPath());
        e.put("DSH_TERMUX_BIN", bin(c).getPath());
        e.put("PROOT_LOADER", lib + "/libproot-loader.so");
        e.put("PROOT_TMP_DIR", c.getCacheDir().getPath());
        e.put("DSH_TEMP_ROOTS", c.getCacheDir().getPath() + ":" + new File(usr(c), "tmp").getPath());
    }

    static synchronized void setup(Context c) {
        if (worker != null && worker.isAlive()) return;
        Context app = c.getApplicationContext();
        worker = new Thread(() -> run(app), "termux-setup");
        worker.start();
    }

    private static void run(Context c) {
        if (!supported(c)) { status(c, "unsupported", "This build or user profile can't host Termux (needs app id length 10 and /data/data/" + c.getPackageName() + ")."); return; }
        try {
            File usr = usr(c);
            if (!new File(usr, "bin/bash").exists()) {
                status(c, "unpacking", "Unpacking the Termux bootstrap");
                long t0 = System.currentTimeMillis();
                int[] n = unpack(c, usr);
                say(c, "unpacked " + n[0] + " files (" + n[2] + " patched), " + n[1] + " symlinks in " + (System.currentTimeMillis() - t0) / 1000 + " s");
            }
            new File(usr, "tmp").mkdirs();
            new File(data(c), "cache/apt/archives/partial").mkdirs();
            wrapper(c, usr);
            shims(c);
            if (SETUP.equals(Backend.read(new File(usr, ".dsha-setup")).trim())) { status(c, "ready", "Termux is set up"); return; }
            status(c, "installing", "Installing " + PKGS);
            String[] r = bash(c, "$PREFIX/etc/termux/termux-bootstrap/second-stage/termux-bootstrap-second-stage.sh 2>&1 | tail -n 3; dpkg --configure -a;"
                + " apt-get update && apt-get install -y -o Dpkg::Options::=--force-confnew " + PKGS, 3600);
            if (!"0".equals(r[0])) { status(c, "failed", "Package install failed (exit " + r[0] + "); see ~/.dsh/termux-setup.log. It is retried on the next start."); return; }
            Backend.write(new File(usr, ".dsha-setup"), SETUP);
            status(c, "ready", "Termux is set up");
        } catch (Throwable t) {
            status(c, "failed", String.valueOf(t));
        }
    }

    // The bootstrap zip: a tree plus SYMLINKS.txt of "target←link" lines. Unpacked beside usr and renamed into place,
    // so bin/bash existing means the prefix is whole.
    private static int[] unpack(Context c, File usr) throws Exception {
        File part = new File(usr.getPath() + ".part");
        Backend.deleteTree(part); Backend.deleteTree(usr); part.mkdirs();
        byte[] from = OLD.getBytes(StandardCharsets.US_ASCII), to = data(c).getBytes(StandardCharsets.US_ASCII);
        if (from.length != to.length) throw new IllegalStateException("prefix length differs");
        int nf = 0, np = 0, nl = 0; List<String> links = new ArrayList<>();
        try (ZipInputStream z = new ZipInputStream(new BufferedInputStream(c.getAssets().open("termux/bootstrap-aarch64.zip"), 1 << 16))) {
            ZipEntry en;
            while ((en = z.getNextEntry()) != null) {
                if (en.getName().equals("SYMLINKS.txt")) { links.addAll(Arrays.asList(new String(z.readAllBytes(), StandardCharsets.UTF_8).split("\n"))); continue; }
                File f = new File(part, en.getName());
                if (!f.getCanonicalPath().startsWith(part.getCanonicalPath() + File.separator)) continue;
                if (en.isDirectory()) { f.mkdirs(); continue; }
                f.getParentFile().mkdirs();
                byte[] d = z.readAllBytes();
                if (replace(d, from, to)) np++;
                try (OutputStream o = new FileOutputStream(f)) { o.write(d); }
                Os.chmod(f.getPath(), 0700); nf++;
            }
        }
        String old = OLD, now = data(c);
        for (String l : links) {
            int a = l.indexOf('←'); if (a < 0) continue;
            File link = new File(part, l.substring(a + 1).trim());
            link.getParentFile().mkdirs(); link.delete();
            Os.symlink(l.substring(0, a).replace(old, now), link.getPath()); nl++;
        }
        if (!part.renameTo(usr)) throw new IOException("could not move the prefix into place");
        Backend.write(new File(usr, ".dsha-bootstrap"), "bootstrap-2026.11.01-r1+apt.android-7");
        return new int[]{ nf, nl, np };
    }

    private static boolean replace(byte[] d, byte[] from, byte[] to) {
        boolean hit = false;
        outer:
        for (int i = 0; i <= d.length - from.length; i++) {
            if (d[i] != from[0]) continue;
            for (int j = 1; j < from.length; j++) if (d[i + j] != from[j]) continue outer;
            System.arraycopy(to, 0, d, i, to.length); hit = true; i += from.length - 1;
        }
        return hit;
    }

    // apt hands dpkg .debs built for com.termux; the wrapper repacks them for this prefix, then runs the real dpkg.
    private static void wrapper(Context c, File usr) throws IOException {
        String s;
        try (InputStream in = c.getAssets().open("termux/tx-dpkg")) { s = new String(in.readAllBytes(), StandardCharsets.UTF_8); }
        File w = new File(usr, "libexec/tx-dpkg");
        Backend.write(w, s.replace("@NEW@", data(c)).replace("@OLD@", OLD));
        try { Os.chmod(w.getPath(), 0700); } catch (Exception ignored) {}
        Backend.write(new File(usr, "etc/apt/apt.conf.d/99-dsha"), "Dir::Bin::dpkg \"" + usr.getPath() + "/libexec/tx-dpkg\";\n");
    }

    // files/tx-bin comes first on the bash tool's PATH. proot: the APK's copy (Termux's own can't exec its loader from
    // app storage), without termux-exec's preload, which would turn the guest's execs into linker64 runs.
    private static void shims(Context c) throws IOException {
        String lib = c.getApplicationInfo().nativeLibraryDir;
        File p = new File(bin(c), "proot");
        Backend.write(p, "#!/system/bin/sh\nunset LD_PRELOAD\nexport PROOT_LOADER=" + lib + "/libproot-loader.so\nexec " + lib + "/libproot.so \"$@\"\n");
        try { Os.chmod(p.getPath(), 0700); } catch (Exception ignored) {}
    }

    // A bash -c run with the same environment tools.mjs gives the agent's bash tool. Output goes to the setup log.
    static String[] bash(Context c, String script, int timeoutS) throws Exception {
        String pre = usr(c).getPath(), lib = c.getApplicationInfo().nativeLibraryDir;
        ProcessBuilder pb = new ProcessBuilder("/system/bin/linker64", pre + "/bin/bash", "-c", script).directory(c.getFilesDir()).redirectErrorStream(true)
            .redirectOutput(ProcessBuilder.Redirect.appendTo(log(c)));
        Map<String, String> e = pb.environment();
        e.put("HOME", c.getFilesDir().getPath()); e.put("PREFIX", pre); e.put("TMPDIR", pre + "/tmp");
        e.put("PATH", bin(c).getPath() + ":" + pre + "/bin:" + new File(c.getFilesDir(), "bin").getPath() + ":/system/bin");
        e.put("LD_LIBRARY_PATH", lib); e.put("LANG", "en_US.UTF-8"); e.put("TERM", "dumb"); e.put("DEBIAN_FRONTEND", "noninteractive");
        e.put("LD_PRELOAD", pre + "/lib/libtermux-exec-linker-ld-preload.so"); e.put("TERMUX_EXEC__SYSTEM_LINKER_EXEC__MODE", "force");
        e.put("TERMUX__PREFIX", pre); e.put("TERMUX__ROOTFS", c.getFilesDir().getPath()); e.put("TERMUX_APP__DATA_DIR", data(c));
        e.put("TERMUX__SE_PROCESS_CONTEXT", "u:r:untrusted_app:s0");
        e.put("PROOT_LOADER", lib + "/libproot-loader.so"); e.put("PROOT_TMP_DIR", c.getCacheDir().getPath());
        log(c).getParentFile().mkdirs();
        Backend.append(log(c), "\n== " + new Date() + " $ " + script + "\n");
        Process p = pb.start();
        boolean done = p.waitFor(timeoutS, TimeUnit.SECONDS);
        if (!done) p.destroyForcibly();
        return new String[]{ done ? String.valueOf(p.exitValue()) : "timeout" };
    }

    private static void say(Context c, String s) { try { Backend.append(log(c), "[DSHA] " + s + "\n"); } catch (IOException ignored) {} }
    private static void status(Context c, String state, String detail) {
        say(c, state + ": " + detail);
        try { Backend.write(state(c), new JSONObject().put("state", state).put("detail", detail).put("packages", PKGS).put("at", System.currentTimeMillis()).toString(1)); } catch (Exception ignored) {}
    }

    // Self-check (MainActivity, `--ez selfcheck true`): runs assets/termux/selfcheck.sh through dsh's own shell code
    // (tools.mjs sh() under the bundled node, with dsh's environment) and saves the output to Download/.
    static void selfCheck(Context c, Map<String, String> dshEnv) {
        new Thread(() -> {
            StringBuilder out = new StringBuilder("DSHA Standalone self-check · " + new Date() + " · " + c.getPackageName() + "\n");
            try {
                File script = new File(c.getCacheDir(), "selfcheck.sh");
                try (InputStream in = c.getAssets().open("termux/selfcheck.sh")) { Backend.write(script, new String(in.readAllBytes(), StandardCharsets.UTF_8)); }
                String lib = c.getApplicationInfo().nativeLibraryDir, tools = new File(c.getFilesDir(), "dsh/lib/tools.mjs").getPath();
                String js = "const {sh}=await import(" + JSONObject.quote(tools) + ");const fs=await import('node:fs');"
                    + "const r=await sh(fs.readFileSync(" + JSONObject.quote(script.getPath()) + ",'utf8'),{cwd:process.env.HOME,timeout:3600});"
                    + "process.stdout.write(r.out+(r.killed?'\\n'+r.killed:'')+'\\nexit '+r.code+'\\n');";
                ProcessBuilder pb = new ProcessBuilder(lib + "/libnode.so", "--input-type=module", "-e", js).directory(c.getFilesDir()).redirectErrorStream(true);
                pb.environment().putAll(dshEnv);
                Process p = pb.start();
                try (InputStream in = p.getInputStream()) { out.append(new String(in.readAllBytes(), StandardCharsets.UTF_8)); }
                p.waitFor(70, TimeUnit.MINUTES);
            } catch (Throwable t) { out.append("self-check crashed: ").append(t); }
            out.append("\n--- setup log (tail)\n").append(Backend.tail(log(c), 4000));
            if (android.os.Build.VERSION.SDK_INT < 29) { try { Backend.write(new File(c.getFilesDir(), ".dsh/selfcheck.txt"), out.toString()); } catch (IOException ignored) {} return; }
            try {
                ContentValues cv = new ContentValues();
                cv.put(MediaStore.Downloads.DISPLAY_NAME, "DSHA-Standalone-check-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(new Date()) + ".txt");
                cv.put(MediaStore.Downloads.MIME_TYPE, "text/plain");
                Uri u = c.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                try (OutputStream o = c.getContentResolver().openOutputStream(u)) { o.write(out.toString().getBytes(StandardCharsets.UTF_8)); }
            } catch (Exception e) { android.util.Log.e("DSHA", "self-check report", e); }
        }, "selfcheck").start();
    }
}
