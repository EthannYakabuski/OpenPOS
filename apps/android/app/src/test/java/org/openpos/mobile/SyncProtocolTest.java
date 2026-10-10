package org.openpos.mobile;

import static org.junit.Assert.*;
import org.junit.Test;

public class SyncProtocolTest {
    private final String key = "0123456789abcdef0123456789abcdef";
    private final String nonce = "6fc883ce-2672-4c36-af10-a6f93d4e32f1";
    private final String body = "{\"note\":\"Crème 🍕\",\"revision\":7}";

    @Test public void signsTheExactWindowsWireFormatIncludingUnicode() throws Exception {
        // Independently generated with node:crypto, matching src/main/sync.ts.
        assertEquals("c904dd6d1cf28ae2fe8860addf88de5d66c4b3755f5bf1c140f6df2b2b60e700", SyncProtocol.requestSignature(key, "/v1/execute", "1791547200000", nonce, body));
        assertEquals("733f0f6f616e761f59121271a713f6d4d60281a7f2cd4e8eae739b0852408097", SyncProtocol.responseSignature(key, nonce, 200, body));
    }
    @Test public void rejectsTamperingAndReplayAgainstADifferentRequest() throws Exception {
        String signature = SyncProtocol.responseSignature(key, nonce, 200, body);
        assertTrue(SyncProtocol.verifyResponse(key, nonce, 200, body, signature));
        assertFalse(SyncProtocol.verifyResponse(key, nonce, 200, body + " ", signature));
        assertFalse(SyncProtocol.verifyResponse(key, nonce, 400, body, signature));
        assertFalse(SyncProtocol.verifyResponse(key, "another-nonce", 200, body, signature));
        assertFalse(SyncProtocol.verifyResponse("wrong-shared-key", nonce, 200, body, signature));
        assertFalse(SyncProtocol.verifyResponse(key, nonce, 200, body, null));
        assertFalse(SyncProtocol.verifyResponse(key, nonce, 200, body, signature.substring(1)));
    }
    @Test public void acceptsOnlyPrivateIPv4EndpointsWithExplicitPorts() {
        for (String host : new String[]{"10.0.2.2", "10.1.2.3", "172.16.0.1", "172.31.255.254", "192.168.1.40"}) {
            assertEquals("http://" + host + ":48765", SyncProtocol.validateServerUrl(" http://" + host + ":48765/ "));
        }
        assertEquals("http://10.0.0.1:65535", SyncProtocol.validateServerUrl("http://10.0.0.1:65535"));
    }
    @Test public void rejectsPublicHostsAmbiguousAddressesAndUrlInjection() {
        for (String value : new String[]{
            "https://192.168.1.4:48765", "file:///etc/passwd", "http://example.com:48765", "http://8.8.8.8:48765",
            "http://127.0.0.1:48765", "http://169.254.1.1:48765", "http://172.15.1.1:48765", "http://172.32.1.1:48765",
            "http://192.169.1.4:48765", "http://192.168.256.1:48765", "http://192.168.01.1:48765", "http://[::1]:48765",
            "http://192.168.1.4", "http://192.168.1.4:0", "http://192.168.1.4:65536", "http://user:secret@192.168.1.4:48765",
            "http://192.168.1.4:48765/other", "http://192.168.1.4:48765/?x=1", "http://192.168.1.4:48765/#x",
            "http://3232235777:48765", "http://0xc0a80101:48765", "http://192.168.1.4:48765\\@8.8.8.8", ""
        }) {
            assertThrows(value, IllegalArgumentException.class, () -> SyncProtocol.validateServerUrl(value));
        }
    }
    @Test public void savingPairingRequiresAnExplicitFullKeyEvenWhenPreviouslyConfigured() {
        SyncProtocol.validateExplicitSyncKey("0123456789abcdef01234567");
        SyncProtocol.validateExplicitSyncKey(key);
        for (String candidate : new String[]{null, "", "too-short", " " + key, key + " ", "a".repeat(257)}) {
            assertThrows(IllegalArgumentException.class, () -> SyncProtocol.validateExplicitSyncKey(candidate));
        }
    }
    @Test public void onlyExposesTheKnownProtocolOperations() {
        for (String route : new String[]{"/v1/snapshot", "/v1/execute", "/v1/unlock", "/v1/lock", "/v1/audit"}) SyncProtocol.validateRoute(route);
        for (String route : new String[]{"/v1/password", "/v1/unknown", "//8.8.8.8", "http://8.8.8.8", "/v1/snapshot?x=1", "/v1/../execute", ""}) assertThrows(IllegalArgumentException.class, () -> SyncProtocol.validateRoute(route));
    }
}
