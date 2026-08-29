package in.caclasses.callbridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Alarms do not survive a reboot, and a phone that reboots overnight would
 * otherwise stop reporting until somebody opened the app. It re-arms here, and
 * sweeps once immediately so any call taken before the reboot still goes.
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Context app = context.getApplicationContext();
        if (!new Prefs(app).enabled()) return;
        CallLogSweeper.scheduleSweeps(app);
        final PendingResult pr = goAsync();
        new Thread(() -> {
            try { CallLogSweeper.sweep(app); } finally { pr.finish(); }
        }).start();
    }
}
