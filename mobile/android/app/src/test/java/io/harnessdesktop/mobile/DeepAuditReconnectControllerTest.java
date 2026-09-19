package io.harnessdesktop.mobile;

import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.json.*;
import okhttp3.*;
import okio.ByteString;
import static io.harnessdesktop.mobile.DeepAuditMobileChainTest.*;

/** Same production controller in virtual scheduling checks and real WSS chain.
 * No test retry state machine; only scheduling/transport observation ports differ.
 */
public final class DeepAuditReconnectControllerTest {
    static final List<String> checks=new ArrayList<>();
    static void check(boolean v,String n){require(v,n);checks.add(n);}
    static class Virtual implements RemoteReconnectController.Scheduler {
        static class Entry {final Runnable action;final long due;final long seq;Entry(Runnable a,long d,long s){action=a;due=d;seq=s;}}
        final List<Entry> q=new ArrayList<>();long clock,seq;final List<Long> delays=new ArrayList<>();
        public void postDelayed(Runnable r,long d){q.add(new Entry(r,clock+d,seq++));if(d>0)delays.add(d);}
        public void removeCallbacks(Runnable r){q.removeIf(e->e.action==r);}
        void drain(){while(true){Entry e=q.stream().filter(x->x.due<=clock).min(Comparator.comparingLong((Entry x)->x.due).thenComparingLong(x->x.seq)).orElse(null);if(e==null)return;q.remove(e);e.action.run();}}
        void advance(long n){clock+=n;drain();}
        Runnable delayed(){return q.stream().filter(e->e.due>clock).findFirst().orElseThrow().action;}
    }
    static void logic(){
        for(RemoteReconnectController.Channel channel:RemoteReconnectController.Channel.values()){
            Virtual s=new Virtual();RemoteReconnectController c=new RemoteReconnectController(s);List<RemoteReconnectController.Token> tokens=new ArrayList<>();Object p=new Object();
            c.start(p,channel,t->{require(!Thread.holdsLock(c),"connect outside lock");tokens.add(t);});s.drain();
            check(tokens.size()==1,channel+" explicit start once, connect outside monitor");
            long[] expected=channel==RemoteReconnectController.Channel.REMOTE?new long[]{3000,5000,7000,9000,11000,13000,15000,15000}:new long[]{5000,10000,15000,20000,25000,30000,30000,30000};
            for(long delay:expected){RemoteReconnectController.Token t=tokens.get(tokens.size()-1);AtomicInteger failAction=new AtomicInteger();for(int i=0;i<25;i++)c.failed(t,()->{require(!Thread.holdsLock(c),"failure outside lock");failAction.incrementAndGet();});s.drain();require(failAction.get()==1,"duplicate failure singleflight");require(s.delays.get(s.delays.size()-1)==delay,"unchanged linear delay");int n=tokens.size();s.advance(delay-1);require(tokens.size()==n,"not early");s.advance(1);require(tokens.size()==n+1,"one automatic retry");}
            check(s.delays.equals(Arrays.stream(expected).boxed().toList()),channel+" eight unchanged linear failures and cap; 25-fold duplicates singleflight");
            RemoteReconnectController.Token good=tokens.get(tokens.size()-1);AtomicInteger updates=new AtomicInteger();c.ready(good,()->{require(!Thread.holdsLock(c),"ready outside lock");updates.incrementAndGet();});s.drain();c.failed(good,updates::incrementAndGet);s.drain();check(s.delays.get(s.delays.size()-1)==expected[0],channel+" ready resets next failure delay");
            Runnable retired=s.delayed();c.stop();retired.run();s.advance(100000);check(tokens.size()==9,channel+" Stop invalidates even dequeued old timer");
            c.ready(good,updates::incrementAndGet);c.failed(good,updates::incrementAndGet);c.post(good,updates::incrementAndGet);s.drain();check(updates.get()==2,channel+" old ready failure UI notifications after Stop rejected");
        }
        Virtual s=new Virtual();RemoteReconnectController c=new RemoteReconnectController(s);Object p=new Object(),other=new Object();List<RemoteReconnectController.Token> remote=new ArrayList<>(),nativeTokens=new ArrayList<>();AtomicInteger state=new AtomicInteger();
        c.start(p,RemoteReconnectController.Channel.REMOTE,remote::add);s.drain();RemoteReconnectController.Token old=remote.get(0);c.ready(old,state::incrementAndGet);c.failed(old,state::incrementAndGet);c.post(old,state::incrementAndGet);
        c.start(p,RemoteReconnectController.Channel.REMOTE,remote::add);s.drain();check(state.get()==0&&remote.size()==2,"same-profile new attempt rejects already queued old ready/failure/UI");
        c.start(p,RemoteReconnectController.Channel.NATIVE,nativeTokens::add);s.drain();c.ready(remote.get(1),state::incrementAndGet);c.ready(nativeTokens.get(0),state::incrementAndGet);s.drain();check(state.get()==2,"different channels of same profile remain independently current");
        c.failed(remote.get(1),state::incrementAndGet);s.drain();Runnable stale=s.delayed();c.ready(nativeTokens.get(0),state::incrementAndGet);s.drain();s.advance(3000);check(remote.size()==3&&nativeTokens.size()==1,"native ready does not cancel remote retry");
        c.ready(remote.get(2),state::incrementAndGet);c.failed(nativeTokens.get(0),state::incrementAndGet);c.start(other,RemoteReconnectController.Channel.REMOTE,remote::add);s.drain();int prior=state.get();stale.run();s.advance(40000);check(state.get()==prior&&remote.size()==4&&nativeTokens.size()==1,"profile switch cancels both channels and queued prior state");
        RemoteReconnectController.Token latest=remote.get(3);c.failed(latest,()->{state.incrementAndGet();c.stop();});s.drain();s.advance(40000);check(remote.size()==4,"reentrant Stop during failure action prevents timer registration");
        c.start(p,RemoteReconnectController.Channel.REMOTE,t->{remote.add(t);c.stop();});s.drain();check(remote.size()==5,"connect callback reentrant Stop does not deadlock");
        c.start(p,RemoteReconnectController.Channel.REMOTE,remote::add);c.stop();s.drain();check(remote.size()==5,"Stop before queued initial connect prevents factory creation");
        c.start(p,RemoteReconnectController.Channel.NATIVE,nativeTokens::add);s.drain();RemoteReconnectController.Token n=nativeTokens.get(1);int before=state.get();c.ready(n,state::incrementAndGet);c.ready(n,state::incrementAndGet);c.post(n,state::incrementAndGet);s.drain();check(state.get()==before+3,"native relay-ready and direct-ready both admitted on current attempt");
        c.failed(n,state::incrementAndGet);c.ready(n,state::incrementAndGet);c.post(n,state::incrementAndGet);s.drain();check(state.get()==before+4,"failure makes late same-attempt ready/UI terminal until retry");c.stop();
        for(int i=0;i<100;i++){c.start(new Object(),RemoteReconnectController.Channel.REMOTE,remote::add);c.stop();s.drain();}check(remote.size()==5,"100 rapid activation/Stop cycles leave no connect or queued task");check(s.q.isEmpty(),"virtual queue empty at teardown");
    }
    static final class RealScheduler implements RemoteReconnectController.Scheduler,AutoCloseable {
        final ScheduledExecutorService owner=Executors.newSingleThreadScheduledExecutor();
        final Map<Runnable,ScheduledFuture<?>> futures=new ConcurrentHashMap<>();final List<Long> delays=Collections.synchronizedList(new ArrayList<>());
        public void postDelayed(Runnable r,long d){if(d>0){delays.add(d);event("retryScheduled",null,new JSONObject().put("delayMs",d));}ScheduledFuture<?> f=owner.schedule(()->{futures.remove(r);if(d>0)event("retryTimerFired",null,null);r.run();},d,TimeUnit.MILLISECONDS);if(d>0)futures.put(r,f);}
        public void removeCallbacks(Runnable r){ScheduledFuture<?> f=futures.remove(r);if(f!=null)f.cancel(false);}
        public void close()throws Exception{owner.shutdownNow();require(owner.awaitTermination(3,TimeUnit.SECONDS),"owner scheduler ended");futures.clear();}
    }
    static void await(CountDownLatch l,String what)throws Exception{require(l.await(8,TimeUnit.SECONDS),what);}
    public static void main(String[] args)throws Exception{
        require(args.length==1,"config required");Path cfg=Path.of(args[0]);config=new JSONObject(Files.readString(cfg));require(System.getProperty("user.home").equals(config.getString("home")),"fresh home");require(System.getProperty("java.io.tmpdir").equals(config.getString("home")),"fresh tmp");installNetworkFence();
        RealScheduler scheduler=new RealScheduler();RemoteReconnectController controller=new RemoteReconnectController(scheduler);Throwable failure=null;JSONObject recovery=new JSONObject();CountDownLatch initial=new CountDownLatch(1),recovered=new CountDownLatch(1);AtomicInteger readyCount=new AtomicInteger();
        try{
            logic();
            http=new OkHttpClient.Builder().proxy(Proxy.NO_PROXY).connectTimeout(3,TimeUnit.SECONDS).readTimeout(10,TimeUnit.SECONDS).retryOnConnectionFailure(false).build();
            relay=new WssRelayClient((request,listener)->{require(request.url().toString().equals("https://fixture.invalid/chain"),"synthetic WSS mapping only");int n=epoch;CompletableFuture<TraceSocket> holder=new CompletableFuture<>();WebSocket real=http.newWebSocket(request.newBuilder().url("ws://127.0.0.1:"+config.getInt("relayPort")+"/chain").build(),new WebSocketListener(){TraceSocket get(){return holder.join();}public void onOpen(WebSocket w,Response r){event("wireOpen",null,new JSONObject().put("epoch",n));listener.onOpen(get(),r);}public void onMessage(WebSocket w,String v){event("wireControl",null,new JSONObject().put("epoch",n).put("type",new JSONObject(v).optString("type")));listener.onMessage(get(),v);}public void onMessage(WebSocket w,ByteString v){TraceSocket t=get();t.lastBinary=v;t.trace("mobileDecode",v,true);listener.onMessage(t,v);}public void onFailure(WebSocket w,Throwable e,Response r){listener.onFailure(get(),e,r);}public void onClosing(WebSocket w,int c,String r){listener.onClosing(get(),c,r);}public void onClosed(WebSocket w,int c,String r){listener.onClosed(get(),c,r);}});TraceSocket traced=new TraceSocket(real,listener,n);sockets.add(traced);holder.complete(traced);event("factoryStart",null,new JSONObject().put("epoch",n));return traced;},()->{ServerSocket ss=new ServerSocket();ss.setReuseAddress(true);ss.bind(new InetSocketAddress("127.0.0.1",config.getInt("socksPort")),16);return ss;});
            proxy=new HarnessWebProxy(null,route->{require(route.proxyPort==config.getInt("socksPort")&&route.port==config.getInt("gatewayPort")&&route.host.equals("127.0.0.1")&&route.proxyHost.equals("127.0.0.1"),"route fence");return HarnessWebProxy.connectThroughSocks5(route);});require(proxy.start(config.getInt("proxyPort"))==config.getInt("proxyPort"),"no arbitrary port fallback");
            Object profile=new Object();event("explicitInitialStart",null,null);
            controller.start(profile,RemoteReconnectController.Channel.REMOTE,token->{int n=++epoch;event("controllerConnect",null,new JSONObject().put("epoch",n));relay.start(new PairingProfile.RelayConfig("wss://fixture.invalid/chain",config.getString("room"),config.getString("key"),1),new WssRelayClient.Listener(){public void onReady(int port){controller.ready(token,()->{proxy.updateRoutes(List.of(new PairingProfile.Route("wss-relay","127.0.0.1",config.getInt("gatewayPort"),"127.0.0.1",port)));int count=readyCount.incrementAndGet();event("relayReady",null,new JSONObject().put("epoch",n).put("count",count));if(count==1)initial.countDown();else recovered.countDown();});}public void onFailure(String message){controller.failed(token,()->{event("relayFailure",null,new JSONObject().put("epoch",n));proxy.updateRoutes(List.of());});}});});
            await(initial,"initial ready");command("normal-0",false,false);Future<JSONObject> lost=clients.submit(()->command("late-0",false,true));control("/barrier?name=late");event("dropRequested",null,null);control("/drop");require(!lost.get(5,TimeUnit.SECONDS).getBoolean("ok"),"late request lost ACK");await(recovered,"production controller automatically reconnected");control("/barrier?name=lateAck");
            check(sockets.size()==2&&readyCount.get()==2,"real controller timer creates exactly second socket/ready, not manual reconnect");check(scheduler.delays.equals(List.of(3000L)),"live production retry delay exactly unchanged 3000ms");
            TraceSocket old=sockets.get(0);require(old.lastBinary!=null,"old binary observed");for(int i=0;i<40;i++){old.production.onFailure(old,new IOException("stale"),null);old.production.onClosed(old,1006,"stale");old.production.onMessage(old,"{\"type\":\"welcome\",\"role\":\"mobile\",\"desktopOnline\":true}");old.production.onMessage(old,old.lastBinary);}command("recovery-0",false,false);check(readyCount.get()==2&&sockets.size()==2,"160 old socket callbacks cannot corrupt recovered channel");
            double failAt=events.stream().filter(e->"relayFailure".equals(e.optString("stage"))).findFirst().orElseThrow().getDouble("at"),scheduled=events.stream().filter(e->"retryScheduled".equals(e.optString("stage"))).findFirst().orElseThrow().getDouble("at"),timer=events.stream().filter(e->"retryTimerFired".equals(e.optString("stage"))).findFirst().orElseThrow().getDouble("at"),ready=events.stream().filter(e->"relayReady".equals(e.optString("stage"))&&e.optInt("count")==2).findFirst().orElseThrow().getDouble("at"),receipt=results.stream().filter(e->"recovery-0".equals(e.optString("id"))).findFirst().orElseThrow().getDouble("receipt");
            require(timer-scheduled>=2990,"real delay not shortened");recovery.put("failureToScheduledMs",scheduled-failAt).put("scheduledToTimerMs",timer-scheduled).put("timerToReadyMs",ready-timer).put("readyToNewAckMs",receipt-ready).put("failureToNewAckMs",receipt-failAt);
            controller.stop();relay.stop();CountDownLatch drained=new CountDownLatch(1);scheduler.postDelayed(drained::countDown,0);await(drained,"owner drained");check(scheduler.futures.isEmpty(),"real retry registry empty after stop");
            for(String field:List.of("streams","openingSockets")){java.lang.reflect.Field f=WssRelayClient.class.getDeclaredField(field);f.setAccessible(true);Object v=f.get(relay);check((v instanceof Map?((Map<?,?>)v).size():((Set<?>)v).size())==0,"real stop clears "+field);}
        }catch(Throwable e){failure=e;throw e;}finally{controller.stop();if(proxy!=null)proxy.close();if(relay!=null)relay.stop();scheduler.close();clients.shutdownNow();clients.awaitTermination(3,TimeUnit.SECONDS);if(http!=null){http.dispatcher().executorService().shutdownNow();http.connectionPool().evictAll();http.dispatcher().executorService().awaitTermination(3,TimeUnit.SECONDS);}Files.writeString(cfg.resolveSibling("java-result.json"),new JSONObject().put("ok",failure==null).put("error",failure==null?JSONObject.NULL:failure.toString()).put("checks",checks).put("requests",results).put("events",events).put("postFailureObservationMs",recovery.optDouble("scheduledToTimerMs",0)).put("recovery",recovery).put("automaticRecoveryExecuted",true).put("manualInitialStarts",1).put("claim","actual production controller + live legacy WSS; Android Handler/UI lifecycle not executed").toString(2));}
    }
}
