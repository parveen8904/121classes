package in.caclasses.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

// Fullscreen that is actually full screen.
//
// The web side sizes the player correctly, but Android still drew the status bar
// and the navigation bar over the top and bottom of it, so "fullscreen" lost a
// strip at each end — worst on phones with a tall screen and gesture bar.
//
// When the WebView enters HTML5 fullscreen, Capacitor adds a custom view to this
// activity. Watching that view arrive is what tells us to take the system bars
// away, and to give them back when it leaves. Nothing else in the app changes.
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        final View root = getWindow().getDecorView();
        root.setOnSystemUiVisibilityChangeListener(visibility -> { /* keep the flags sticky */ });

        // The fullscreen custom view is attached to the activity's content
        // group, so its arrival and departure are the signal we need.
        final android.view.ViewGroup content = findViewById(android.R.id.content);
        content.setOnHierarchyChangeListener(new android.view.ViewGroup.OnHierarchyChangeListener() {
            @Override
            public void onChildViewAdded(View parent, View child) {
                // Capacitor's own WebView is the first child; anything added on
                // top of it while playing is the fullscreen video container.
                if (content.getChildCount() > 1) setImmersive(true);
            }

            @Override
            public void onChildViewRemoved(View parent, View child) {
                if (content.getChildCount() <= 1) setImmersive(false);
            }
        });
    }

    private void setImmersive(boolean on) {
        runOnUiThread(() -> {
            WindowInsetsControllerCompat c =
                    WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            if (on) {
                // Keep the screen on for the length of a class, and let the
                // video use the notch area too.
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    getWindow().getAttributes().layoutInDisplayCutoutMode =
                            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
                }
                c.setSystemBarsBehavior(
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    getWindow().getAttributes().layoutInDisplayCutoutMode =
                            WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
                }
                c.show(WindowInsetsCompat.Type.systemBars());
            }
        });
    }
}
