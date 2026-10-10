package org.openpos.mobile;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "OpenPOSNative")
public class OpenPOSNativePlugin extends Plugin {
    private final ExecutorService worker = Executors.newFixedThreadPool(2);
    private ConnectionStore connections;
    @Override public void load() { connections = new ConnectionStore(getContext()); }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); }
    private JSObject publicConnection(JSONObject value) throws Exception {
        JSObject result = new JSObject();
        for (String field : new String[]{"deviceName", "clientId", "serverUrl", "defaultTab"}) result.put(field, value.getString(field));
        result.put("configured", !value.optString("serverUrl").isEmpty() && value.optString("syncKey").length() >= 24);
        return result;
    }
    private void reject(PluginCall call, Exception exception) { call.reject(exception.getMessage() == null ? "The operation could not be completed." : exception.getMessage()); }
    @PluginMethod public void getConnection(PluginCall call) {
        worker.execute(() -> { try { call.resolve(publicConnection(connections.read())); } catch (Exception error) { reject(call, error); } });
    }
    @PluginMethod public void saveConnection(PluginCall call) {
        worker.execute(() -> {
            try {
                synchronized (connections) {
                    JSONObject previous = connections.read();
                    String name = call.getString("deviceName", "").trim();
                    String id = call.getString("clientId", previous.getString("clientId")).trim();
                    String tab = call.getString("defaultTab", "menu");
                    String server = SyncProtocol.validateServerUrl(call.getString("serverUrl", ""));
                    String key = call.getString("syncKey", "");

                    if (name.isEmpty() || name.length() > 80) throw new IllegalArgumentException("Enter a device name of 1 to 80 characters.");
                    if (!id.equals(previous.getString("clientId"))) throw new IllegalArgumentException("The device ID is assigned by this installation and cannot be changed.");
                    if (!tab.equals("menu") && !tab.equals("orders")) throw new IllegalArgumentException("Choose Menu or Orders as the starting screen.");
                    SyncProtocol.validateExplicitSyncKey(key);
                    JSONObject next = new JSONObject().put("deviceName", name).put("clientId", id).put("serverUrl", server).put("defaultTab", tab).put("syncKey", key);
                    connections.write(next);
                    call.resolve(publicConnection(next));
                }
            } catch (Exception error) { reject(call, error); }
        });
    }
    @PluginMethod public void request(PluginCall call) {
        worker.execute(() -> {
            HttpURLConnection connection = null;
            try {
                String route = call.getString("route", "");
                SyncProtocol.validateRoute(route);
                String body = call.getString("body", "{}");
                byte[] payload = body.getBytes(StandardCharsets.UTF_8);
                if (payload.length > SyncProtocol.MAX_REQUEST) throw new IllegalArgumentException("This change is too large to send to the master.");
                new JSONObject(body);
                JSONObject settings = connections.read();
                String server = SyncProtocol.validateServerUrl(settings.getString("serverUrl"));
                String key = settings.getString("syncKey");
                if (key.length() < 24) throw new IllegalStateException("Pair this device with a master first.");
                String stamp = Long.toString(System.currentTimeMillis()), nonce = UUID.randomUUID().toString();
                connection = (HttpURLConnection) new URI(server + route).toURL().openConnection(java.net.Proxy.NO_PROXY);
                connection.setRequestMethod("POST");
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(4500);
                connection.setReadTimeout(4500);
                connection.setUseCaches(false);
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(payload.length);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("X-OpenPOS-Client", settings.getString("clientId"));
                connection.setRequestProperty("X-OpenPOS-Time", stamp);
                connection.setRequestProperty("X-OpenPOS-Nonce", nonce);
                connection.setRequestProperty("X-OpenPOS-Signature", SyncProtocol.requestSignature(key, route, stamp, nonce, body));
                try (java.io.OutputStream stream = connection.getOutputStream()) { stream.write(payload); }
                int status = connection.getResponseCode();
                if (status >= 300 && status < 400) throw new IllegalStateException("The master redirected the request. Check its LAN address.");
                if (connection.getContentLengthLong() > SyncProtocol.MAX_RESPONSE) throw new IllegalStateException("The master response is too large.");
                InputStream response = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                String raw;
                try (InputStream stream = response) { raw = readLimited(stream, SyncProtocol.MAX_RESPONSE); }
                if (!SyncProtocol.verifyResponse(key, nonce, status, raw, connection.getHeaderField("X-OpenPOS-Signature"))) throw new IllegalStateException("Master authentication failed. Check registration, the shared sync key and both device clocks.");
                JSONObject parsed = new JSONObject(raw);
                if (status != 200) throw new IllegalStateException(parsed.optString("error", "The master rejected the change."));
                JSObject result = new JSObject();
                result.put("body", raw);
                call.resolve(result);
            } catch (Exception error) { reject(call, error); }
            finally { if (connection != null) connection.disconnect(); }
        });
    }
    private String readLimited(InputStream stream, int limit) throws Exception {
        if (stream == null) return "";
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        long deadline = System.currentTimeMillis() + 15000;
        int count;
        while ((count = stream.read(buffer)) != -1) {
            if (System.currentTimeMillis() > deadline) throw new IllegalStateException("The master response timed out. Please reconnect.");
            if (bytes.size() + count > limit) throw new IllegalArgumentException("The file or response is too large.");
            bytes.write(buffer, 0, count);
        }
        return bytes.toString(StandardCharsets.UTF_8.name());
    }
    private File exportFile(String name, String content) throws Exception {
        if (!name.matches("[a-zA-Z0-9][a-zA-Z0-9._ -]{0,100}\\.(csv|json|txt|html)")) throw new IllegalArgumentException("Unsupported export filename.");
        byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
        if (bytes.length > SyncProtocol.MAX_RESPONSE) throw new IllegalArgumentException("This export is too large.");
        File directory = new File(getContext().getCacheDir(), "exports");
        if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Unable to prepare the export.");
        File[] old = directory.listFiles();
        if (old != null) for (File file : old) if (file.isFile() && file.lastModified() < System.currentTimeMillis() - 86400000L) file.delete();
        File file = new File(directory, name);
        Files.write(file.toPath(), bytes);
        return file;
    }
    private void openFile(File file, String mime, boolean share, PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try {
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(share ? Intent.ACTION_SEND : Intent.ACTION_VIEW);
                if (share) { intent.setType(mime); intent.putExtra(Intent.EXTRA_STREAM, uri); }
                else intent.setDataAndType(uri, mime);
                intent.setClipData(ClipData.newRawUri("OpenPOS export", uri));
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(intent, share ? "Save or share OpenPOS export" : "Open OpenPOS handbook"));
                call.resolve();
            } catch (Exception error) { call.reject("No compatible application is available to open this file."); }
        });
    }
    @PluginMethod public void shareFile(PluginCall call) {
        worker.execute(() -> {
            try {
                String mime = call.getString("mime", "");
                if (!java.util.Arrays.asList("text/csv", "application/json", "text/plain", "text/html").contains(mime)) throw new IllegalArgumentException("Unsupported export type.");
                openFile(exportFile(call.getString("name", ""), call.getString("content", "")), mime, true, call);
            } catch (Exception error) { reject(call, error); }
        });
    }
    @PluginMethod public void openHelp(PluginCall call) {
        worker.execute(() -> {
            try {
                String html, css;
                try (InputStream stream = getContext().getAssets().open("public/help/help.html")) { html = readLimited(stream, SyncProtocol.MAX_REQUEST); }
                try (InputStream stream = getContext().getAssets().open("public/help/style.css")) { css = readLimited(stream, SyncProtocol.MAX_REQUEST); }
                html = HelpDocument.inlineStyle(html, css);
                openFile(exportFile("OpenPOS-handbook.html", html), "text/html", false, call);
            } catch (Exception error) { reject(call, error); }
        });
    }
    @PluginMethod public void printHtml(PluginCall call) {
        String html = call.getString("html", "");
        if (html.getBytes(StandardCharsets.UTF_8).length > SyncProtocol.MAX_REQUEST) { call.reject("The receipt is too large to print."); return; }
        getActivity().runOnUiThread(() -> {
            WebView webView = new WebView(getActivity());
            webView.getSettings().setJavaScriptEnabled(false);
            webView.getSettings().setAllowFileAccess(false);
            webView.getSettings().setAllowContentAccess(false);
            webView.getSettings().setBlockNetworkLoads(true);
            webView.setWebViewClient(new WebViewClient() {
                private boolean submitted;
                @Override public void onPageFinished(WebView view, String url) {
                    if (submitted) return;
                    submitted = true;
                    try {
                        PrintDocumentAdapter delegate = view.createPrintDocumentAdapter("OpenPOS receipt");
                        PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                            @Override public void onStart() { delegate.onStart(); }
                            @Override public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes, CancellationSignal cancellation, LayoutResultCallback callback, android.os.Bundle extras) { delegate.onLayout(oldAttributes, newAttributes, cancellation, callback, extras); }
                            @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor destination, CancellationSignal cancellation, WriteResultCallback callback) { delegate.onWrite(pages, destination, cancellation, callback); }
                            @Override public void onFinish() { delegate.onFinish(); view.destroy(); }
                        };
                        PrintManager manager = (PrintManager) getContext().getSystemService(android.content.Context.PRINT_SERVICE);
                        if (manager == null) throw new IllegalStateException("Android printing is unavailable.");
                        manager.print("OpenPOS receipt", adapter, new PrintAttributes.Builder().build());
                        call.resolve();
                    } catch (Exception error) { view.destroy(); reject(call, error); }
                }
            });
            webView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        });
    }
}
