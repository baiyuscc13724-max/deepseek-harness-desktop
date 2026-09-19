package io.harnessdesktop.mobile;

import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;
import okhttp3.*;
import okio.ByteString;
import static io.harnessdesktop.mobile.DeepAuditMobileChainTest.*;

/** Actual current Wss client + proxy negative owner-boundary evidence.
 * Uses frozen chain HTTP/trace/fence helpers verbatim by package access.
 * No replacement reconnection state machine; no claimed automatic recovery.
 */
public final class DeepAuditMobileRecoveryTest {
    static final List<String> checks=new ArrayList<>();
    static void check(boolean value,String name){require(value,name);checks.add(name);}
    static void policyCases(){
        NetworkReconnectPolicy p=new NetworkReconnectPolicy();p.seed(1,true);
        check(!p.available(1,true),"duplicate active availability schedules nothing");
        check(p.available(2,true)&&p.pendingDelayMillis()==3000,"switch is held 3000ms");
        check(!p.lost(1),"old-network loss cannot replace newer usable candidate");
        check(p.hasUsableNetwork()&&p.generation()==0,"working logical network retained before commit");
        NetworkReconnectPolicy.Transition t=p.commitPending();
        check(t.switched()&&t.activeHandle==2&&t.generation==1,"stable switch commits one generation");
        check(p.commitPending()==null,"duplicate commit is a no-op");
        check(p.lost(2)&&p.pendingDelayMillis()==1500,"loss is held 1500ms");
        check(p.commitPending().disconnected()&&!p.hasUsableNetwork(),"committed loss goes offline");
        check(p.available(3,true)&&p.pendingDelayMillis()==250,"recovery is held 250ms");
        check(p.commitPending().recovered()&&p.generation()==3,"recovery commits new usable generation");
        check(!p.lost(2),"late old loss after recovery ignored");
        for(int i=0;i<100;i++){long old=3+i,next=old+1;require(p.available(next,true),"switch candidate");require(!p.lost(old),"old loss");require(p.commitPending().switched(),"switch commit");}
        check(p.generation()==103,"100 rapid synthetic stable switch cycles remain monotonic");
    }
    static long failures(){return events.stream().filter(e->"relayFailure".equals(e.optString("stage"))).count();}
    static void waitFailure() throws Exception {long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);while(failures()==0&&System.nanoTime()<until)Thread.sleep(10);require(failures()==1,"exactly one failure must be observed");}
    public static void main(String[] args)throws Exception{
        require(args.length==1,"config required");Path cfg=Path.of(args[0]);config=new JSONObject(Files.readString(cfg));
        require(System.getProperty("user.home").equals(config.getString("home")),"isolated user.home");
        require(System.getProperty("java.io.tmpdir").equals(config.getString("home")),"isolated tmpdir");
        installNetworkFence();Throwable failed=null;double observationMs=0;
        try{
            policyCases();
            http=new OkHttpClient.Builder().proxy(Proxy.NO_PROXY).connectTimeout(3,TimeUnit.SECONDS).readTimeout(10,TimeUnit.SECONDS).retryOnConnectionFailure(false).build();
            relay=new WssRelayClient((request,listener)->{
                require(request.url().toString().equals("https://fixture.invalid/chain"),"only synthetic WSS mapping");
                int n=epoch;CompletableFuture<TraceSocket> holder=new CompletableFuture<>();
                WebSocket real=http.newWebSocket(request.newBuilder().url("ws://127.0.0.1:"+config.getInt("relayPort")+"/chain").build(),new WebSocketListener(){
                    TraceSocket get(){return holder.join();}
                    public void onOpen(WebSocket s,Response r){event("wireOpen",null,null);listener.onOpen(get(),r);}
                    public void onMessage(WebSocket s,String v){event("wireControl",null,new JSONObject().put("type",new JSONObject(v).optString("type")));listener.onMessage(get(),v);}
                    public void onMessage(WebSocket s,ByteString v){TraceSocket t=get();t.lastBinary=v;t.trace("mobileDecode",v,true);listener.onMessage(t,v);}
                    public void onFailure(WebSocket s,Throwable e,Response r){listener.onFailure(get(),e,r);}
                    public void onClosing(WebSocket s,int c,String r){listener.onClosing(get(),c,r);}
                    public void onClosed(WebSocket s,int c,String r){listener.onClosed(get(),c,r);}
                });TraceSocket traced=new TraceSocket(real,listener,n);sockets.add(traced);holder.complete(traced);event("factoryStart",null,new JSONObject().put("number",sockets.size()));return traced;
            },()->{ServerSocket s=new ServerSocket();s.setReuseAddress(true);s.bind(new InetSocketAddress("127.0.0.1",config.getInt("socksPort")),16);return s;});
            proxy=new HarnessWebProxy(null,route->{require(route.proxyPort==config.getInt("socksPort")&&route.port==config.getInt("gatewayPort")&&route.host.equals("127.0.0.1")&&route.proxyHost.equals("127.0.0.1"),"route escaped fixture");return HarnessWebProxy.connectThroughSocks5(route);});
            require(proxy.start(config.getInt("proxyPort"))==config.getInt("proxyPort"),"no port fallback");
            event("explicitInitialStart",null,null);startRelay();command("normal-0",false,false);
            Future<JSONObject> lost=clients.submit(()->command("late-0",false,true));control("/barrier?name=late");event("dropRequested",null,null);control("/drop");
            require(!lost.get(5,TimeUnit.SECONDS).getBoolean("ok"),"in-flight ACK lost");waitFailure();control("/barrier?name=lateAck");
            long start=System.nanoTime();Thread.sleep(3350);observationMs=(System.nanoTime()-start)/1e6;
            check(sockets.size()==1&&failures()==1,"Wss client alone does not auto-recreate over first 3000ms owner-delay window");
            TraceSocket old=sockets.get(0);int prior=events.size();
            for(int i=0;i<40;i++){old.production.onFailure(old,new IOException("synthetic stale failure"),null);old.production.onClosed(old,1006,"synthetic stale close");old.production.onMessage(old,"{\"type\":\"welcome\",\"role\":\"mobile\",\"desktopOnline\":true}");if(old.lastBinary!=null)old.production.onMessage(old,old.lastBinary);}
            check(events.size()==prior&&sockets.size()==1&&failures()==1,"160 old callbacks after fail cannot emit ready or schedule socket creation");
            relay.stop();old.production.onFailure(old,new IOException("late after stop"),null);
            check(sockets.size()==1&&failures()==1,"explicit stop suppresses late failure without creating transport");
            for(String field:List.of("streams","openingSockets")){java.lang.reflect.Field f=WssRelayClient.class.getDeclaredField(field);f.setAccessible(true);Object v=f.get(relay);check((v instanceof Map?((Map<?,?>)v).size():((Set<?>)v).size())==0,"stop clears "+field);}
        }catch(Throwable e){failed=e;throw e;}finally{
            if(proxy!=null)proxy.close();if(relay!=null)relay.stop();clients.shutdownNow();clients.awaitTermination(3,TimeUnit.SECONDS);
            if(http!=null){http.dispatcher().executorService().shutdownNow();http.connectionPool().evictAll();http.dispatcher().executorService().awaitTermination(3,TimeUnit.SECONDS);}
            Files.writeString(cfg.resolveSibling("java-result.json"),new JSONObject().put("ok",failed==null).put("error",failed==null?JSONObject.NULL:failed.toString()).put("checks",checks).put("requests",results).put("events",events).put("postFailureObservationMs",observationMs).put("automaticRecoveryExecuted",false).put("manualInitialStarts",1).put("claim","actual transport failure/old-callback/stop and network policy; Android owner NOT executed").toString(2));
        }
    }
}
