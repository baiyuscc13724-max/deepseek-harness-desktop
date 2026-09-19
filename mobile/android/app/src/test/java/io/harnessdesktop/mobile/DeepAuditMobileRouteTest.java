package io.harnessdesktop.mobile;

import static org.junit.Assert.*;
import org.junit.Test;
import java.io.IOException;
import java.net.Socket;
import java.lang.reflect.Method;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Production route selection with fake, unconnected sockets. Never contacts a phone/server. */
public final class DeepAuditMobileRouteTest {
    private static final PairingProfile.Route ROUTE = new PairingProfile.Route("wss-relay", "192.0.2.1", 3081);
    private static HarnessWebProxy.ConnectedRoute connect(HarnessWebProxy proxy) throws Exception {
        Method method = HarnessWebProxy.class.getDeclaredMethod("connectRoute");
        method.setAccessible(true);
        return (HarnessWebProxy.ConnectedRoute) method.invoke(proxy);
    }
    private static void await(CountDownLatch gate) throws IOException {
        try { if (!gate.await(3, TimeUnit.SECONDS)) throw new IOException("fixture gate timeout"); }
        catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IOException(error); }
    }
    @Test public void parallelWarmRequestsNeverWaitBehindAnotherSocketConnect() throws Exception {
        AtomicBoolean warm = new AtomicBoolean();
        CountDownLatch entered = new CountDownLatch(6), release = new CountDownLatch(1);
        ExecutorService workers = Executors.newFixedThreadPool(6);
        HarnessWebProxy proxy = new HarnessWebProxy(null, route -> {
            if (warm.get()) { entered.countDown(); await(release); }
            return new Socket();
        });
        proxy.updateRoutes(List.of(ROUTE)); connect(proxy).socket().close(); warm.set(true);
        List<Future<HarnessWebProxy.ConnectedRoute>> jobs = new ArrayList<>();
        try {
            for (int i=0;i<6;i++) jobs.add(workers.submit(() -> connect(proxy)));
            assertTrue("six requests must enter connector independently, not one monitor queue", entered.await(700, TimeUnit.MILLISECONDS));
        } finally {
            release.countDown();
            for (Future<HarnessWebProxy.ConnectedRoute> job : jobs) { HarnessWebProxy.ConnectedRoute route = job.get(4, TimeUnit.SECONDS); if (route != null) route.socket().close(); }
            workers.shutdownNow(); proxy.close();
        }
    }
    @Test public void networkResetRejectsLateWarmSuccessAndDoesNotRestorePreference() throws Exception {
        AtomicBoolean warm = new AtomicBoolean(); CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
        Socket late = new Socket(); ExecutorService worker = Executors.newSingleThreadExecutor();
        HarnessWebProxy proxy = new HarnessWebProxy(null, route -> { if (warm.get()) { entered.countDown(); await(release); return late; } return new Socket(); });
        proxy.updateRoutes(List.of(ROUTE)); connect(proxy).socket().close(); warm.set(true);
        Future<HarnessWebProxy.ConnectedRoute> job = worker.submit(() -> connect(proxy));
        try {
            assertTrue(entered.await(1, TimeUnit.SECONDS)); proxy.resetRoutePreference(8); release.countDown();
            assertNull("old network cannot supply a socket after reset", job.get(4, TimeUnit.SECONDS));
            assertNull(proxy.connectionState().lastGoodRouteKey()); assertTrue(late.isClosed());
        } finally { release.countDown(); worker.shutdownNow(); proxy.close(); }
    }
    @Test public void lateFailureCannotBackoffNewNetworkAndLateProfileOrClosedSocketIsRejected() throws Exception {
        for (String action : new String[]{"failure", "profile", "close"}) {
            AtomicBoolean warm = new AtomicBoolean(); CountDownLatch entered = new CountDownLatch(1), release = new CountDownLatch(1);
            Socket late = new Socket(); ExecutorService worker = Executors.newSingleThreadExecutor();
            HarnessWebProxy proxy = new HarnessWebProxy(null, route -> {
                if (!warm.get()) return new Socket();
                entered.countDown(); await(release);
                if (action.equals("failure")) throw new IOException("fixture old network failed");
                return late;
            });
            proxy.updateRoutes(List.of(ROUTE)); connect(proxy).socket().close(); warm.set(true);
            Future<HarnessWebProxy.ConnectedRoute> job = worker.submit(() -> connect(proxy));
            try {
                assertTrue(entered.await(1, TimeUnit.SECONDS));
                if (action.equals("profile")) proxy.updateRoutes(List.of());
                else if (action.equals("close")) proxy.close();
                else proxy.resetRoutePreference(99);
                release.countDown(); assertNull(job.get(4, TimeUnit.SECONDS));
                assertEquals("old failures cannot delay recovery", 0, proxy.connectionState().recoveryCursor());
                if (!action.equals("failure")) assertTrue(late.isClosed());
            } finally { release.countDown(); worker.shutdownNow(); proxy.close(); }
        }
    }
    @Test public void coldDeadLanFallsBackOnceWithoutReplayingBusinessBytes() throws Exception {
        PairingProfile.Route lan = new PairingProfile.Route("lan", "192.0.2.9", 3081);
        AtomicInteger attempts = new AtomicInteger(); CountDownLatch release = new CountDownLatch(1);
        HarnessWebProxy proxy = new HarnessWebProxy(null, route -> { attempts.incrementAndGet(); if (route.id.equals("lan")) { await(release); throw new IOException("fixture dead LAN"); } return new Socket(); });
        proxy.updateRoutes(List.of(lan, ROUTE));
        try {
            HarnessWebProxy.ConnectedRoute result = connect(proxy);
            assertNotNull(result); assertEquals(ROUTE.key(), result.route().key()); result.socket().close();
            assertEquals(2, attempts.get());
            assertEquals("route selection only creates sockets; requests are sent once later", ROUTE.key(), proxy.connectionState().lastGoodRouteKey());
        } finally { release.countDown(); proxy.close(); }
    }
    @Test public void sixRequestLatencyDistributionWithControlledEightyMillisecondConnect() throws Exception {
        AtomicBoolean warm = new AtomicBoolean(); ExecutorService workers = Executors.newFixedThreadPool(6);
        HarnessWebProxy proxy = new HarnessWebProxy(null, route -> { if (warm.get()) { try { Thread.sleep(80); } catch (InterruptedException error) { throw new IOException(error); } } return new Socket(); });
        proxy.updateRoutes(List.of(ROUTE)); connect(proxy).socket().close(); warm.set(true);
        List<Long> samples = new ArrayList<>();
        try {
            for (int batch=0; batch<5; batch++) {
                CountDownLatch start = new CountDownLatch(1); List<Future<Long>> jobs = new ArrayList<>();
                for (int i=0;i<6;i++) jobs.add(workers.submit(() -> { start.await(); long t=System.nanoTime(); connect(proxy).socket().close(); return TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-t); }));
                start.countDown(); for (Future<Long> job : jobs) samples.add(job.get(5, TimeUnit.SECONDS));
            }
            Collections.sort(samples);
            System.out.println("ROUTE_LATENCY_FIXTURE n="+samples.size()+" p50="+samples.get(14)+" p95="+samples.get(28)+" p99="+samples.get(29)+" ms; delay=80ms concurrency=6; not WAN evidence");
        } finally { workers.shutdownNow(); proxy.close(); }
    }
}
