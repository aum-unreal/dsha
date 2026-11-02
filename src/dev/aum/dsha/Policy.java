package dev.aum.dsha;

// Decisions the native side makes, in plain Java so tests/PolicyCheck.java runs them on the JVM.
final class Policy {
    private Policy() {}

    // RunService checks dsh every 20 s. It stops after two idle checks in a row, or once dsh has been
    // unreachable (connect error, non-200 such as a stale token's 401) for 9 checks in a row, about 3 min:
    // the backend it watched is gone (killed, `dsh stop`, Backend stopped or switched) and holding the
    // CPU for it would only drain the battery.
    static final int IDLE_CHECKS = 2, DOWN_CHECKS = 9;
    static final class Watch {
        private int idle, down;
        synchronized void reset() { idle = 0; down = 0; }
        // live: true = a run is live, false = dsh idle, null = dsh unreachable. Returns true when the service should stop.
        synchronized boolean step(Boolean live) {
            if (live == null) { idle = 0; return ++down >= DOWN_CHECKS; }
            down = 0;
            if (live) { idle = 0; return false; }
            return ++idle >= IDLE_CHECKS;
        }
    }

    // Intent extras go through one binder transaction (about 1 MB, UTF-16), so a long transcript in
    // EXTRA_TEXT throws TransactionTooLargeException. Share at most SHARE_MAX chars and say it was cut.
    static final int SHARE_MAX = 100_000;
    static final String CUT_NOTE = "\n\n[DSHA cut this to its first 100,000 characters for sharing; the full session stays in dsh.]";
    static String capShare(String t) {
        if (t == null || t.length() <= SHARE_MAX) return t;
        int end = SHARE_MAX;
        if (Character.isHighSurrogate(t.charAt(end - 1))) end--; // don't split a surrogate pair
        return t.substring(0, end) + CUT_NOTE;
    }

    // Read timeout for a bridge request. POST /api/sessions/:id/compact holds the response open for the
    // whole model summary, which can pass 2 min on a big session at peak hours.
    static final int READ_TIMEOUT = 120_000, COMPACT_TIMEOUT = 900_000;
    static int readTimeout(String method, String path) {
        return "POST".equals(method) && path != null && path.matches("/api/sessions/\\w+/compact(\\?.*)?") ? COMPACT_TIMEOUT : READ_TIMEOUT;
    }
}
