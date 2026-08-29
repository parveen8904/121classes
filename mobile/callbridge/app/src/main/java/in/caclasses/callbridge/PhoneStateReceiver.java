package in.caclasses.callbridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.telephony.TelephonyManager;

/**
 * A call has just changed state. IDLE means one has ended.
 *
 * Nothing is read here. The call log takes a moment to settle after a call —
 * on some builds a second or two, on others longer — and the log is where the
 * answered/missed distinction actually lives. So this only asks for a sweep in
 * eight seconds, and asks again at thirty in case the first was early.
 */
public class PhoneStateReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        if (!TelephonyManager.EXTRA_STATE_IDLE.equals(state)) return;
        Context app = context.getApplicationContext();
        if (!new Prefs(app).enabled()) return;
        CallLogSweeper.sweepSoon(app, 8_000L);
        CallLogSweeper.sweepSoon(app, 30_000L);
    }
}
