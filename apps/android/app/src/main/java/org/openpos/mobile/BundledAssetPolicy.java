package org.openpos.mobile;

import java.net.URI;

/** Remote content and Capacitor's generic file/content bridge URLs are never part of the app UI. */
public final class BundledAssetPolicy {
    private BundledAssetPolicy() {}
    public static boolean allows(String value) {
        try {
            URI uri = new URI(value);
            String path = uri.getPath();
            return "https".equals(uri.getScheme()) && "localhost".equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443) && uri.getRawUserInfo() == null
                && path != null && !path.contains("/_capacitor_");
        } catch (Exception exception) { return false; }
    }
}
