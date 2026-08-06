package in.caclasses.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebChromeClient;

// Fullscreen video that actually goes fullscreen.
//
// Capacitor's own BridgeWebChromeClient answers onShowCustomView like this:
//
//     public void onShowCustomView(View view, CustomViewCallback callback) {
//         callback.onCustomViewHidden();      // <- cancels it immediately
//         super.onShowCustomView(view, callback);
//     }
//
// It tells the WebView the fullscreen view has already been dismissed the
// instant the page asks for it, and never attaches the view to anything. So on
// Android the element entered fullscreen and left again in the same frame: no
// :fullscreen CSS ever matched, and the video simply stayed where it was. No
// amount of styling could have fixed that — those styles were never in play.
// This is why fullscreen "still is not happening" on Android after the CSS was
// corrected; the CSS was right and unreachable.
//
// This client does the two things the platform actually asks for: put the view
// on screen at full size, and take it away again afterwards. The system bars go
// with it, so the video gets the whole panel including the notch.
public class MainActivity extends BridgeActivity {

    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getBridge()
            .getWebView()
            .setWebChromeClient(
                new BridgeWebChromeClient(getBridge()) {
                    @Override
                    public void onShowCustomView(View view, CustomViewCallback callback) {
                        // Already showing one — refuse the second rather than
                        // leaking the first and losing the way back out.
                        if (fullscreenView != null) {
                            callback.onCustomViewHidden();
                            return;
                        }
                        fullscreenView = view;
                        fullscreenCallback = callback;

                        ViewGroup content = findViewById(android.R.id.content);
                        content.addView(
                            fullscreenView,
                            new FrameLayout.LayoutParams(
                                ViewGroup.LayoutParams.MATCH_PARENT,
                                ViewGroup.LayoutParams.MATCH_PARENT
                            )
                        );
                        getBridge().getWebView().setVisibility(View.GONE);
                        applyImmersive(true);
                    }

                    @Override
                    public void onHideCustomView() {
                        exitFullscreen();
                    }
                }
            );
    }

    /** Back should leave the video, not the class. */
    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            exitFullscreen();
            return;
        }
        super.onBackPressed();
    }

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        ViewGroup content = findViewById(android.R.id.content);
        content.removeView(fullscreenView);
        fullscreenView = null;
        getBridge().getWebView().setVisibility(View.VISIBLE);
        applyImmersive(false);
        if (fullscreenCallback != null) {
            fullscreenCallback.onCustomViewHidden();
            fullscreenCallback = null;
        }
    }

    private void applyImmersive(boolean on) {
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
                // Swipe brings the bars back; a plain tap passes through to the
                // player, so the controls still answer the first touch.
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
