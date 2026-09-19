package io.harnessdesktop.mobile;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import java.util.regex.*;
import okhttp3.*;
import okio.ByteString;
import org.json.*;

/** Executable selected JVM fixture. Real proxy, SOCKS, WSS, codec; no Android UI.
 * Launched only by tests/fixtures/deep-audit-mobile-chain.cjs on allocated fixture ports.
 */
public final class DeepAuditMobileChainTest {
    static final long NANO = System.nanoTime();
    static final double WALL = System.currentTimeMillis();
    static double now() { return WALL + (System.nanoTime()-NANO)/1e6; }
    static JSONObject config;
    static final List<JSONObject> events=Collections.synchronizedList(new ArrayList<>());
    static final List<JSONObject> results=Collections.synchronizedList(new ArrayList<>());
    static final List<TraceSocket> sockets=Collections.synchronizedList(new ArrayList<>());
    static final Pattern ID=Pattern.compile("(?i)X-Fixture-Id: ([a-z0-9-]+)");
    static final ExecutorService clients=Executors.newFixedThreadPool(8);
    static OkHttpClient http;
    static WssRelayClient relay;
    static HarnessWebProxy proxy;
    static int epoch;
    static double clockOffset, clockUncertainty;
    static String sha(byte[] bytes) { try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); } catch(Exception e){throw new RuntimeException(e);} }
    static void require(boolean ok,String message) { if(!ok)throw new AssertionError(message); }
    static void event(String stage,String id,JSONObject extra) {
        JSONObject value=extra==null?new JSONObject():extra;
        value.put("stage",stage).put("id",id==null?JSONObject.NULL:id).put("at",now()); events.add(value);
    }
    @SuppressWarnings("removal")
    static void installNetworkFence() {
        Set<Integer> allowed=Set.of(config.getInt("proxyPort"),config.getInt("socksPort"),config.getInt("relayPort"),config.getInt("controlPort"));
        System.setSecurityManager(new SecurityManager() {
            public void checkPermission(Permission p) { }
            public void checkExec(String cmd){throw new SecurityException("fixture forbids subprocesses");}
            public void checkConnect(String host,int port){
                if(!"127.0.0.1".equals(host) || (port!=-1&&!allowed.contains(port)))throw new SecurityException("non-fixture connect refused");
            }
            public void checkListen(int port){if(port!=config.getInt("proxyPort")&&port!=config.getInt("socksPort"))throw new SecurityException("non-fixture listen refused");}
            public void checkAccept(String host,int port){if(!"127.0.0.1".equals(host))throw new SecurityException("non-loopback accept refused");}
        });
        try { new Socket().connect(new InetSocketAddress("127.0.0.1",60131)); throw new AssertionError("fence did not deny GUI"); }
        catch(SecurityException expected){event("networkFence",null,new JSONObject().put("denied",60131));}
        catch(IOException error){throw new AssertionError("must deny before connect",error);}
    }
    static final class TraceSocket implements WebSocket {
        final WebSocket wire; final WebSocketListener production; final int generation;
        final RelayTunnelCodec outgoing, incoming;
        final Map<Long,String> streamIds=new ConcurrentHashMap<>();
        volatile ByteString lastBinary;
        TraceSocket(WebSocket wire,WebSocketListener callback,int n){this.wire=wire;production=callback;generation=n;outgoing=new RelayTunnelCodec(config.getString("key"));incoming=new RelayTunnelCodec(config.getString("key"));}
        void trace(String stage,ByteString bytes,boolean inbound) {
            try {
                byte[] envelope=bytes.toByteArray();
                RelayTunnelCodec.Frame frame=(inbound?incoming:outgoing).decode(Arrays.copyOfRange(envelope,8,envelope.length));
                Matcher found=ID.matcher(new String(frame.payload,StandardCharsets.ISO_8859_1));
                if(found.find())streamIds.put(frame.streamId,found.group(1));
                event(stage,streamIds.get(frame.streamId),new JSONObject().put("epoch",generation).put("stream",frame.streamId).put("type",frame.type).put("bytes",envelope.length).put("packet",sha(Arrays.copyOfRange(envelope,8,envelope.length))));
            } catch(Exception error){event("traceError",null,new JSONObject().put("message",error.toString()));}
        }
        public Request request(){return wire.request();}
        public long queueSize(){return wire.queueSize();}
        public boolean send(String text){return wire.send(text);}
        public boolean send(ByteString bytes){trace("mobileEnqueue",bytes,false);return wire.send(bytes);}
        public boolean close(int code,String reason){return wire.close(code,reason);}
        public void cancel(){wire.cancel();}
    }
    static void startRelay() throws Exception {
        CountDownLatch ready=new CountDownLatch(1);AtomicReference<String> failure=new AtomicReference<>();int n=++epoch;
        relay.start(new PairingProfile.RelayConfig("wss://fixture.invalid/chain",config.getString("room"),config.getString("key"),1),new WssRelayClient.Listener(){
            public void onReady(int port){event("relayReady",null,new JSONObject().put("epoch",n).put("port",port));ready.countDown();}
            public void onFailure(String message){failure.set(message);event("relayFailure",null,new JSONObject().put("epoch",n).put("message",message));ready.countDown();}
        });
        require(ready.await(6,TimeUnit.SECONDS)&&failure.get()==null,"fixture relay handshake failed: "+failure.get());
        PairingProfile.Route route=new PairingProfile.Route("wss-relay","127.0.0.1",config.getInt("gatewayPort"),"127.0.0.1",config.getInt("socksPort"));
        proxy.updateRoutes(List.of(route));proxy.resetRoutePreference(n);
    }
    static JSONObject control(String path) throws Exception {
        byte[] bytes=raw(config.getInt("controlPort"),"GET "+path+" HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",new byte[0],8000);
        return new JSONObject(new String(body(bytes),StandardCharsets.UTF_8));
    }
    static byte[] raw(int port,String header,byte[] payload,int timeout) throws IOException {
        try(Socket socket=new Socket()) {
            socket.connect(new InetSocketAddress("127.0.0.1",port),1500);socket.setSoTimeout(timeout);socket.setTcpNoDelay(true);
            OutputStream output=socket.getOutputStream();output.write(header.getBytes(StandardCharsets.ISO_8859_1));output.write(payload);output.flush();
            ByteArrayOutputStream bytes=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
            while((n=socket.getInputStream().read(buffer))>=0){bytes.write(buffer,0,n);if(bytes.size()>2*1024*1024)throw new IOException("response fixture bound");}
            return bytes.toByteArray();
        }
    }
    static byte[] body(byte[] response) throws IOException {
        String text=new String(response,StandardCharsets.ISO_8859_1);int split=text.indexOf("\r\n\r\n");
        if(split<0||!text.startsWith("HTTP/1.1 200"))throw new IOException("no complete 200 response");
        byte[] raw=Arrays.copyOfRange(response,split+4,response.length);
        if(!text.substring(0,split).toLowerCase(Locale.ROOT).contains("transfer-encoding: chunked"))return raw;
        ByteArrayInputStream input=new ByteArrayInputStream(raw);ByteArrayOutputStream out=new ByteArrayOutputStream();
        for(;;){StringBuilder line=new StringBuilder();int x;while((x=input.read())>=0&&x!=13)line.append((char)x);if(input.read()!=10)throw new IOException("chunk header");int n=Integer.parseInt(line.toString().split(";")[0],16);if(n==0)return out.toByteArray();byte[] chunk=input.readNBytes(n);if(chunk.length!=n)throw new IOException("truncated chunk");out.write(chunk);if(input.read()!=13||input.read()!=10)throw new IOException("chunk tail");}
    }
    static JSONObject command(String id,boolean snapshot,boolean expectLoss) throws Exception {
        double start=now();long begin=System.nanoTime();event("submit",id,null);
        byte[] payload=snapshot?new byte[0]:("{\"id\":\""+id+"\",\"text\":\"synthetic command, no model execution\"}").getBytes(StandardCharsets.UTF_8);
        String path=snapshot?"/__harness_mobile__/sync/manifest?refresh=0":"/fixture/ack?id="+id;
        String header=(snapshot?"GET ":"POST ")+path+" HTTP/1.1\r\nHost: harness.localhost\r\nX-Fixture-Id: "+id+"\r\nCookie: "+config.getString("cookie")+"\r\nContent-Type: application/json\r\nContent-Length: "+payload.length+"\r\nConnection: close\r\n\r\n";
        JSONObject row=new JSONObject().put("id",id).put("submit",start).put("snapshot",snapshot).put("expectLoss",expectLoss);
        try {
            byte[] value=body(raw(config.getInt("proxyPort"),header,payload,18000));JSONObject ack=new JSONObject(new String(value,StandardCharsets.UTF_8));
            if(snapshot){require(value.length==config.getInt("snapshotBytes"),"snapshot byte count");require(sha(value).equals(config.getString("snapshotHash")),"snapshot order/integrity mismatch");}
            else {require(id.equals(ack.getString("id")),"ACK cross-stream isolation failure");require(sha(payload).equals(ack.getString("echoHash")),"request byte ordering/integrity");}
            row.put("ok",true).put("bodyBytes",value.length).put("bodyHash",sha(value));require(!expectLoss,"deliberately disconnected request unexpectedly succeeded");
        } catch(IOException error){if(!expectLoss)throw error;row.put("ok",false).put("error",error.toString());}
        row.put("receipt",now()).put("durationMs",(System.nanoTime()-begin)/1e6);results.add(row);event("mobileReceipt",id,new JSONObject().put("ok",row.getBoolean("ok")));return row;
    }
    static JSONObject pagedSnapshot(String id) throws Exception {
        double start=now();long begin=System.nanoTime();event("submit",id,null);
        URL endpoint=new URL("http://127.0.0.1:"+config.getInt("proxyPort")+"/__harness_mobile__/sync/manifest?refresh=0");
        AtomicInteger pages=new AtomicInteger();
        ManifestDownload download=new ManifestDownload(endpoint,"harness.localhost",config.getString("cookie"),ManifestDownload.MAX_BYTES,url->{
            pages.incrementAndGet();HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setRequestProperty("X-Fixture-Id",id);return c;
        });
        byte[] value=download.download();double downloadMs=(System.nanoTime()-begin)/1e6;
        require(value.length==config.getInt("snapshotBytes")&&sha(value).equals(config.getString("snapshotHash")),"paged full body changed");
        java.io.File base=new java.io.File(config.getString("home"),"paged-cache");MobileAssetCache cache=new MobileAssetCache(new java.io.File(base,"assets"),new java.io.File(base,"offline"),System::currentTimeMillis);
        long staging=System.nanoTime();MobileAssetCache.OfflineSnapshot snapshot;double stageMs,commitMs;
        try(MobileAssetCache.PreparedSync prepared=cache.prepareSyncResponse("a".repeat(64),new JSONObject(new String(value,StandardCharsets.UTF_8)))) {
            stageMs=(System.nanoTime()-staging)/1e6;require(prepared!=null,"full snapshot preparation failed");long commit=System.nanoTime();snapshot=cache.commitPreparedSync("a".repeat(64),prepared);commitMs=(System.nanoTime()-commit)/1e6;
        }
        require(snapshot!=null&&snapshot.sessions.length()==1400,"cache lost complete session data");
        JSONObject row=new JSONObject().put("id",id).put("snapshot",true).put("paged",true).put("expectLoss",false).put("ok",true).put("submit",start).put("receipt",now())
            .put("durationMs",(System.nanoTime()-begin)/1e6).put("downloadMs",downloadMs).put("stageMs",stageMs).put("commitMs",commitMs).put("pages",pages.get()).put("cachedSessions",snapshot.sessions.length()).put("bodyBytes",value.length).put("bodyHash",sha(value));
        results.add(row);event("mobileReceipt",id,new JSONObject().put("ok",true));return row;
    }
    static JSONObject interruptedSnapshot() throws Exception {
        String id="snapshot-3";double started=now();long begin=System.nanoTime();event("submit",id,null);
        File base=new File(config.getString("home"),"paged-cache"), bucket=new File(base,"offline/"+"a".repeat(64));File[] prior=bucket.listFiles((d,n)->n.endsWith(".snapshot"));require(prior!=null&&prior.length==1,"expected prior complete cache");byte[] before=Files.readAllBytes(prior[0].toPath());
        ManifestDownload download=new ManifestDownload(new URL("http://127.0.0.1:"+config.getInt("proxyPort")+"/__harness_mobile__/sync/manifest?refresh=0"),"harness.localhost",config.getString("cookie"),ManifestDownload.MAX_BYTES,url->{HttpURLConnection c=(HttpURLConnection)url.openConnection();c.setRequestProperty("X-Fixture-Id",id);return c;});
        String failure;try{download.download();throw new AssertionError("disconnected paging unexpectedly returned a complete snapshot");}catch(IOException expected){failure=expected.toString();}
        require(Arrays.equals(before,Files.readAllBytes(prior[0].toPath())),"interrupted download changed last complete cache");
        MobileAssetCache cache=new MobileAssetCache(new File(base,"assets"),new File(base,"offline"),System::currentTimeMillis);require(cache.loadLatestSnapshot("a".repeat(64)).sessions.length()==1400,"prior snapshot no longer usable");
        JSONObject row=new JSONObject().put("id",id).put("snapshot",true).put("paged",true).put("expectLoss",true).put("ok",false).put("submit",started).put("receipt",now()).put("durationMs",(System.nanoTime()-begin)/1e6).put("oldCacheUnchanged",true).put("error",failure);
        results.add(row);event("mobileReceipt",id,new JSONObject().put("ok",false));return row;
    }
    static void batch(String prefix,int count) throws Exception {
        for(int start=0;start<count;start+=6){CyclicBarrier barrier=new CyclicBarrier(6);List<Future<JSONObject>> jobs=new ArrayList<>();for(int n=0;n<6;n++){String id=prefix+"-"+(start+n);jobs.add(clients.submit(()->{barrier.await(3,TimeUnit.SECONDS);return command(id,false,false);}));}for(Future<JSONObject> job:jobs)job.get(22,TimeUnit.SECONDS);}
    }
    public static void main(String[] args) throws Exception {
        require(args.length==1,"fixture config argument required");Path cfg=Path.of(args[0]);config=new JSONObject(Files.readString(cfg));Path output=cfg.resolveSibling("java-result.json");
        require(System.getProperty("user.home").equals(config.getString("home")),"JVM HOME is not isolated");
        require(System.getProperty("java.io.tmpdir").equals(config.getString("home")),"JVM temp is not isolated");
        installNetworkFence();Throwable failed=null;
        try {
            clockUncertainty=Double.POSITIVE_INFINITY;
            for(int i=0;i<7;i++){double a=now();JSONObject c=control("/clock");double b=now();if((b-a)/2<clockUncertainty){clockUncertainty=(b-a)/2;clockOffset=c.getDouble("at")-(a+b)/2;}}
            http=new OkHttpClient.Builder().proxy(Proxy.NO_PROXY).connectTimeout(3,TimeUnit.SECONDS).readTimeout(10,TimeUnit.SECONDS).retryOnConnectionFailure(false).build();
            relay=new WssRelayClient((request,listener)->{
                require(request.url().toString().equals("https://fixture.invalid/chain"),"only synthetic WSS URL may be mapped");
                int n=epoch;CompletableFuture<TraceSocket> holder=new CompletableFuture<>();
                WebSocket real=http.newWebSocket(request.newBuilder().url("ws://127.0.0.1:"+config.getInt("relayPort")+"/chain").build(),new WebSocketListener(){
                    TraceSocket get(){return holder.join();}
                    public void onOpen(WebSocket s,Response r){listener.onOpen(get(),r);}
                    public void onMessage(WebSocket s,String v){listener.onMessage(get(),v);}
                    public void onMessage(WebSocket s,ByteString v){TraceSocket t=get();t.lastBinary=v;t.trace("mobileDecode",v,true);listener.onMessage(t,v);}
                    public void onFailure(WebSocket s,Throwable e,Response r){listener.onFailure(get(),e,r);}
                    public void onClosing(WebSocket s,int c,String r){listener.onClosing(get(),c,r);}
                    public void onClosed(WebSocket s,int c,String r){listener.onClosed(get(),c,r);}
                });
                TraceSocket traced=new TraceSocket(real,listener,n);sockets.add(traced);holder.complete(traced);return traced;
            },()->{ServerSocket server=new ServerSocket();server.setReuseAddress(true);server.bind(new InetSocketAddress("127.0.0.1",config.getInt("socksPort")),16);return server;});
            proxy=new HarnessWebProxy(null,route->{require(route.proxyPort==config.getInt("socksPort")&&route.port==config.getInt("gatewayPort")&&route.host.equals("127.0.0.1")&&route.proxyHost.equals("127.0.0.1"),"route escaped fixture");return HarnessWebProxy.connectThroughSocks5(route);});
            require(proxy.start(config.getInt("proxyPort"))==config.getInt("proxyPort"),"proxy cannot fall back to an arbitrary port");startRelay();
            control("/mode?name=normal");batch("normal",18);
            control("/mode?name=jitter");batch("jitter",18);
            control("/mode?name=snapshot");Future<JSONObject> snapshot=clients.submit(()->command("snapshot-0",true,false));control("/barrier?name=snapshot");batch("hol",6);snapshot.get(22,TimeUnit.SECONDS);
            control("/mode?name=normal");TraceSocket old=sockets.get(sockets.size()-1);Future<JSONObject> lost=clients.submit(()->command("late-0",false,true));control("/barrier?name=late");control("/drop");lost.get(8,TimeUnit.SECONDS);relay.stop();startRelay();
            if(old.lastBinary!=null)old.production.onMessage(old,old.lastBinary);old.production.onFailure(old,new IOException("injected queued old callback"),null);event("injectedStaleCallback",null,new JSONObject().put("epoch",old.generation));
            batch("reconnect",6);control("/barrier?name=lateAck");
            // Retain the original 49-command legacy scenario above, then compare identical compounded impairment.
            control("/mode?name=bulkJitter");Future<JSONObject> bulk=clients.submit(()->command("snapshot-1",true,false));control("/barrier?name=bulkJitter");batch("bulk",6);bulk.get(30,TimeUnit.SECONDS);
            control("/mode?name=paged");Future<JSONObject> paged=clients.submit(()->pagedSnapshot("snapshot-2"));control("/barrier?name=paged");batch("paged",6);paged.get(40,TimeUnit.SECONDS);
            control("/mode?name=pagedAbort");Future<JSONObject> interrupted=clients.submit(DeepAuditMobileChainTest::interruptedSnapshot);control("/barrier?name=pagedAbort");control("/drop");interrupted.get(20,TimeUnit.SECONDS);
            require(events.stream().noneMatch(e->e.getString("stage").equals("traceError")),"instrumentation codec trace failed");
        } catch(Throwable error){failed=error;error.printStackTrace();}
        finally {
            if(proxy!=null)proxy.close();if(relay!=null)relay.stop();for(TraceSocket s:sockets)s.cancel();clients.shutdownNow();
            if(http!=null){http.connectionPool().evictAll();http.dispatcher().executorService().shutdownNow();}
            Files.writeString(output,new JSONObject().put("ok",failed==null).put("error",failed==null?JSONObject.NULL:failed.toString()).put("clockOffset",clockOffset).put("clockUncertaintyMs",clockUncertainty).put("events",new JSONArray(events)).put("requests",new JSONArray(results)).toString(2));
        }
        System.exit(failed==null?0:1); // Production accept/copy pools are closed; bound fixture exits even after failure.
    }
}
