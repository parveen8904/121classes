package in.caclasses.callbridge;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** The alarm lands here. The work happens on a background thread, briefly. */
public class SweepReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        final PendingResult pr = goAsync();
        final Context app = context.getApplicationContext();
        new Thread(() -> {
            try { CallLogSweeper.sweep(app); } finally { pr.finish(); }
        }).start();
    }
}
