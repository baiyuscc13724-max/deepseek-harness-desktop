package io.harnessdesktop.mobile;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InterruptedIOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONException;
import org.json.JSONObject;

/** One read-only, identity-bound manifest download. No cache writes and no business retry.
 * Opt-in paging lets interactive streams run between bounded bulk responses on one WSS.
 */
final class ManifestDownload {
    static final int PAGE_BYTES = 16 * 1024;
    static final int MAX_BYTES = 2 * 1024 * 1024;
    static final int PAGE_GAP_MS = 20;
    static final long DEADLINE_MS = 120_000;
    private static final Pattern RANGE = Pattern.compile("bytes (0|[1-9][0-9]*)-([0-9]+)/([0-9]+)");
    interface ConnectionFactory { HttpURLConnection open(URL url) throws IOException; }
    static final class AuthException extends IOException {
        final int status;
        final String cacheAction;
        AuthException(int status, String cacheAction) { super("Manifest authorization failed: " + status); this.status=status; this.cacheAction=cacheAction; }
    }
    private final URL endpoint;
    private final String host, cookie;
    private final int maximumBytes;
    private final ConnectionFactory factory;
    private volatile boolean cancelled;
    private boolean started;
    private long deadline;

    ManifestDownload(URL endpoint, String host, String cookie, int maximumBytes) {
        this(endpoint, host, cookie, maximumBytes, url -> (HttpURLConnection) url.openConnection());
    }
    ManifestDownload(URL endpoint, String host, String cookie, int maximumBytes, ConnectionFactory factory) {
        if (!"http".equals(endpoint.getProtocol()) || !"127.0.0.1".equals(endpoint.getHost()) || endpoint.getPort()<=0
            || !"/__harness_mobile__/sync/manifest".equals(endpoint.getPath()) || endpoint.getRef()!=null
            || maximumBytes<=0 || maximumBytes>MAX_BYTES || cookie==null || cookie.trim().isEmpty()) {
            throw new IllegalArgumentException("Manifest requires the authenticated local gateway and a bounded response");
        }
        this.endpoint=endpoint;this.host=host;this.cookie=cookie;this.maximumBytes=maximumBytes;this.factory=factory;
    }
    /** Nonblocking for the UI. The owner closes its connection in finally; a blocked read is capped at 15s. */
    void cancel() { cancelled=true; }
    boolean isCancelled() { return cancelled; }
    private void check() throws InterruptedIOException {
        if (cancelled || Thread.currentThread().isInterrupted() || System.nanoTime()>=deadline)
            throw new InterruptedIOException("Manifest download cancelled or expired");
    }
    private int remainingTimeout(int cap) throws IOException {
        check();return (int)Math.max(1,Math.min(cap,(deadline-System.nanoTime())/1_000_000));
    }
    private static String required(HttpURLConnection connection,String name,String pattern) throws IOException {
        String value=connection.getHeaderField(name);
        if (value==null || !value.matches(pattern))throw new IOException("Invalid manifest header: "+name);
        return value;
    }
    private byte[] read(InputStream input,int limit) throws IOException {
        ByteArrayOutputStream output=new ByteArrayOutputStream(Math.min(limit,PAGE_BYTES));byte[] buffer=new byte[4096];int n;
        while ((n=input.read(buffer))!=-1) { check();if(output.size()+n>limit)throw new IOException("Manifest byte bound exceeded");output.write(buffer,0,n); }
        check();return output.toByteArray();
    }
    private static JSONObject completeJson(byte[] bytes) throws IOException {
        try {
            String json=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
            JSONObject result=new JSONObject(json);
            if (!result.optBoolean("ok",true) || !result.optBoolean("complete",false) || result.optBoolean("protected",false)
                || !result.optString("cacheIdentity","").matches("[A-Za-z0-9_-]{16,128}"))throw new IOException("Incomplete or unbound manifest");
            return result;
        } catch (JSONException error) { throw new IOException("Invalid manifest JSON",error); }
    }
    private static String sha256(byte[] bytes) throws IOException {
        try { StringBuilder result=new StringBuilder(64);for(byte value:MessageDigest.getInstance("SHA-256").digest(bytes))result.append("0123456789abcdef".charAt((value>>>4)&15)).append("0123456789abcdef".charAt(value&15));return result.toString(); }
        catch (java.security.GeneralSecurityException error) { throw new IOException(error); }
    }
    byte[] download() throws IOException {
        synchronized(this){if(started)throw new IOException("Manifest download is one-shot");started=true;}
        deadline=System.nanoTime()+DEADLINE_MS*1_000_000L;
        URL next=new URL(endpoint.toExternalForm()+(endpoint.getQuery()==null?"?":"&")+"paging=1");
        ByteArrayOutputStream aggregate=null;String[] identity=null;int offset=0,total=-1;
        while(true) {
            check();HttpURLConnection connection=factory.open(next);
            try {
                check();connection.setConnectTimeout(remainingTimeout(8_000));connection.setReadTimeout(remainingTimeout(15_000));
                connection.setUseCaches(false);connection.setInstanceFollowRedirects(false);connection.setRequestMethod("GET");
                connection.setRequestProperty("Accept","application/json, application/octet-stream");connection.setRequestProperty("Cache-Control","no-store");
                connection.setRequestProperty("Host",host);connection.setRequestProperty("Cookie",cookie);connection.setRequestProperty("Connection","close");
                int status=connection.getResponseCode();check();
                if(status==401||status==403||status==410)throw new AuthException(status,connection.getHeaderField("X-Harness-Mobile-Cache-Action"));
                if(status==200 && offset==0) {
                    // Old desktop ignores the opt-in query. Consume its original bounded full response once.
                    if(!"1".equals(connection.getHeaderField("X-Harness-Mobile-Sync-Complete")))throw new IOException("Incomplete legacy manifest");
                    byte[] full;try(InputStream input=connection.getInputStream()){full=read(input,maximumBytes);}completeJson(full);check();return full;
                }
                if(status!=206 || !"1".equals(connection.getHeaderField("X-Harness-Manifest-Paging")) || !"0".equals(connection.getHeaderField("X-Harness-Mobile-Sync-Complete")))throw new IOException("Manifest paging failed: "+status);
                String[] current={required(connection,"X-Harness-Manifest-Token","[A-Za-z0-9_-]{43}"),required(connection,"X-Harness-Manifest-SHA256","[a-f0-9]{64}"),required(connection,"X-Harness-Manifest-Identity","[A-Za-z0-9_-]{16,128}"),required(connection,"X-Harness-Manifest-Epoch","[0-9]{1,16}"),required(connection,"X-Harness-Manifest-Cursor","[A-Za-z0-9_-]{16,128}")};
                String raw=connection.getHeaderField("Content-Range");Matcher range=RANGE.matcher(raw==null?"":raw);
                if(!range.matches())throw new IOException("Invalid manifest content range");
                int begin,end,length;
                try {begin=Integer.parseInt(range.group(1));end=Integer.parseInt(range.group(2));length=Integer.parseInt(range.group(3));if(Long.parseLong(current[3])>9007199254740991L)throw new NumberFormatException();}
                catch(NumberFormatException error){throw new IOException("Manifest range or epoch overflow",error);}
                if(length<=0||length>maximumBytes||begin!=offset||end<begin||end>=length||end-begin+1>PAGE_BYTES||end!=Math.min(begin+PAGE_BYTES,length)-1)throw new IOException("Manifest page offset/size mismatch");
                if(identity==null){identity=current;total=length;aggregate=new ByteArrayOutputStream(total);}
                else if(length!=total||!Arrays.equals(identity,current))throw new IOException("Manifest transfer identity changed");
                byte[] page;try(InputStream input=connection.getInputStream()){page=read(input,end-begin+1);}
                if(page.length!=end-begin+1)throw new IOException("Truncated manifest page");aggregate.write(page,0,page.length);offset=end+1;
                if(offset==total) {
                    byte[] full=aggregate.toByteArray();if(!sha256(full).equals(identity[1]))throw new IOException("Manifest SHA256 mismatch");JSONObject json=completeJson(full);
                    if(!identity[2].equals(json.optString("cacheIdentity",""))||!identity[3].equals(String.valueOf(json.optLong("snapshotEpoch",-1)))||!identity[4].equals(json.optString("cursor","")))throw new IOException("Manifest body identity mismatch");
                    check();return full;
                }
                next=new URL(endpoint.getProtocol(),endpoint.getHost(),endpoint.getPort(),endpoint.getPath()+"?paging=1&token="+identity[0]+"&offset="+offset);
            } finally { connection.disconnect(); }
            check();try {Thread.sleep(PAGE_GAP_MS);}catch(InterruptedException error){Thread.currentThread().interrupt();throw new InterruptedIOException("Manifest paging interrupted");}
        }
    }
}
