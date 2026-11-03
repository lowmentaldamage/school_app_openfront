package com.laukolaroser.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.text.InputType;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * Laukolaroser for Android: the game runs in a full-screen WebView pointed
 * at your server (private or public). The server address is asked on first
 * launch and can be changed from the back-button menu.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "laukolaroser";
    private static final String KEY_SERVER = "server";

    private WebView web;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#12130E"));
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        String server = prefs.getString(KEY_SERVER, null);
        if (server == null) {
            askForServer(null, true);
        } else {
            open(server);
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void open(String server) {
        if (web == null) {
            web = new WebView(this);
            web.setBackgroundColor(Color.parseColor("#12130E"));
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setDatabaseEnabled(true);
            s.setMediaPlaybackRequiresUserGesture(false);
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);
            s.setUseWideViewPort(true);
            s.setLoadWithOverviewMode(true);
            s.setTextZoom(100);
            s.setSupportZoom(false);
            s.setUserAgentString(s.getUserAgentString() + " LaukolaroserApp/1.0");
            web.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                    Uri target = req.getUrl();
                    Uri home = Uri.parse(currentServer());
                    // The game stays in the app; other links (e.g. the
                    // source code) open in the phone's browser.
                    if (home.getHost() != null && home.getHost().equals(target.getHost())) {
                        return false;
                    }
                    startActivity(new Intent(Intent.ACTION_VIEW, target));
                    return true;
                }

                @Override
                public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                    if (req.isForMainFrame()) {
                        showOfflineMessage(String.valueOf(err.getDescription()));
                    }
                }
            });
            setContentView(web);
            goFullscreen();
        }
        web.loadUrl(server);
    }

    private String currentServer() {
        return prefs.getString(KEY_SERVER, "");
    }

    /** Adds http:// when no scheme is given and drops a trailing slash. */
    static String normalize(String raw) {
        String s = raw == null ? "" : raw.trim();
        if (s.isEmpty()) return "";
        if (!s.startsWith("http://") && !s.startsWith("https://")) {
            s = "http://" + s;
        }
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    private void askForServer(String current, boolean firstRun) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        box.setPadding(pad, pad / 2, pad, 0);
        TextView hint = new TextView(this);
        hint.setText("Address of your Laukolaroser server, for example\n"
                + "http://192.168.1.20:8080  (home network)\n"
                + "https://game.example.com  (internet)");
        box.addView(hint);
        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint("http://192.168.1.20:8080");
        if (current != null) input.setText(current);
        box.addView(input);

        AlertDialog.Builder b = new AlertDialog.Builder(this)
                .setTitle("Laukolaroser server")
                .setView(box)
                .setCancelable(!firstRun)
                .setPositiveButton("Connect", (d, w) -> {
                    String url = normalize(input.getText().toString());
                    if (url.isEmpty()) {
                        askForServer(current, firstRun);
                        return;
                    }
                    prefs.edit().putString(KEY_SERVER, url).apply();
                    open(url);
                });
        if (firstRun) {
            b.setNegativeButton("Quit", (d, w) -> finish());
        } else {
            b.setNegativeButton("Cancel", null);
        }
        b.show();
    }

    private void showOfflineMessage(String reason) {
        new AlertDialog.Builder(this)
                .setTitle("Can't reach the server")
                .setMessage(currentServer() + "\n\n" + reason
                        + "\n\nCheck that the server is running and that the phone"
                        + " is on the same network (or that the address is public).")
                .setPositiveButton("Retry", (d, w) -> web.loadUrl(currentServer()))
                .setNeutralButton("Change server", (d, w) -> askForServer(currentServer(), false))
                .setNegativeButton("Quit", (d, w) -> finish())
                .setCancelable(false)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        new AlertDialog.Builder(this)
                .setTitle("Laukolaroser")
                .setItems(new CharSequence[] {"Reload", "Change server", "Quit"}, (d, which) -> {
                    if (which == 0 && web != null) web.reload();
                    else if (which == 1) askForServer(currentServer(), false);
                    else if (which == 2) finish();
                })
                .show();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) goFullscreen();
    }

    @SuppressWarnings("deprecation")
    private void goFullscreen() {
        if (android.os.Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }
}
