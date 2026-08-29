package in.caclasses.callbridge;

import android.content.Context;
import android.util.Log;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Delivery to /api/calls/webhook.
 *
 * The body is form-encoded and the key travels in the x-webhook-key header
 * rather than the query string, so a caller's number never lands in a proxy
 * log or a browser history. The portal's endpoint accepts the key by header,
 * by ?key= or as a Bearer token, and reads the caller number under a dozen
 * field names — caller_number and call_status are the two it will find here.
 *
 * WHAT FAILS IS KEPT. A send that fails is written back to the queue and tried
 * again on the next sweep. The alternative — dropping it — is precisely the
 * silent loss the ticket system exists to stop.
 */
public final class Sender {
    private static final String TAG = "CallBridge";
    private static final int MAX_QUEUE = 200;
    /** Unit separator: cannot occur in a phone number, a status or a timestamp. */
    private static final String SEP = "\u001f";

    private Sender() {}

    /** One call, ready to post. Serialised to a single line for the queue. */
    public static final class Event {
        public String number;
        public String status;      // "missed" or "answered"
        public String direction;   // "incoming" or "outgoing"
        public long duration;      // seconds
        public long when;          // epoch ms

        public String pack() {
            return number + SEP + status + SEP + direction + SEP + duration + SEP + when;
        }

        public static Event unpack(String line) {
            String[] p = line.split(SEP, -1);
            if (p.length < 5) return null;
            Event e = new Event();
            e.number = p[0];
            e.status = p[1];
            e.direction = p[2];
            try { e.duration = Long.parseLong(p[3]); } catch (Exception ignored) { e.duration = 0; }
            try { e.when = Long.parseLong(p[4]); } catch (Exception ignored) { e.when = 0; }
            return e;
        }
    }

    /** Add to the back of the queue, then try to empty it. Call off the main thread. */
    public static synchronized void enqueueAndFlush(Context ctx, List<Event> events) {
        Prefs p = new Prefs(ctx);
        List<String> lines = new ArrayList<>();
        String existing = p.queue();
        if (!existing.isEmpty()) {
            for (String l : existing.split("\n")) if (!l.trim().isEmpty()) lines.add(l);
        }
        for (Event e : events) lines.add(e.pack());
        // A phone left offline for a week must not grow an unbounded backlog.
        while (lines.size() > MAX_QUEUE) lines.remove(0);
        p.setQueue(String.join("\n", lines));
        flush(ctx);
    }

    /** Try every queued event in order. Stops at the first failure so order holds. */
    public static synchronized void flush(Context ctx) {
        Prefs p = new Prefs(ctx);
        String q = p.queue();
        if (q.isEmpty()) return;
        if (p.key().isEmpty() || p.baseUrl().isEmpty()) {
            p.noteError("not configured — set the portal address and key");
            return;
        }

        List<String> lines = new ArrayList<>();
        for (String l : q.split("\n")) if (!l.trim().isEmpty()) lines.add(l);

        int i = 0;
        for (; i < lines.size(); i++) {
            Event e = Event.unpack(lines.get(i));
            if (e == null) continue;                 // unreadable line: drop it
            if (!post(p, e)) break;                  // stop; the rest stay queued
            p.noteOk();
        }
        p.setQueue(i >= lines.size() ? "" : String.join("\n", lines.subList(i, lines.size())));
    }

    /** A single delivery. Returns true only on a 2xx. */
    private static boolean post(Prefs p, Event e) {
        HttpURLConnection c = null;
        try {
            URL url = new URL(p.baseUrl() + "/api/calls/webhook");
            c = (HttpURLConnection) url.openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(15000);
            c.setReadTimeout(20000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            c.setRequestProperty("x-webhook-key", p.key());

            StringBuilder b = new StringBuilder();
            add(b, "caller_number", e.number);
            add(b, "call_status", e.status);
            add(b, "direction", e.direction);
            add(b, "duration", String.valueOf(e.duration));
            add(b, "call_time", String.valueOf(e.when));
            if (!p.agentNumber().isEmpty()) add(b, "agent_number", p.agentNumber());

            byte[] body = b.toString().getBytes(StandardCharsets.UTF_8);
            c.setFixedLengthStreamingMode(body.length);
            try (OutputStream os = c.getOutputStream()) { os.write(body); }

            int code = c.getResponseCode();
            if (code >= 200 && code < 300) return true;
            // 401 means the key is wrong; retrying forever would be pointless
            // noise, but the message has to be visible on the screen.
            p.noteError("HTTP " + code + (code == 401 ? " — the key is wrong" : ""));
            return false;
        } catch (Exception ex) {
            Log.w(TAG, "send failed", ex);
            p.noteError(ex.getClass().getSimpleName() + ": " + ex.getMessage());
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static void add(StringBuilder b, String k, String v) {
        try {
            if (b.length() > 0) b.append('&');
            b.append(URLEncoder.encode(k, "UTF-8")).append('=').append(URLEncoder.encode(v == null ? "" : v, "UTF-8"));
        } catch (Exception ignored) { }
    }
}
