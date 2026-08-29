package in.caclasses.callbridge;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.format.DateUtils;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Collections;

/**
 * The whole user interface: four fields, two switches, two buttons.
 *
 * It is meant to be opened once, filled in, and never looked at again — except
 * to answer the only question that matters, which the status block answers in
 * one line: is it still getting through to the portal?
 */
public class MainActivity extends Activity {

    private EditText base, key, agent;
    private CheckBox enabled, outgoing;
    private TextView status;
    private Prefs prefs;
    private final Handler ui = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setContentView(R.layout.activity_main);
        prefs = new Prefs(this);

        base = findViewById(R.id.base);
        key = findViewById(R.id.key);
        agent = findViewById(R.id.agent);
        enabled = findViewById(R.id.enabled);
        outgoing = findViewById(R.id.outgoing);
        status = findViewById(R.id.status);

        base.setText(prefs.baseUrl());
        key.setText(prefs.key());
        agent.setText(prefs.agentNumber());
        enabled.setChecked(prefs.enabled());
        outgoing.setChecked(prefs.reportOutgoing());

        ((Button) findViewById(R.id.save)).setOnClickListener(v -> save());
        ((Button) findViewById(R.id.test)).setOnClickListener(v -> sendTest());
        ((Button) findViewById(R.id.battery)).setOnClickListener(v -> askToIgnoreBatteryOptimisation());

        askForPermissions();
        refresh();
    }

    @Override protected void onResume() { super.onResume(); refresh(); }

    private void save() {
        prefs.save(
                base.getText().toString(),
                key.getText().toString(),
                agent.getText().toString(),
                enabled.isChecked(),
                outgoing.isChecked());

        if (enabled.isChecked()) {
            askForPermissions();
            CallLogSweeper.scheduleSweeps(this);
            // Set the watermark now, so switching on never floods the portal
            // with the handset's back catalogue.
            if (prefs.watermark() <= 0) prefs.setWatermark(System.currentTimeMillis());
            Toast.makeText(this, "Saved. Reporting is on.", Toast.LENGTH_SHORT).show();
        } else {
            CallLogSweeper.cancelSweeps(this);
            Toast.makeText(this, "Saved. Reporting is off.", Toast.LENGTH_SHORT).show();
        }
        refresh();
    }

    /**
     * A test that reaches the portal for real, using the agent's own number so
     * the ticket it makes is obviously a test and belongs to nobody else.
     */
    private void sendTest() {
        save();
        String n = agent.getText().toString().replaceAll("\\D", "");
        if (n.length() > 10) n = n.substring(n.length() - 10);
        if (n.length() != 10) {
            Toast.makeText(this, "Put a ten-digit number in 'this phone' first — the test uses it.", Toast.LENGTH_LONG).show();
            return;
        }
        Sender.Event e = new Sender.Event();
        e.number = n;
        e.status = "answered";
        e.direction = "incoming";
        e.duration = 1;
        e.when = System.currentTimeMillis();
        final String label = n;
        new Thread(() -> {
            Sender.enqueueAndFlush(getApplicationContext(), Collections.singletonList(e));
            ui.post(() -> {
                refresh();
                String err = prefs.lastError();
                Toast.makeText(this,
                        err.isEmpty() ? "Sent. Look for a ticket from " + label : "Failed — " + err,
                        Toast.LENGTH_LONG).show();
            });
        }).start();
    }

    private void askForPermissions() {
        if (Build.VERSION.SDK_INT >= 23) {
            requestPermissions(new String[]{
                    Manifest.permission.READ_CALL_LOG,
                    Manifest.permission.READ_PHONE_STATE
            }, 1);
        }
    }

    /**
     * Doze will happily defer a quarter-hourly alarm for hours on a phone that
     * is sitting on a desk. For the one handset that answers every call, being
     * exempt is the difference between a ticket in a minute and a ticket after
     * lunch.
     */
    private void askToIgnoreBatteryOptimisation() {
        PowerManager pm = getSystemService(PowerManager.class);
        if (pm != null && pm.isIgnoringBatteryOptimizations(getPackageName())) {
            Toast.makeText(this, "Already exempt — nothing to do.", Toast.LENGTH_SHORT).show();
            return;
        }
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            i.setData(Uri.parse("package:" + getPackageName()));
            startActivity(i);
        } catch (Exception ignored) {
            startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
    }

    private void refresh() {
        StringBuilder s = new StringBuilder();
        s.append(prefs.enabled() ? "Reporting is ON" : "Reporting is OFF").append('\n');
        s.append("Calls sent: ").append(prefs.sentCount()).append('\n');

        long ok = prefs.lastOk();
        s.append("Last success: ")
         .append(ok == 0 ? "never" : DateUtils.getRelativeTimeSpanString(ok))
         .append('\n');

        String q = prefs.queue();
        int waiting = q.isEmpty() ? 0 : q.split("\n").length;
        s.append("Waiting to send: ").append(waiting).append('\n');

        if (!CallLogSweeper.hasPermission(this)) {
            s.append("\n⚠ The call log permission has not been granted. Nothing can be reported until it is.");
        }
        String err = prefs.lastError();
        if (!err.isEmpty()) s.append("\n⚠ Last error: ").append(err);

        PowerManager pm = getSystemService(PowerManager.class);
        if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
            s.append("\n⚠ Battery optimisation is still on for this app, so reports may be delayed.");
        }
        status.setText(s.toString());
    }
}
