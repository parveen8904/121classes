package in.caclasses.callbridge;

import android.Manifest;
import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.CallLog;

import java.util.ArrayList;
import java.util.List;

/**
 * Reads the handset's own call log and turns new rows into portal events.
 *
 * The call log — not the PHONE_STATE broadcast — is the source of truth. The
 * broadcast tells you a call ended; it does not reliably tell you whether it
 * was answered, and on several manufacturers' builds it does not carry the
 * number at all. The log records both, a second or two later, which is why the
 * receiver's job is only to schedule a sweep.
 */
public final class CallLogSweeper {

    private static final long SWEEP_INTERVAL_MS = 15 * 60 * 1000L;
    private static final int ALARM_ID = 4711;
    private static final int ONESHOT_ID_BASE = 5000;

    private CallLogSweeper() {}

    public static boolean hasPermission(Context ctx) {
        return ctx.checkSelfPermission(Manifest.permission.READ_CALL_LOG) == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Everything newer than the watermark, oldest first, delivered and stamped.
     * Safe to call as often as you like — the watermark makes it idempotent.
     */
    public static int sweep(Context ctx) {
        Prefs p = new Prefs(ctx);
        if (!p.enabled()) return 0;
        if (!hasPermission(ctx)) { p.noteError("permission to read the call log was not granted"); return 0; }

        long since = p.watermark();
        if (since <= 0) {
            // FIRST RUN: start from now. Sweeping a year of history would open a
            // ticket for every call the handset has ever taken.
            p.setWatermark(System.currentTimeMillis());
            Sender.flush(ctx);
            return 0;
        }

        List<Sender.Event> events = new ArrayList<>();
        long newest = since;

        String[] cols = { CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION };
        try (Cursor c = ctx.getContentResolver().query(
                CallLog.Calls.CONTENT_URI, cols,
                CallLog.Calls.DATE + " > ?", new String[]{ String.valueOf(since) },
                CallLog.Calls.DATE + " ASC")) {
            if (c == null) return 0;
            while (c.moveToNext()) {
                String raw = c.getString(0);
                int type = c.getInt(1);
                long date = c.getLong(2);
                long dur = c.getLong(3);
                if (date > newest) newest = date;

                String digits = raw == null ? "" : raw.replaceAll("\\D", "");
                if (digits.length() > 10) digits = digits.substring(digits.length() - 10);
                // The portal ignores anything that is not a ten-digit Indian
                // number, so private/withheld numbers are dropped here rather
                // than posted and discarded at the other end.
                if (digits.length() != 10) continue;

                Sender.Event e = new Sender.Event();
                e.number = digits;
                e.when = date;
                e.duration = dur;

                switch (type) {
                    case CallLog.Calls.MISSED_TYPE:
                    case CallLog.Calls.REJECTED_TYPE:
                    case CallLog.Calls.VOICEMAIL_TYPE:
                        // A rejected call is reported as missed on purpose. The
                        // caller did not get through, and the portal opens a
                        // HIGH-priority ticket for a missed call — which is the
                        // behaviour wanted, because somebody has to ring back.
                        e.status = "missed";
                        e.direction = "incoming";
                        break;
                    case CallLog.Calls.INCOMING_TYPE:
                        e.status = "answered";
                        e.direction = "incoming";
                        break;
                    case CallLog.Calls.OUTGOING_TYPE:
                        if (!p.reportOutgoing()) continue;
                        e.status = "answered";
                        e.direction = "outgoing";
                        break;
                    default:
                        continue;   // blocked, screened, anything unfamiliar
                }
                events.add(e);
            }
        } catch (SecurityException se) {
            p.noteError("the call log permission was withdrawn");
            return 0;
        } catch (Exception ex) {
            p.noteError("could not read the call log: " + ex.getMessage());
            return 0;
        }

        // Stamp BEFORE sending. A call sent twice is a duplicate line on a
        // ticket; a call stamped and never sent is one nobody rings back. The
        // queue makes the send survive anyway, so the risk sits on the right
        // side of that trade.
        p.setWatermark(newest);
        if (events.isEmpty()) { Sender.flush(ctx); return 0; }
        Sender.enqueueAndFlush(ctx, events);
        return events.size();
    }

    /** Quarter-hourly safety net. Inexact, so it needs no special permission. */
    public static void scheduleSweeps(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        am.setInexactRepeating(
                AlarmManager.RTC_WAKEUP,
                System.currentTimeMillis() + 60_000L,
                SWEEP_INTERVAL_MS,
                sweepIntent(ctx, ALARM_ID));
    }

    public static void cancelSweeps(Context ctx) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am != null) am.cancel(sweepIntent(ctx, ALARM_ID));
    }

    /**
     * A one-off sweep a few seconds from now, used when a call has just ended.
     *
     * Each delay gets its OWN request code. Two PendingIntents that match are
     * the same PendingIntent as far as the system is concerned, so sharing a
     * code here would mean the thirty-second sweep silently cancelled the
     * eight-second one — and, worse, that either of them replaced the
     * quarter-hourly alarm and stopped the safety net altogether.
     */
    public static void sweepSoon(Context ctx, long delayMs) {
        AlarmManager am = ctx.getSystemService(AlarmManager.class);
        if (am == null) return;
        int code = ONESHOT_ID_BASE + (int) (delayMs / 1000L);
        am.set(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + delayMs, sweepIntent(ctx, code));
    }

    private static PendingIntent sweepIntent(Context ctx, int requestCode) {
        Intent i = new Intent(ctx, SweepReceiver.class);
        return PendingIntent.getBroadcast(ctx, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
