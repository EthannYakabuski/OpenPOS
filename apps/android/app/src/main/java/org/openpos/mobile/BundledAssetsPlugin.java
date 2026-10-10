package org.openpos.mobile;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** The renderer may only load the app assets installed in the signed application package. */
@CapacitorPlugin(name = "WebView")
public class BundledAssetsPlugin extends Plugin {
    private void deny(PluginCall call) { call.reject("OpenPOS only loads its bundled interface."); }
    @PluginMethod public void setServerAssetPath(PluginCall call) { deny(call); }
    @PluginMethod public void setServerBasePath(PluginCall call) { deny(call); }
    @PluginMethod public void persistServerBasePath(PluginCall call) { deny(call); }
    @PluginMethod public void getServerBasePath(PluginCall call) { deny(call); }
}
