package org.openpos.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

/** The key never leaves Android Keystore; neither backup nor the JavaScript bridge can read it. */
final class ConnectionStore {
    private static final String ALIAS = "openpos.connection.v1";
    private final SharedPreferences preferences;
    ConnectionStore(Context context) { preferences = context.getSharedPreferences("openpos-private", Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(ALIAS)) return (SecretKey) store.getKey(ALIAS, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build());
        return generator.generateKey();
    }
    synchronized JSONObject read() throws Exception {
        String stored = preferences.getString("connection", null);
        if (stored == null) {
            JSONObject initial = new JSONObject().put("clientId", UUID.randomUUID().toString()).put("deviceName", "Android " + Build.MODEL).put("serverUrl", "").put("defaultTab", "menu").put("syncKey", "");
            write(initial);
            return initial;
        }
        try {
            JSONObject envelope = new JSONObject(stored);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)));
            return new JSONObject(new String(cipher.doFinal(Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
        } catch (Exception exception) {
            throw new IllegalStateException("The encrypted pairing settings could not be opened. Clear this app's storage in Android Settings and pair it again.");
        }
    }
    synchronized void write(JSONObject connection) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        JSONObject envelope = new JSONObject().put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP)).put("ciphertext", Base64.encodeToString(cipher.doFinal(connection.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        if (!preferences.edit().putString("connection", envelope.toString()).commit()) throw new IllegalStateException("The pairing settings could not be saved.");
    }
}
