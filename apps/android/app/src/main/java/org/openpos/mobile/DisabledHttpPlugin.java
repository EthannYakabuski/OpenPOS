package org.openpos.mobile;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Disabling Capacitor's fetch patch does not disable its callable generic native HTTP API. */
@CapacitorPlugin(name = "CapacitorHttp")
public class DisabledHttpPlugin extends Plugin {
    @Override public void load() { getBridge().getWebView().removeJavascriptInterface("CapacitorHttpAndroidInterface"); }
    private void deny(PluginCall call) { call.reject("Use the authenticated OpenPOS connection."); }
    @PluginMethod public void request(PluginCall call) { deny(call); }
    @PluginMethod public void get(PluginCall call) { deny(call); }
    @PluginMethod public void post(PluginCall call) { deny(call); }
    @PluginMethod public void put(PluginCall call) { deny(call); }
    @PluginMethod public void patch(PluginCall call) { deny(call); }
    @PluginMethod public void delete(PluginCall call) { deny(call); }
}
