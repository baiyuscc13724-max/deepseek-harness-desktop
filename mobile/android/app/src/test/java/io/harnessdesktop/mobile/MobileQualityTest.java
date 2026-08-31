package io.harnessdesktop.mobile;

import static org.junit.Assert.assertEquals;

import android.webkit.WebViewClient;

import org.junit.Test;

public final class MobileQualityTest {
    @Test public void httpFailuresEnterFiniteUserFacingStates() {
        assertEquals(MainActivity.MainFrameState.AUTH_EXPIRED, MainActivity.classifyHttpFailure(401));
        assertEquals(MainActivity.MainFrameState.AUTH_EXPIRED, MainActivity.classifyHttpFailure(403));
        assertEquals(MainActivity.MainFrameState.AUTH_EXPIRED, MainActivity.classifyHttpFailure(410));
        assertEquals(MainActivity.MainFrameState.RETRYING, MainActivity.classifyHttpFailure(502));
        assertEquals(MainActivity.MainFrameState.RETRYING, MainActivity.classifyHttpFailure(503));
        assertEquals(MainActivity.MainFrameState.RETRYING, MainActivity.classifyHttpFailure(504));
        assertEquals(MainActivity.MainFrameState.TERMINAL_ERROR, MainActivity.classifyHttpFailure(404));
        assertEquals(MainActivity.MainFrameState.TERMINAL_ERROR, MainActivity.classifyHttpFailure(429));
        assertEquals(MainActivity.MainFrameState.TERMINAL_ERROR, MainActivity.classifyHttpFailure(500));
    }

    @Test public void dnsAndTimeoutRetryOnlyWhileANetworkExists() {
        assertEquals(MainActivity.MainFrameState.RETRYING,
            MainActivity.classifyWebFailure(WebViewClient.ERROR_HOST_LOOKUP, true));
        assertEquals(MainActivity.MainFrameState.RETRYING,
            MainActivity.classifyWebFailure(WebViewClient.ERROR_TIMEOUT, true));
        assertEquals(MainActivity.MainFrameState.OFFLINE,
            MainActivity.classifyWebFailure(WebViewClient.ERROR_HOST_LOOKUP, false));
        assertEquals(MainActivity.MainFrameState.OFFLINE,
            MainActivity.classifyWebFailure(WebViewClient.ERROR_TIMEOUT, false));
    }

    @Test public void unsupportedAndSslFailuresAreTerminal() {
        assertEquals(MainActivity.MainFrameState.TERMINAL_ERROR,
            MainActivity.classifyWebFailure(WebViewClient.ERROR_UNSUPPORTED_SCHEME, true));
        assertEquals(MainActivity.MainFrameState.TERMINAL_ERROR, MainActivity.classifySslFailure());
    }
}
