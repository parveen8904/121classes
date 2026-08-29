package in.caclasses.callbridge;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * Settings and the two pieces of state that make this safe to restart.
 *
 * WATERMARK is the important one. The sweep reads the call log for anything
 * newer than the last call it reported. On a first run that watermark is set to
 * NOW, not to zero — otherwise the very first sweep would post every call in
 * the handset's history and open a ticket for each, which on a phone that has
 * been in use for a year means several hundred tickets and a support queue
 * nobody can dig out of.
 */
public final class Prefs {
    private static final String FILE = "callbridge";

    private static final String K_BASE = "base_url";
    private static final String K_KEY = "webhook_key";
    private static final String K_AGENT = "agent_number";
    private static final String K_ENABLED = "enabled";
    private static final String K_OUTGOING = "report_outgoing";
    private static final String K_WATERMARK = "watermark";
    private static final String K_QUEUE = "queue";
    private static final String K_LAST_OK = "last_ok";
    private static final String K_LAST_ERR = "last_err";
    private static final String K_SENT = "sent_count";

    private final SharedPreferences sp;

    public Prefs(Context c) {
        sp = c.getApplicationContext().getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    public String baseUrl() { return sp.getString(K_BASE, "https://caparveensharma.com"); }
    public String key() { return sp.getString(K_KEY, ""); }
    public String agentNumber() { return sp.getString(K_AGENT, ""); }
    public boolean enabled() { return sp.getBoolean(K_ENABLED, false); }
    public boolean reportOutgoing() { return sp.getBoolean(K_OUTGOING, true); }

    public void save(String base, String key, String agent, boolean enabled, boolean outgoing) {
        sp.edit()
            .putString(K_BASE, base.trim().replaceAll("/+$", ""))
            .putString(K_KEY, key.trim())
            .putString(K_AGENT, agent.trim())
            .putBoolean(K_ENABLED, enabled)
            .putBoolean(K_OUTGOING, outgoing)
            .apply();
    }

    /** 0 means "never swept" — the caller must then start from now, not from zero. */
    public long watermark() { return sp.getLong(K_WATERMARK, 0L); }
    public void setWatermark(long ms) { sp.edit().putLong(K_WATERMARK, ms).apply(); }

    /** Events that could not be delivered, one per line, oldest first. */
    public String queue() { return sp.getString(K_QUEUE, ""); }
    public void setQueue(String q) { sp.edit().putString(K_QUEUE, q).apply(); }

    public long lastOk() { return sp.getLong(K_LAST_OK, 0L); }
    public String lastError() { return sp.getString(K_LAST_ERR, ""); }
    public int sentCount() { return sp.getInt(K_SENT, 0); }

    public void noteOk() {
        sp.edit()
            .putLong(K_LAST_OK, System.currentTimeMillis())
            .putString(K_LAST_ERR, "")
            .putInt(K_SENT, sentCount() + 1)
            .apply();
    }

    public void noteError(String message) {
        sp.edit().putString(K_LAST_ERR, message == null ? "unknown" : message).apply();
    }
}
