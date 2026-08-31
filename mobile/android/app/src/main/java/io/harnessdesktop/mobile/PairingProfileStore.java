package io.harnessdesktop.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.Locale;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

final class PairingProfileStore {
    private static final String KEY_ALIAS = "harness-mobile-pairing-v1";
    private static final String SECURE_PROFILE = "saved_profile_secure";
    private final SharedPreferences preferences;

    PairingProfileStore(Context context) {
        preferences = context.getSharedPreferences(MainActivity.PREFS, Context.MODE_PRIVATE);
    }

    PairingProfile loadAndMigrate() {
        String encrypted = preferences.getString(SECURE_PROFILE, "");
        if (encrypted != null && !encrypted.isEmpty()) {
            try { return PairingProfile.fromStoredJson(decrypt(encrypted)); }
            catch (Exception ignored) { return null; }
        }
        String legacy = preferences.getString(MainActivity.SAVED_PROFILE, "");
        PairingProfile profile = PairingProfile.fromStoredJson(legacy);
        if (profile != null) {
            try { save(profile); } catch (Exception ignored) {}
        }
        preferences.edit().remove(MainActivity.SAVED_PROFILE).apply();
        return profile;
    }

    void save(PairingProfile profile) throws Exception {
        preferences.edit().putString(SECURE_PROFILE, encrypt(profile.toJson())).remove(MainActivity.SAVED_PROFILE).apply();
    }

    void clear() {
        preferences.edit().remove(SECURE_PROFILE).remove(MainActivity.SAVED_PROFILE).apply();
    }

    /**
     * Returns a non-reversible namespace for offline state. The pairing URL includes
     * the desktop-issued pairing identity, so re-pairing cannot see a previous
     * profile's cache; only its digest is ever written outside encrypted storage.
     */
    static String cacheIdentity(PairingProfile profile) {
        if (profile == null || profile.pairUrl == null || profile.pairUrl.isEmpty()) return "";
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(profile.pairUrl.getBytes(StandardCharsets.UTF_8));
            StringBuilder output = new StringBuilder(digest.length * 2);
            for (byte item : digest) output.append(String.format(Locale.ROOT, "%02x", item & 0xff));
            return output.toString();
        } catch (Exception error) {
            throw new IllegalStateException(error);
        }
    }

    private String encrypt(String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] ciphertext = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] result = new byte[1 + cipher.getIV().length + ciphertext.length];
        result[0] = (byte) cipher.getIV().length;
        System.arraycopy(cipher.getIV(), 0, result, 1, cipher.getIV().length);
        System.arraycopy(ciphertext, 0, result, 1 + cipher.getIV().length, ciphertext.length);
        return Base64.getEncoder().encodeToString(result);
    }

    private String decrypt(String value) throws Exception {
        byte[] input = Base64.getDecoder().decode(value);
        int ivLength = input.length == 0 ? 0 : input[0] & 0xff;
        if (ivLength < 12 || ivLength > 16 || input.length < 1 + ivLength + 16) throw new IllegalArgumentException("Encrypted pairing profile is truncated");
        byte[] iv = new byte[ivLength];
        System.arraycopy(input, 1, iv, 0, iv.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(input, 1 + iv.length, input.length - 1 - iv.length), StandardCharsets.UTF_8);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }
}
