// JVM check for dev.aum.dsha.Policy: when RunService stops, how much text a share carries,
// and which bridge requests get the long read timeout.
package dev.aum.dsha;

public class PolicyCheck {
    static void check(boolean ok, String msg) { if (!ok) throw new AssertionError(msg); }

    public static void main(String[] a) {
        // Watch: two idle checks in a row stop it; a live check in between resets.
        Policy.Watch w = new Policy.Watch();
        check(!w.step(false) && !w.step(true) && !w.step(false) && w.step(false), "idle twice in a row should stop");
        // dsh unreachable forever (killed, dsh stop, stale token's 401): stops after DOWN_CHECKS, not never.
        w.reset(); int n = 0; while (!w.step(null)) { n++; check(n < 100, "never stops while dsh is unreachable"); }
        check(n + 1 == Policy.DOWN_CHECKS && Policy.DOWN_CHECKS * 20 >= 150 && Policy.DOWN_CHECKS * 20 <= 240, "gives up after about 3 min, got " + (n + 1) + " checks");
        // A short outage (dsh restart) mid-run does not stop it, and a reachable check clears the count.
        w.reset(); for (int i = 0; i < Policy.DOWN_CHECKS - 1; i++) check(!w.step(null), "stopped during a short outage");
        check(!w.step(true), "live after outage"); for (int i = 0; i < Policy.DOWN_CHECKS - 1; i++) check(!w.step(null), "outage count not reset by a live check");
        // An unreachable check between two idle ones does not count as idle (and doesn't stop on its own).
        w.reset(); check(!w.step(false) && !w.step(null) && !w.step(false) && w.step(false), "idle count after unreachable");
        // reset() (a new start) clears both counts.
        w.reset(); w.step(false); w.reset(); check(!w.step(false), "reset did not clear idle");

        // Share cap: small text untouched, a long transcript cut to SHARE_MAX plus a note, never splitting a surrogate pair.
        check("hi".equals(Policy.capShare("hi")) && Policy.capShare(null) == null, "small share changed");
        String exact = "x".repeat(Policy.SHARE_MAX);
        check(exact.equals(Policy.capShare(exact)), "text at the cap changed");
        String big = "y".repeat(2_000_000), c = Policy.capShare(big);
        check(c.length() == Policy.SHARE_MAX + Policy.CUT_NOTE.length() && c.endsWith(Policy.CUT_NOTE), "long share not capped: " + c.length());
        check(c.length() * 2 < 500_000, "capped share still too big for a binder transaction");
        String sur = "z".repeat(Policy.SHARE_MAX - 1) + "😀" + "tail";
        String cs = Policy.capShare(sur);
        check(!Character.isHighSurrogate(cs.charAt(cs.length() - Policy.CUT_NOTE.length() - 1)), "split a surrogate pair");

        // Read timeouts: compact waits for the whole model summary; everything else keeps 120 s.
        check(Policy.readTimeout("POST", "/api/sessions/abc_123/compact") >= 600_000, "compact keeps the 120 s timeout");
        check(Policy.readTimeout("GET", "/api/sessions/abc/compact") == Policy.READ_TIMEOUT, "GET compact got the long timeout");
        check(Policy.readTimeout("POST", "/api/sessions/abc/send") == Policy.READ_TIMEOUT, "other POST got the long timeout");
        check(Policy.readTimeout("POST", "/api/sessions/abc/compactx") == Policy.READ_TIMEOUT && Policy.readTimeout("POST", null) == Policy.READ_TIMEOUT, "loose compact match");
        System.out.println("policy ok");
    }
}
