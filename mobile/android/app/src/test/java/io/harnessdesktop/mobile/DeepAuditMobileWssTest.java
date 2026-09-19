package io.harnessdesktop.mobile;

import static org.junit.Assert.*;
import org.junit.Test;
import java.io.IOException;
import java.net.ServerSocket;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import okhttp3.*;
import okio.ByteString;

/** Real Java production listeners, no network, WebView, phone or profile data. */
public final class DeepAuditMobileWssTest {
    private static PairingProfile.RelayConfig config(int n) {
        byte[] key = new byte[32]; Arrays.fill(key, (byte)n);
        return new PairingProfile.RelayConfig("wss://fixture.invalid/ws", "r".repeat(43), Base64.getUrlEncoder().withoutPadding().encodeToString(key), 1);
    }
    static final class FakeSocket implements WebSocket {
        final Request request; final WebSocketListener callback; final List<String> text = new ArrayList<>(); final List<ByteString> binary = new ArrayList<>(); int closes, cancels;
        FakeSocket(Request r, WebSocketListener c) { request=r; callback=c; }
        public Request request() { return request; }
        public long queueSize() { return 0; }
        public boolean send(String s) { text.add(s); return true; }
        public boolean send(ByteString b) { binary.add(b); return true; }
        public boolean close(int code, String reason) { closes++; return true; }
        public void cancel() { cancels++; }
        void welcome() { callback.onMessage(this, "{\"type\":\"welcome\",\"role\":\"mobile\",\"desktopOnline\":true}"); }
    }
    static final class Counter implements WssRelayClient.Listener {
        int ready, failed;
        public void onReady(int port) { assertEquals(43123, port); ready++; }
        public void onFailure(String message) { failed++; }
    }
    static final class Fixture {
        final List<FakeSocket> sockets = new ArrayList<>(); final AtomicInteger servers = new AtomicInteger();
        final WssRelayClient client = new WssRelayClient((request, callback) -> { FakeSocket s=new FakeSocket(request, callback); sockets.add(s); return s; }, () -> {
            servers.incrementAndGet();
            return new ServerSocket() { public int getLocalPort() { return 43123; } public boolean isClosed() { return true; } };
        });
        FakeSocket start(int n, Counter counter) { client.start(config(n), counter); return sockets.get(sockets.size()-1); }
    }
    @Test public void staleCallbacksCannotNotifyOrStopReplacementAcrossTwentyProfiles() {
        for (String event : new String[]{"failure", "closed", "offline", "invalid", "binary", "welcome", "open"}) {
            Fixture f = new Fixture();
            try {
                for (int i=0;i<20;i++) {
                    Counter oldCounter = new Counter(), current = new Counter();
                    FakeSocket old=f.start(i+1,oldCounter), next=f.start(i+2,current);
                    if(event.equals("failure")) old.callback.onFailure(old,new IOException("old fixture"),null);
                    if(event.equals("closed")) old.callback.onClosed(old,1006,"old close");
                    if(event.equals("offline")) old.callback.onMessage(old,"{\"type\":\"desktop-offline\"}");
                    if(event.equals("invalid")) old.callback.onMessage(old,"malformed");
                    if(event.equals("binary")) old.callback.onMessage(old,ByteString.of(new byte[]{0}));
                    if(event.equals("welcome")) old.welcome();
                    if(event.equals("open")) old.callback.onOpen(old,null);
                    assertEquals(event+" must not fail new listener",0,current.failed);
                    assertEquals(event+" must not open old route",0,current.ready);
                    assertEquals(event+" must not close current socket",0,next.closes);
                    assertEquals("late old open must not transmit hello",0,old.text.size());
                    next.callback.onOpen(next,null); next.welcome();
                    assertEquals(1,current.ready); assertEquals(1,next.text.size());
                }
            } finally { f.client.stop(); }
        }
    }
    @Test public void stoppedCallbacksNeverReopenSocksOrTransmitHello() {
        Fixture f=new Fixture(); Counter c=new Counter(); FakeSocket old=f.start(1,c);f.client.stop();
        old.callback.onOpen(old,null);old.welcome();old.callback.onFailure(old,new IOException("stopped"),null);
        assertEquals(0,old.text.size());assertEquals(0,c.ready);assertEquals(0,c.failed);assertEquals(0,f.servers.get());
    }
    @Test public void blockedOldSocksHandshakeClosesOnResetAndCannotSendIntoReplacement() throws Exception {
        Fixture f=new Fixture(); Counter c=new Counter(); f.start(1,c);
        java.lang.reflect.Field field=WssRelayClient.class.getDeclaredField("generation");field.setAccessible(true);
        long generation=field.getLong(f.client);
        java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1), release=new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.atomic.AtomicBoolean closed=new java.util.concurrent.atomic.AtomicBoolean();
        java.net.Socket old=new java.net.Socket() {
            public java.io.InputStream getInputStream() { return new java.io.InputStream() {
                public int read() { return -1; }
                public int read(byte[] bytes,int offset,int length) throws IOException {
                    entered.countDown();
                    try { if(!release.await(2,java.util.concurrent.TimeUnit.SECONDS))throw new IOException("gate timeout"); }
                    catch(InterruptedException error){throw new IOException(error);}
                    throw new IOException("old socket closed");
                }
            }; }
            public java.io.OutputStream getOutputStream(){return new java.io.ByteArrayOutputStream();}
            public void close(){closed.set(true);release.countDown();}
        };
        java.lang.reflect.Method handle=WssRelayClient.class.getDeclaredMethod("handleSocks",long.class,java.net.Socket.class);handle.setAccessible(true);
        java.util.concurrent.ExecutorService worker=java.util.concurrent.Executors.newSingleThreadExecutor();
        try {
            java.util.concurrent.Future<?> job=worker.submit(()->{try{handle.invoke(f.client,generation,old);}catch(Exception error){throw new RuntimeException(error);}});
            assertTrue(entered.await(1,java.util.concurrent.TimeUnit.SECONDS));
            FakeSocket next=f.start(2,new Counter());job.get(2,java.util.concurrent.TimeUnit.SECONDS);
            assertTrue("reset releases old pre-OPEN worker immediately",closed.get());assertTrue(next.binary.isEmpty());
            java.lang.reflect.Method send=WssRelayClient.class.getDeclaredMethod("send",long.class,int.class,long.class,byte[].class);send.setAccessible(true);
            try { send.invoke(f.client,generation,RelayTunnelCodec.DATA,1L,new byte[]{1}); fail("old worker must not send on current transport"); }
            catch(java.lang.reflect.InvocationTargetException expected){assertTrue(expected.getCause() instanceof IOException);}
            assertTrue(next.binary.isEmpty());
        } finally {release.countDown();worker.shutdownNow();f.client.stop();}
    }
    @Test public void malformedCurrentEnvelopeStillFailsClosed() {
        Fixture f=new Fixture();Counter c=new Counter();FakeSocket socket=f.start(1,c);
        try {socket.callback.onMessage(socket,ByteString.of(new byte[]{0}));assertEquals(1,c.failed);assertEquals(1,socket.closes);}
        finally {f.client.stop();}
    }
    @Test public void currentFailureIsReportedExactlyOnceAndCleanRestartWorks() {
        Fixture f=new Fixture();Counter c=new Counter();FakeSocket current=f.start(1,c);
        try {
            current.callback.onOpen(current,null);current.welcome();assertEquals(1,c.ready);
            current.callback.onFailure(current,new IOException("current fixture"),null);
            current.callback.onClosed(current,1006,"close follows failure"); assertEquals(1,c.failed);
            Counter nextCounter=new Counter();FakeSocket next=f.start(2,nextCounter);next.callback.onOpen(next,null);next.welcome();
            assertEquals(1,nextCounter.ready);assertEquals(0,nextCounter.failed);
        } finally { f.client.stop(); }
    }
}
