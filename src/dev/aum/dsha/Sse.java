package dev.aum.dsha;

import java.io.BufferedReader;
import java.io.IOException;
import java.util.function.Consumer;

// Reads a Server-Sent Events stream and hands batches of event JSON to emit as
// a JS array literal ("[{..},{..}]"). Token deltas arrive in bursts, so events
// are coalesced, but a batch is always flushed as soon as the stream goes idle:
// the last events of a run (run_end) must never wait for the next event.
// Plain Java, no Android types, so tests/SseCheck.java can run it on the JVM.
final class Sse {
    private Sse() {}

    static void pump(BufferedReader r, Consumer<String> emit, long maxHoldMs) throws IOException {
        StringBuilder batch = new StringBuilder();
        long first = 0;
        String line;
        while ((line = r.readLine()) != null) {
            if (line.startsWith("data: ")) {
                if (batch.length() == 0) first = System.nanoTime();
                batch.append(batch.length() == 0 ? "[" : ",").append(line, 6, line.length());
            }
            if (batch.length() > 0 && (!r.ready() || (System.nanoTime() - first) / 1_000_000 >= maxHoldMs)) {
                emit.accept(batch.append(']').toString());
                batch.setLength(0);
            }
        }
        if (batch.length() > 0) emit.accept(batch.append(']').toString());
    }
}
