package io.harnessdesktop.mobile;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.*;
import org.json.*;

/** Selected JVM contract checks; fake HTTP boundaries here, real transport in the chain fixture. */
public final class DeepAuditMobileManifestPagingTest {
    static final List<String> passed=new ArrayList<>();
    static final String TOKEN="t".repeat(43), IDENTITY="i".repeat(43), CURSOR="c".repeat(43);
    static URL endpoint() throws Exception{return new URL("http://127.0.0.1:32123/__harness_mobile__/sync/manifest?refresh=0");}
    static byte[] content(){return new JSONObject().put("schemaVersion",1).put("ok",true).put("complete",true).put("protected",false).put("cacheIdentity",IDENTITY).put("snapshotEpoch",7).put("cursor",CURSOR).put("snapshot",new JSONObject().put("title","完整内容".repeat(4000))).toString().getBytes(StandardCharsets.UTF_8);}
    static String hash(byte[] a)throws Exception{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(a));}
    static void check(boolean value,String message){if(!value)throw new AssertionError(message);}
    static final class Connection extends HttpURLConnection {
        final Map<String,String> headers=new HashMap<>();byte[] body;int status=206;boolean closed;
        Connection(URL url,byte[] full,int offset)throws Exception{super(url);int end=Math.min(offset+ManifestDownload.PAGE_BYTES,full.length);body=Arrays.copyOfRange(full,offset,end);headers.put("X-Harness-Manifest-Paging","1");headers.put("X-Harness-Mobile-Sync-Complete","0");headers.put("X-Harness-Manifest-Token",TOKEN);headers.put("X-Harness-Manifest-SHA256",hash(full));headers.put("X-Harness-Manifest-Identity",IDENTITY);headers.put("X-Harness-Manifest-Epoch","7");headers.put("X-Harness-Manifest-Cursor",CURSOR);headers.put("Content-Range","bytes "+offset+"-"+(end-1)+"/"+full.length);}
        public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){closed=true;}
        public int getResponseCode(){return status;}public String getHeaderField(String name){return headers.get(name);}public InputStream getInputStream(){return new ByteArrayInputStream(body);}
    }
    interface Mutate {void apply(Connection c,int index)throws Exception;}
    static void scenario(String name,boolean success,Mutate mutate)throws Exception{
        byte[] full=content();List<Connection> connections=new ArrayList<>();AtomicInteger position=new AtomicInteger();
        ManifestDownload task=new ManifestDownload(endpoint(),"harness.localhost:32123","fixture-cookie",ManifestDownload.MAX_BYTES,url->{try{int at=position.getAndIncrement()*ManifestDownload.PAGE_BYTES;Connection c=new Connection(url,full,at);mutate.apply(c,connections.size());connections.add(c);if(at>0)check(url.getQuery().equals("paging=1&token="+TOKEN+"&offset="+at),"continuation query must not repeat refresh or resume tuple");return c;}catch(IOException e){throw e;}catch(Exception e){throw new IOException(e);}});
        byte[] result=null;IOException error=null;try{result=task.download();}catch(IOException e){error=e;}
        check(success==(error==null),name+" success mismatch: "+error);if(success)check(Arrays.equals(full,result),name+" changed bytes");
        for(Connection c:connections){check(c.closed,name+" did not disconnect");check("fixture-cookie".equals(c.getRequestProperty("Cookie")),"page dropped auth cookie");check(!c.getInstanceFollowRedirects(),"redirect must not forward credentials");}
        passed.add(name);
    }
    static JSONObject response(int revision) {
        return new JSONObject().put("schemaVersion",1).put("ok",true).put("complete",true).put("snapshotEpoch",7).put("revision",revision).put("cursor","cursor-"+revision)
            .put("snapshot",new JSONObject().put("workspaces",new JSONArray().put(new JSONObject().put("workspaceId","w").put("title","workspace")))
                .put("sessions",new JSONArray().put(new JSONObject().put("sessionId","s").put("workspaceId","w").put("title","revision-"+revision))));
    }
    static JSONObject delta(int revision) {return new JSONObject().put("revision",revision).put("cursor","cursor-"+revision).put("sessions",new JSONArray().put(new JSONObject().put("sessionId","s").put("workspaceId","w").put("title","revision-"+revision)));}
    static void cacheChecks(Path base)throws Exception {
        String id="a".repeat(64),other="b".repeat(64);Path dir=base.resolve("cache-contract");AtomicLong now=new AtomicLong(100_000);AtomicBoolean failMove=new AtomicBoolean();AtomicInteger moves=new AtomicInteger();
        MobileAssetCache cache=new MobileAssetCache(dir.resolve("assets").toFile(),dir.resolve("offline").toFile(),now::get,(a,b)->{check(Thread.holdsLock(cacheRef.get()),"commit must own cache lock");if(failMove.get())throw new IOException("injected atomic move failure");Files.move(a.toPath(),b.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING);moves.incrementAndGet();});cacheRef.set(cache);
        check(cache.applySyncResponse(id,response(1)),"legacy seed");Path current=dir.resolve("offline").resolve(id).resolve("7.snapshot");byte[] original=Files.readAllBytes(current);
        try(MobileAssetCache.PreparedSync p=cache.prepareSyncResponse(id,response(2))) {check(p!=null,"valid stage");check(Arrays.equals(original,Files.readAllBytes(current)),"staging changed old cache");check(cache.prepareSyncResponse(id,response(3))==null,"one outstanding stage");check(cache.commitPreparedSync(other,p)==null,"cross-profile stage");check(cache.commitPreparedSync(id,p).revision==2,"commit prepared");check(cache.commitPreparedSync(id,p)==null,"one-shot commit");}
        check(moves.get()==1&&cache.loadLatestSnapshot(id).revision==2,"disk commit visible");passed.add("prepared stage preserves old cache; one-shot identity-bound atomic commit");
        try(MobileAssetCache.PreparedSync p=cache.prepareSyncResponse(id,response(3))) {cache.clearOfflineSnapshots(id);check(cache.commitPreparedSync(id,p)==null,"clear resurrected staged cache");check(cache.loadLatestSnapshot(id)==null,"clear left snapshot");}passed.add("clear invalidates staged generation without revival");
        check(cache.applySyncResponse(id,response(2)),"reseed");
        try(MobileAssetCache.PreparedSync p=cache.prepareSyncResponse(id,response(3))) {check(cache.applySyncResponse(id,response(4)),"concurrent legacy write");check(cache.commitPreparedSync(id,p)==null,"stale prepared overwrote newer cache");}passed.add("legacy store invalidates prepared mutation revision");
        byte[] four=Files.readAllBytes(current);JSONObject malformed=response(6);malformed.remove("snapshot");malformed.put("changes",new JSONArray().put(delta(5)).put(new JSONObject().put("revision",6)));
        check(cache.prepareSyncResponse(id,malformed)==null,"malformed last delta accepted");check(Arrays.equals(four,Files.readAllBytes(current)),"partial delta persisted");passed.add("invalid later delta leaves complete old snapshot byte-identical");
        JSONObject good=response(6);good.remove("snapshot");good.put("changes",new JSONArray().put(delta(5)).put(delta(6)));int before=moves.get();try(MobileAssetCache.PreparedSync p=cache.prepareSyncResponse(id,good)){check(p!=null&&cache.commitPreparedSync(id,p).revision==6,"valid combined delta");}check(moves.get()==before+1,"multi-delta did not use one rename");passed.add("multiple valid deltas committed in one atomic rename");
        byte[] six=Files.readAllBytes(current);failMove.set(true);try(MobileAssetCache.PreparedSync p=cache.prepareSyncResponse(id,response(7))){try{cache.commitPreparedSync(id,p);throw new AssertionError("failed rename accepted");}catch(IOException expected){}}failMove.set(false);check(Arrays.equals(six,Files.readAllBytes(current)),"rename error changed old snapshot");passed.add("atomic move failure retains old cache and cleans pending file");
        try(MobileAssetCache.PreparedSync p=cache.prepareSyncResponse(id,response(7))){now.addAndGet(MobileAssetCache.OFFLINE_TTL_MS+1);check(cache.commitPreparedSync(id,p)==null,"expired prepared committed");}now.set(100_000);passed.add("expired prepared result cannot commit");
        try(MobileAssetCache.PreparedSync p=cache.prepareSyncResponse(id,response(7))){MobileAssetCache foreign=new MobileAssetCache(dir.resolve("other-assets").toFile(),dir.resolve("other-offline").toFile(),now::get);check(foreign.commitPreparedSync(id,p)==null,"foreign cache accepted stage");}passed.add("cache-instance-bound preparation");
        try(java.util.stream.Stream<Path> paths=Files.walk(dir)){check(paths.noneMatch(p->p.toString().endsWith(".pending")),"pending file leak");}
        Files.delete(dir.resolve("offline/.staging"));Files.writeString(dir.resolve("offline/.staging"),"not a directory");try{cache.prepareSyncResponse(id,response(7));throw new AssertionError("stage IO error accepted");}catch(IOException expected){}check(Arrays.equals(six,Files.readAllBytes(current)),"stage failure changed old snapshot");Files.delete(dir.resolve("offline/.staging"));passed.add("stage IO failure leaves old cache and releases preparation permit");
        try(MobileAssetCache.PreparedSync p=cache.prepareSyncResponse(id,response(7))){check(p!=null,"permit leaked after stage error");}passed.add("cancelled/uncommitted stage cleanup");
        java.util.concurrent.CountDownLatch entered=new java.util.concurrent.CountDownLatch(1),release=new java.util.concurrent.CountDownLatch(1);AtomicBoolean block=new AtomicBoolean();
        MobileAssetCache racing=new MobileAssetCache(dir.resolve("race-assets").toFile(),dir.resolve("race-offline").toFile(),()->{if(block.compareAndSet(true,false)){entered.countDown();try{check(release.await(3,java.util.concurrent.TimeUnit.SECONDS),"race release timeout");}catch(InterruptedException e){Thread.currentThread().interrupt();throw new IllegalStateException(e);}}return 100_000;});
        check(racing.applySyncResponse(id,response(1)),"race seed");java.util.concurrent.ExecutorService workers=java.util.concurrent.Executors.newFixedThreadPool(2);block.set(true);
        try {java.util.concurrent.Future<MobileAssetCache.PreparedSync> staging=workers.submit(()->racing.prepareSyncResponse(id,response(2)));check(entered.await(3,java.util.concurrent.TimeUnit.SECONDS),"background read barrier");
            java.util.concurrent.Future<?> clear=workers.submit(()->racing.clearOfflineSnapshots(id));try{clear.get(1,java.util.concurrent.TimeUnit.SECONDS);}finally{release.countDown();}
            try(MobileAssetCache.PreparedSync p=staging.get(3,java.util.concurrent.TimeUnit.SECONDS)){check(p==null,"staging survived simultaneous clear");}check(racing.loadLatestSnapshot(id)==null,"concurrent clear resurrected cache");
        }finally{release.countDown();workers.shutdownNow();check(workers.awaitTermination(3,java.util.concurrent.TimeUnit.SECONDS),"race workers leaked");}
        passed.add("real-thread preparation barrier does not block clear and cannot revive deleted cache");
    }
    static final AtomicReference<MobileAssetCache> cacheRef=new AtomicReference<>();
    public static void main(String[] args)throws Exception{
        Path output=Path.of(args[0]).resolve("manifest-jvm-result.json");
        scenario("multi-page complete UTF8 bytes and authentication",true,(c,n)->{});
        scenario("old desktop 200 complete full compatibility",true,(c,n)->{c.status=200;c.body=content();c.headers.put("X-Harness-Mobile-Sync-Complete","1");});
        scenario("old desktop full response over 2MiB rejected",false,(c,n)->{c.status=200;c.body=new byte[ManifestDownload.MAX_BYTES+1];c.headers.put("X-Harness-Mobile-Sync-Complete","1");});
        scenario("malformed UTF8 fallback rejected",false,(c,n)->{c.status=200;c.body=new byte[]{(byte)0xc3,0x28};c.headers.put("X-Harness-Mobile-Sync-Complete","1");});
        scenario("partial page EOF",false,(c,n)->{if(n==1)c.body=Arrays.copyOf(c.body,c.body.length-1);});
        for(String key:List.of("X-Harness-Manifest-Token","X-Harness-Manifest-SHA256","X-Harness-Manifest-Identity","X-Harness-Manifest-Epoch","X-Harness-Manifest-Cursor"))scenario("cross-transfer "+key,false,(c,n)->{if(n==1)c.headers.put(key,key.endsWith("Epoch")?"8":key.endsWith("SHA256")?"a".repeat(64):"a".repeat(43));});
        scenario("wrong offset",false,(c,n)->{if(n==1)c.headers.put("Content-Range","bytes 0-16383/"+content().length);});
        scenario("over-limit total",false,(c,n)->c.headers.put("Content-Range","bytes 0-16383/2147483647"));
        scenario("oversized page",false,(c,n)->c.body=new byte[ManifestDownload.PAGE_BYTES+1]);
        scenario("corrupt final bytes",false,(c,n)->{if(n==1)c.body[20]^=1;});
        scenario("forged body metadata despite correct hash",false,(c,n)->c.headers.put("X-Harness-Manifest-Epoch","8"));
        scenario("mid-transfer full fallback forbidden",false,(c,n)->{if(n==1){c.status=200;c.body=content();c.headers.put("X-Harness-Mobile-Sync-Complete","1");}});
        scenario("old desktop incomplete cannot replace cache",false,(c,n)->{c.status=200;c.body=content();});
        scenario("mid-page authorization revoke",false,(c,n)->{if(n==1){c.status=401;c.headers.put("X-Harness-Mobile-Cache-Action","clear");}});
        scenario("redirect refused",false,(c,n)->c.status=302);
        AtomicReference<ManifestDownload> ref=new AtomicReference<>();List<Connection> closed=new ArrayList<>();AtomicInteger calls=new AtomicInteger();
        ManifestDownload cancel=new ManifestDownload(endpoint(),"harness.localhost:32123","fixture-cookie",ManifestDownload.MAX_BYTES,url->{try{int n=calls.getAndIncrement();Connection c=new Connection(url,content(),n*ManifestDownload.PAGE_BYTES);closed.add(c);if(n==1)ref.get().cancel();return c;}catch(Exception e){throw new IOException(e);}});ref.set(cancel);
        try{cancel.download();throw new AssertionError("cancelled generation returned bytes");}catch(InterruptedIOException expected){}
        check(calls.get()==2&&closed.stream().allMatch(c->c.closed),"cancel must stop before publishing and close active page");passed.add("profile cancellation and connection cleanup");
        cacheChecks(Path.of(args[0]));
        Files.writeString(output,new JSONObject().put("ok",true).put("checks",passed).put("count",passed.size()).toString(2));System.out.println("Manifest JVM checks: "+passed.size()+" passed");
    }
}
