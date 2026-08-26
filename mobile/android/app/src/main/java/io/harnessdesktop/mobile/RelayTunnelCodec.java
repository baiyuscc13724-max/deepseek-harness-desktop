package io.harnessdesktop.mobile;

import java.math.BigInteger;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class RelayTunnelCodec {
    static final byte VERSION = 1;
    static final byte NATIVE_P2P_VERSION = 2;
    static final int DIRECTION_DESKTOP_TO_MOBILE = 1;
    static final int DIRECTION_MOBILE_TO_DESKTOP = 2;
    static final int OPEN = 1;
    static final int DATA = 2;
    static final int FIN = 3;
    static final int RESET = 4;
    static final int PING = 5;
    static final int PONG = 6;
    static final int MAX_PAYLOAD = 64 * 1024;
    static final int MAX_PACKET = MAX_PAYLOAD + 64;
    static final int NATIVE_P2P_REPLAY_WINDOW = 4096;
    private static final BigInteger NATIVE_P2P_REPLAY_MASK = BigInteger.ONE.shiftLeft(NATIVE_P2P_REPLAY_WINDOW).subtract(BigInteger.ONE);

    static final class Frame {
        final int type;
        final long streamId;
        final byte[] payload;
        final long sequence;
        Frame(int type, long streamId, byte[] payload) { this(type, streamId, payload, -1L); }
        Frame(int type, long streamId, byte[] payload, long sequence) {
            this.type = type;
            this.streamId = streamId;
            this.payload = payload;
            this.sequence = sequence;
        }
    }

    static final class NativeP2pSession {
        final byte[] transcript;
        final byte[] sessionKey;
        final byte[] sessionId;
        NativeP2pSession(byte[] transcript, byte[] sessionKey, byte[] sessionId) {
            this.transcript = transcript.clone();
            this.sessionKey = sessionKey.clone();
            this.sessionId = sessionId.clone();
        }
        String sessionIdBase64Url() { return Base64.getUrlEncoder().withoutPadding().encodeToString(sessionId); }
    }

    private final SecretKeySpec key;
    private final SecureRandom random;
    private final Map<String, Boolean> replay = new LinkedHashMap<>() {
        @Override protected boolean removeEldestEntry(Map.Entry<String, Boolean> eldest) { return size() > 4096; }
    };

    RelayTunnelCodec(String base64UrlKey) { this(base64UrlKey, new SecureRandom()); }

    RelayTunnelCodec(String base64UrlKey, SecureRandom random) {
        byte[] decoded = decodeBase64Url32(base64UrlKey, "Relay key");
        this.key = new SecretKeySpec(decoded, "AES");
        this.random = random;
    }

    byte[] encode(int type, long streamId, byte[] payload) throws GeneralSecurityException {
        byte[] plain = encodePlainFrame(type, streamId, payload);
        byte[] nonce = new byte[12];
        random.nextBytes(nonce);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(new byte[]{VERSION});
        byte[] encrypted = cipher.doFinal(plain);
        return ByteBuffer.allocate(1 + nonce.length + encrypted.length).put(VERSION).put(nonce).put(encrypted).array();
    }

    Frame decode(byte[] packet) throws GeneralSecurityException {
        if (packet == null || packet.length < 35 || packet.length > MAX_PACKET || packet[0] != VERSION) {
            throw new GeneralSecurityException("Invalid relay packet");
        }
        byte[] nonce = new byte[12];
        System.arraycopy(packet, 1, nonce, 0, nonce.length);
        String replayKey = Base64.getEncoder().encodeToString(nonce);
        synchronized (replay) { if (replay.containsKey(replayKey)) throw new GeneralSecurityException("Relay replay rejected"); }
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));
        cipher.updateAAD(new byte[]{VERSION});
        byte[] plain = cipher.doFinal(packet, 13, packet.length - 13);
        Frame frame = decodePlainFrame(plain, -1L);
        synchronized (replay) { replay.put(replayKey, true); }
        return frame;
    }

    static NativeP2pSession deriveNativeP2pSession(
        String roomKey,
        String roomId,
        String peerId,
        String desktopNonce,
        String mobileNonce
    ) throws GeneralSecurityException {
        byte[] key = decodeBase64Url32(roomKey, "Native P2P room key");
        if (roomId == null || !roomId.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException("Native P2P room id is invalid");
        if (peerId == null || !peerId.matches("[a-f0-9]{16}")) throw new IllegalArgumentException("Native P2P peer id is invalid");
        decodeBase64Url32(desktopNonce, "Native P2P desktop nonce");
        decodeBase64Url32(mobileNonce, "Native P2P mobile nonce");
        String value = "native-p2p-v2\n" + roomId + "\n" + peerId + "\n" + desktopNonce + "\n" + mobileNonce;
        byte[] transcript = value.getBytes(StandardCharsets.US_ASCII);
        Mac hmac = Mac.getInstance("HmacSHA256");
        hmac.init(new SecretKeySpec(key, "HmacSHA256"));
        byte[] sessionKey = hmac.doFinal(transcript);
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(transcript);
        byte[] sessionId = new byte[16];
        System.arraycopy(digest, 0, sessionId, 0, sessionId.length);
        return new NativeP2pSession(transcript, sessionKey, sessionId);
    }

    static final class NativeP2pSessionCodec {
        private final SecretKeySpec key;
        private final byte[] sessionId;
        private final byte[] peerId;
        private final int sendDirection;
        private final int receiveDirection;
        private final SecureRandom random;
        private long sendSequence;
        private boolean sendSequenceExhausted;
        private boolean hasReceived;
        private long receiveHighest;
        private BigInteger receiveBitmap = BigInteger.ZERO;

        NativeP2pSessionCodec(byte[] key, byte[] sessionId, String peerId, int sendDirection, int receiveDirection) {
            this(key, sessionId, peerId, sendDirection, receiveDirection, new SecureRandom(), 0L);
        }

        NativeP2pSessionCodec(
            byte[] key,
            byte[] sessionId,
            String peerId,
            int sendDirection,
            int receiveDirection,
            SecureRandom random,
            long initialSequence
        ) {
            if (key == null || key.length != 32) throw new IllegalArgumentException("Native P2P session key must contain 32 bytes");
            if (sessionId == null || sessionId.length != 16) throw new IllegalArgumentException("Native P2P session id is invalid");
            if (peerId == null || !peerId.matches("[a-f0-9]{16}")) throw new IllegalArgumentException("Native P2P peer id is invalid");
            if ((sendDirection != DIRECTION_DESKTOP_TO_MOBILE && sendDirection != DIRECTION_MOBILE_TO_DESKTOP)
                || (receiveDirection != DIRECTION_DESKTOP_TO_MOBILE && receiveDirection != DIRECTION_MOBILE_TO_DESKTOP)
                || sendDirection == receiveDirection) throw new IllegalArgumentException("Native P2P directions are invalid");
            this.key = new SecretKeySpec(key.clone(), "AES");
            this.sessionId = sessionId.clone();
            this.peerId = hex(peerId);
            this.sendDirection = sendDirection;
            this.receiveDirection = receiveDirection;
            this.random = random;
            this.sendSequence = initialSequence;
        }

        synchronized byte[] encode(int type, long streamId, byte[] payload) throws GeneralSecurityException {
            if (sendSequenceExhausted) throw new GeneralSecurityException("Native P2P sequence exhausted");
            byte[] plain = encodeNativeP2pPlainFrame(type, streamId, payload);
            byte[] header = ByteBuffer.allocate(10).put(NATIVE_P2P_VERSION).put((byte) sendDirection).putLong(sendSequence).array();
            if (sendSequence == -1L) sendSequenceExhausted = true;
            else sendSequence++;
            byte[] nonce = new byte[12];
            random.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            cipher.updateAAD(aad(header));
            byte[] encrypted = cipher.doFinal(plain);
            return ByteBuffer.allocate(header.length + nonce.length + encrypted.length).put(header).put(nonce).put(encrypted).array();
        }

        synchronized Frame decode(byte[] packet) throws GeneralSecurityException {
            if (packet == null || packet.length < 44 || packet.length > MAX_PACKET || packet[0] != NATIVE_P2P_VERSION) {
                throw new GeneralSecurityException("Native P2P encrypted packet is invalid");
            }
            if ((packet[1] & 0xff) != receiveDirection) throw new GeneralSecurityException("Native P2P packet direction was rejected");
            byte[] header = new byte[10];
            System.arraycopy(packet, 0, header, 0, header.length);
            long sequence = ByteBuffer.wrap(header, 2, 8).getLong();
            byte[] nonce = new byte[12];
            System.arraycopy(packet, 10, nonce, 0, nonce.length);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(128, nonce));
            cipher.updateAAD(aad(header));
            byte[] plain = cipher.doFinal(packet, 22, packet.length - 22);
            acceptSequence(sequence);
            return decodeNativeP2pPlainFrame(plain, sequence);
        }

        private byte[] aad(byte[] header) {
            return ByteBuffer.allocate(header.length + peerId.length + sessionId.length).put(header).put(peerId).put(sessionId).array();
        }

        private void acceptSequence(long sequence) throws GeneralSecurityException {
            if (!hasReceived) {
                hasReceived = true;
                receiveHighest = sequence;
                receiveBitmap = BigInteger.ONE;
                return;
            }
            int comparison = Long.compareUnsigned(sequence, receiveHighest);
            if (comparison > 0) {
                long shift = sequence - receiveHighest;
                receiveBitmap = Long.compareUnsigned(shift, NATIVE_P2P_REPLAY_WINDOW) >= 0
                    ? BigInteger.ONE
                    : receiveBitmap.shiftLeft((int) shift).or(BigInteger.ONE).and(NATIVE_P2P_REPLAY_MASK);
                receiveHighest = sequence;
                return;
            }
            long delta = receiveHighest - sequence;
            if (Long.compareUnsigned(delta, NATIVE_P2P_REPLAY_WINDOW) >= 0) {
                throw new GeneralSecurityException("Native P2P packet is outside the replay window");
            }
            int bit = (int) delta;
            if (receiveBitmap.testBit(bit)) throw new GeneralSecurityException("Native P2P replayed packet was rejected");
            receiveBitmap = receiveBitmap.setBit(bit);
        }
    }

    private static byte[] encodePlainFrame(int type, long streamId, byte[] payload) {
        if (type < OPEN || type > PONG || streamId < 0 || streamId > 0xffffffffL || payload == null || payload.length > MAX_PAYLOAD) {
            throw new IllegalArgumentException("Invalid relay frame");
        }
        return ByteBuffer.allocate(6 + payload.length).put(VERSION).put((byte) type).putInt((int) streamId).put(payload).array();
    }

    private static byte[] encodeNativeP2pPlainFrame(int type, long streamId, byte[] payload) {
        byte[] frame = encodePlainFrame(type, streamId, payload);
        frame[0] = NATIVE_P2P_VERSION;
        return frame;
    }

    private static Frame decodePlainFrame(byte[] plain, long sequence) throws GeneralSecurityException {
        return decodeVersionedPlainFrame(plain, sequence, VERSION, "Invalid relay frame");
    }

    private static Frame decodeNativeP2pPlainFrame(byte[] plain, long sequence) throws GeneralSecurityException {
        return decodeVersionedPlainFrame(plain, sequence, NATIVE_P2P_VERSION, "Invalid native P2P frame");
    }

    private static Frame decodeVersionedPlainFrame(byte[] plain, long sequence, byte version, String message) throws GeneralSecurityException {
        if (plain == null || plain.length < 6 || plain.length > MAX_PAYLOAD + 6 || plain[0] != version) {
            throw new GeneralSecurityException(message);
        }
        ByteBuffer frame = ByteBuffer.wrap(plain);
        frame.get();
        int type = frame.get() & 0xff;
        long streamId = Integer.toUnsignedLong(frame.getInt());
        byte[] payload = new byte[frame.remaining()];
        frame.get(payload);
        if (type < OPEN || type > PONG || payload.length > MAX_PAYLOAD) throw new GeneralSecurityException(message);
        return new Frame(type, streamId, payload, sequence);
    }

    private static byte[] decodeBase64Url32(String value, String label) {
        try {
            if (value == null || !value.matches("[A-Za-z0-9_-]{43}")) throw new IllegalArgumentException(label + " must be canonical base64url");
            byte[] decoded = Base64.getUrlDecoder().decode(value);
            if (decoded.length != 32) throw new IllegalArgumentException(label + " must contain 32 bytes");
            return decoded;
        } catch (IllegalArgumentException error) {
            throw error;
        }
    }

    private static byte[] hex(String value) {
        byte[] result = new byte[value.length() / 2];
        for (int index = 0; index < result.length; index++) {
            result[index] = (byte) Integer.parseInt(value.substring(index * 2, index * 2 + 2), 16);
        }
        return result;
    }
}
