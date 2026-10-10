package org.openpos.mobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class BundledAssetPolicyTest {
    @Test public void acceptsBundledAssetsAndRejectsNativeFileBridgesAndExternalNavigation() {
        for (String url : new String[]{"https://localhost/", "https://localhost/index.html", "https://localhost/app.js", "https://localhost:443/help/style.css"}) assertTrue(url, BundledAssetPolicy.allows(url));
        for (String url : new String[]{"https://example.com/", "http://192.168.1.1:3210/", "http://localhost/", "https://localhost:444/app.js", "https://user@localhost/", "file:///data/data/org.openpos.mobile/shared_prefs/openpos-private.xml", "content://provider/file", "https://localhost/_capacitor_file_/data/data/private", "https://localhost/%5Fcapacitor_content_/provider/data", "https://localhost/_capacitor_http_interceptor_?u=http://public.example", "https://localhost.evil/", "javascript:alert(1)"}) assertFalse(url, BundledAssetPolicy.allows(url));
    }
}
