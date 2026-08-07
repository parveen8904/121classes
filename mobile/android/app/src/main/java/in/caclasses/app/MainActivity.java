package in.caclasses.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
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

    /** True while a video owns the screen, so the bars are not padded around. */
    private boolean immersive = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        keepContentClearOfTheBars();
        tellThePageWhetherPushCanWork();

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

    /**
     * Say whether asking for notifications is safe.
     *
     * The push plugin talks to Firebase, and Firebase is only initialised when
     * google-services.json was present at BUILD time. Ask it to register in a
     * build without that file and it does not fail politely — it throws on a
     * native thread and takes the whole app down, about five seconds after
     * launch, every launch. No amount of try/catch in the page can hold that,
     * because the page is not where it happens.
     *
     * So the page is told, and only asks for notifications when the answer is
     * yes. It is repeated for a few seconds because the page may still be
     * loading when the app starts cold.
     */
    private void tellThePageWhetherPushCanWork() {
        boolean ready;
        try {
            // Asked by reflection because Firebase belongs to the plugin, not
            // to this module — and because a build with no Firebase at all
            // must answer "no" rather than fail to compile.
            Class<?> app = Class.forName("com.google.firebase.FirebaseApp");
            Object list = app.getMethod("getApps", android.content.Context.class).invoke(null, this);
            ready = list instanceof java.util.List && !((java.util.List<?>) list).isEmpty();
        } catch (Throwable t) {
            ready = false;
        }
        final String js = "window.__pushReady = " + ready;
        final android.webkit.WebView web = getBridge().getWebView();
        for (int delay : new int[] { 500, 1500, 3000, 6000, 10000 }) {
            web.postDelayed(() -> web.evaluateJavascript(js, null), delay);
        }
    }

    /**
     * Hold the page clear of the status bar and the navigation bar.
     *
     * From Android 16 (API 36) an app may no longer ask the system to lay it
     * out inside the bars — every app is edge-to-edge, and it is the app's own
     * job to keep its content out from under them. Left alone, the site's
     * header would sit beneath the clock and the battery, and the bottom of
     * every page beneath the navigation bar. Nothing would crash; it would
     * simply look wrong on every screen, and the top row of buttons would be
     * hard to press.
     *
     * The padding goes on the WebView rather than into the site's CSS so that
     * the browser version of the same pages is untouched, and so a phone with a
     * notch, a phone with gesture navigation and a phone with three buttons
     * each get the measurement the system reports rather than a guess.
     */
    private void keepContentClearOfTheBars() {
        final android.webkit.WebView web = getBridge().getWebView();
        ViewCompat.setOnApplyWindowInsetsListener(web, (v, windowInsets) -> {
            // The cutout matters in landscape, where it eats into the side
            // rather than the top — a class list would otherwise start
            // underneath the camera.
            Insets bars = windowInsets.getInsets(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            // While a video owns the screen it should have the notch and the
            // whole panel, so the page is told there is nothing in its way.
            float d = getResources().getDisplayMetrics().density;
            int t = immersive ? 0 : Math.round(bars.top / d);
            int r = immersive ? 0 : Math.round(bars.right / d);
            int b = immersive ? 0 : Math.round(bars.bottom / d);
            int l = immersive ? 0 : Math.round(bars.left / d);
            // Guarded, because the insets arrive before the page has loaded on
            // a cold start — and again on every rotation, when it has.
            web.evaluateJavascript(
                    "window.__appInsets && window.__appInsets(" + t + "," + r + "," + b + "," + l + ")",
                    null);
            return windowInsets;
        });

        // The page paints the whole screen, including behind the bars, so the
        // bars themselves must not paint over it.
        WindowInsetsControllerCompat c =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        // Which theme the student picked decides whether the clock should be
        // dark or light, and they can change it while the app is open. Asking
        // the page for its own text colour is the one answer that is never
        // stale — and it is the same question either theme answers correctly.
        applyBarIconsFromPage();
    }

    /**
     * Match the clock and the battery to whatever theme the page is showing.
     * The site starts dark and has a light setting, so this cannot be fixed at
     * build time; it is asked again whenever the page settles.
     */
    private void applyBarIconsFromPage() {
        final android.webkit.WebView web = getBridge().getWebView();
        web.postDelayed(() -> web.evaluateJavascript(
                "getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()",
                value -> {
                    // A dark page background needs light icons, and the other
                    // way round. Anything unreadable falls back to light icons
                    // on the dark default.
                    boolean lightPage = value != null && value.contains("#f7f8fc");
                    WindowInsetsControllerCompat c = WindowCompat.getInsetsController(
                            getWindow(), getWindow().getDecorView());
                    c.setAppearanceLightStatusBars(lightPage);
                    c.setAppearanceLightNavigationBars(lightPage);
                }), 800);
    }

    private void applyImmersive(boolean on) {
        immersive = on;
        runOnUiThread(() -> {
            // The padding is decided by the listener above, which reads the
            // flag — so ask for the insets again now that it has changed.
            ViewCompat.requestApplyInsets(getBridge().getWebView());
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
