package io.harnessdesktop.mobile;

import java.nio.ByteBuffer;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class RelayTunnelCodec {
    static final byte VERSION = 1;
    static final int OPEN = 1;
    static final int DATA = 2;
    static final int FIN = 3;
    static final int RESET = 4;
    static final int PING = 5;
    static final int PONG = 6;
    static final int MAX_PAYLOAD = 64 * 1024;

    static final class Frame {
        final int type;
        final long streamId;
        final byte[] payload;
        Frame(int type, long streamId, byte[] payload) { this.type = type; this.streamId = streamId; this.payload = payload; }
    }

    private final SecretKeySpec key;
    private final SecureRandom random;
    private final Map<String, Boolean> replay = new LinkedHashMap<>() {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) { return size() > 4096; }
    };

    RelayTunnelCodec(String base64UrlKey) {
        this(base64UrlKey, new SecureRandom());
    }

    RelayTunnelCodec(String base64UrlKey, SecureRandom random) {
        byte[] decoded = Base64.getUrlDecoder().decode(base64UrlKey);
        if (decoded.length != 32) throw new IllegalArgumentException("Relay key must contain 32 bytes");
        this.key = new SecretKeySpec(decoded, "AES");
        this.random = random;
    }

    byte[] encode(int type, long streamId, byte[] payload) throws GeneralSecurityException {
        if (type < OPEN || type > PONG || streamId < 0 || streamId > 0xffffffffL || payload.length > MAX_PAYLOAD) throw new IllegalArgumentException("Invalid relay frame");
        byte[] plain = ByteBuffer.allocate(6 + payload.length).put(VERSION).put((byte) type).putInt((int) streamId).put(payload).array();
        byte[] nonce = new byte[12];
        random.nextBytes(nonce);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(new byte[]{VERSION});
        byte[] encrypted = cipher.doFinal(plain);
        return ByteBuffer.allocate(1 + nonce.length + encrypted.length).put(VERSION).put(nonce).put(encrypted).array();
    }

    Frame decode(byte[] packet) throws GeneralSecurityException {
        if (packet.length < 35 || packet[0] != VERSION) throw new GeneralSecurityException("Invalid relay packet");
        byte[] nonce = new byte[12];
        System.arraycopy(packet, 1, nonce, 0, nonce.length);
        String replayKey = Base64.getEncoder().encodeToString(nonce);
        synchronized (replay) { if (replay.containsKey(replayKey)) throw new GeneralSecurityException("Relay replay rejected"); }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(new byte[]{VERSION});
        byte[] plain = cipher.doFinal(packet, 13, packet.length - 13);
        if (plain.length < 6 || plain[0] != VERSION) throw new GeneralSecurityException("Invalid relay frame");
        ByteBuffer frame = ByteBuffer.wrap(plain);
        frame.get();
        int type = frame.get() & 0xff;
        long streamId = Integer.toUnsignedLong(frame.getInt());
        byte[] payload = new byte[frame.remaining()];
        frame.get(payload);
        if (type < OPEN || type > PONG || payload.length > MAX_PAYLOAD) throw new GeneralSecurityException("Invalid relay frame");
        synchronized (replay) { replay.put(replayKey, true); }
        return new Frame(type, streamId, payload);
    }
}
