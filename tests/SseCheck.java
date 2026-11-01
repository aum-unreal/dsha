// JVM check for dev.aum.dsha.Sse: every event, especially the last one before
// the stream goes idle (run_end), must be emitted without waiting for more data.
package dev.aum.dsha;

import java.io.*;
import java.util.*;

public class SseCheck {
    static void check(boolean ok, String msg) { if (!ok) throw new AssertionError(msg); }

    public static void main(String[] a) throws Exception {
        PipedWriter w = new PipedWriter();
        BufferedReader r = new BufferedReader(new PipedReader(w, 1 << 16));
        List<String> got = Collections.synchronizedList(new ArrayList<>());
        Thread t = new Thread(() -> { try { Sse.pump(r, got::add, 30); } catch (IOException e) { throw new UncheckedIOException(e); } });
        t.start();
        w.write(": dsh 0.1.0\n\n");
        // A burst written at once, like the end of a run: text, usage, run_end, then silence.
        w.write("id: 1\ndata: {\"seq\":1,\"type\":\"text\"}\n\nid: 2\ndata: {\"seq\":2,\"type\":\"usage\"}\n\nid: 3\ndata: {\"seq\":3,\"type\":\"run_end\"}\n\n");
        w.flush();
        Thread.sleep(400);
        String all = String.join("", got);
        check(all.contains("\"run_end\""), "run_end held back while the stream is idle; got " + got);
        check(all.contains("\"seq\":1") && all.contains("\"seq\":2"), "missing events: " + got);
        for (String b : got) check(b.startsWith("[{") && b.endsWith("}]"), "bad batch " + b);
        // Pings alone must not emit anything.
        int n = got.size();
        w.write(": ping\n\n"); w.flush(); Thread.sleep(100);
        check(got.size() == n, "ping produced a batch");
        // A lone event after a pause also arrives promptly.
        w.write("data: {\"seq\":4,\"type\":\"run_start\"}\n\n"); w.flush(); Thread.sleep(200);
        check(String.join("", got).contains("\"seq\":4"), "single event after idle not emitted");
        w.close(); t.join(2000);
        System.out.println("sse ok (" + got.size() + " batches)");
    }
}
