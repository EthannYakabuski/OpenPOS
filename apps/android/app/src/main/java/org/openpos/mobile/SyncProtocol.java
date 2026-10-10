package org.openpos.mobile;

import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Set;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** Wire contract shared with src/main/sync.ts. No Android APIs so fixtures run on the JVM. */
public final class SyncProtocol {
    public static final int MAX_REQUEST = 2 * 1024 * 1024;
    public static final int MAX_RESPONSE = 64 * 1024 * 1024;
    private static final Set<String> ROUTES = new java.util.HashSet<>(java.util.Arrays.asList("/v1/snapshot", "/v1/execute", "/v1/unlock", "/v1/lock", "/v1/audit"));
    private SyncProtocol() {}

    public static String validateServerUrl(String value) {
        try {
            URI uri = new URI(value.trim());
            String host = uri.getHost();
            if (!"http".equals(uri.getScheme()) || host == null || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || (!uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath()))) throw new IllegalArgumentException();
            String[] pieces = host.split("\\.", -1);
            if (pieces.length != 4) throw new IllegalArgumentException();
            int[] ip = new int[4];
            for (int i = 0; i < 4; i++) {
                if (!pieces[i].matches("0|[1-9][0-9]{0,2}")) throw new IllegalArgumentException();
                ip[i] = Integer.parseInt(pieces[i]);
                if (ip[i] > 255) throw new IllegalArgumentException();
            }
            boolean privateAddress = ip[0] == 10 || (ip[0] == 172 && ip[1] >= 16 && ip[1] <= 31) || (ip[0] == 192 && ip[1] == 168);
            if (!privateAddress || uri.getPort() < 1 || uri.getPort() > 65535) throw new IllegalArgumentException();
            return "http://" + host + ":" + uri.getPort();
        } catch (Exception exception) {
            throw new IllegalArgumentException("Use the master's private IPv4 address and port, for example http://192.168.1.10:3210.");
        }
    }

    /** Never treat the stored connection secret as permission to change local pairing. */
    public static void validateExplicitSyncKey(String key) {
        if (key == null || key.length() < 24 || key.length() > 256 || !key.equals(key.trim())) {
            throw new IllegalArgumentException("Enter the complete master sync key (24 to 256 characters) to save connection settings.");
        }
    }

    public static void validateRoute(String route) {
        if (!ROUTES.contains(route)) throw new IllegalArgumentException("This operation is not supported.");
    }

    public static String digest(String value) throws Exception {
        return hex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }
    private static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte b : value) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 0xff));
        return result.toString();
    }
    private static String hmac(String key, String value) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return hex(mac.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    }
    public static String requestSignature(String key, String route, String time, String nonce, String body) throws Exception {
        validateRoute(route);
        return hmac(key, String.join("\n", "POST", route, time, nonce, digest(body)));
    }
    public static String responseSignature(String key, String nonce, int status, String body) throws Exception {
        return hmac(key, String.join("\n", nonce, Integer.toString(status), digest(body)));
    }
    public static boolean verifyResponse(String key, String nonce, int status, String body, String signature) throws Exception {
        if (signature == null || !signature.matches("[a-f0-9]{64}")) return false;
        return MessageDigest.isEqual(responseSignature(key, nonce, status, body).getBytes(StandardCharsets.US_ASCII), signature.getBytes(StandardCharsets.US_ASCII));
    }
}



