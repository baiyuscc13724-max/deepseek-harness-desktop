package io.harnessdesktop.mobile;

import static org.junit.Assert.*;
import org.json.JSONObject;
import org.json.JSONException;
import org.junit.Test;

/** Pure JVM protocol/lease checks. These are NOT Android gesture or Activity tests. */
public final class DeepAuditMobileControlTest {
    @Test public void lateCallbacksNeverMatchStoppedOrReplacedCommandAcrossFiftyCycles() {
        for (int i = 0; i < 50; i++) {
            String previous = "fixture-command-" + i;
            String next = "fixture-command-" + (i + 1);
            assertTrue(ControlCommand.matchesActive(previous, previous, true, false));
            assertFalse(ControlCommand.matchesActive(previous, previous, false, false));
            assertFalse(ControlCommand.matchesActive(previous, previous, true, true));
            assertFalse(ControlCommand.matchesActive(next, previous, true, false));
            assertFalse(ControlCommand.matchesActive(null, previous, true, false));
            assertFalse(ControlCommand.matchesActive(previous, null, true, false));
        }
    }

    @Test public void directiveParsingDoesNotConvertStopOrCancelIntoOrdinaryAction() throws Exception {
        for (String type : new String[]{"stop", "cancel"}) {
            ControlCommand command = ControlCommand.parse(new JSONObject()
                .put("type", type).put("protocolVersion", 1).put("id", "fixture-directive-001")
                .put("payload", new JSONObject().put("commandId", "fixture-command-001")));
            assertEquals(type, command.type);
            assertEquals(0, command.retryLimit);
            assertEquals("fixture-command-001", command.payload.getString("commandId"));
        }
    }

    @Test public void sensitiveActionsCannotDisableConfirmationAndBoundsRemainNativeOwned() throws Exception {
        for (String action : new String[]{"textInput", "fileCreate", "clearCache"}) {
            ControlCommand command = ControlCommand.parse(new JSONObject()
                .put("type", "command").put("protocolVersion", 1).put("id", "fixture-command-001")
                .put("action", action).put("requiresConfirmation", false).put("timeoutMs", 999999).put("retryLimit", 999));
            assertTrue(command.requiresConfirmation);
            assertEquals(60000, command.timeoutMs);
            assertEquals(2, command.retryLimit);
        }
    }

    @Test public void unknownProtocolAndPrivilegedActionsFailClosed() throws Exception {
        for (String action : new String[]{"shell", "script", "password", "payment", "clearData", "installApp", "uninstallApp"}) {
            try {
                ControlCommand.parse(new JSONObject().put("type", "command").put("protocolVersion", 1)
                    .put("id", "fixture-command-001").put("action", action));
                fail(action);
            } catch (JSONException expected) { assertEquals("UNSUPPORTED_ACTION", expected.getMessage()); }
        }
        try {
            ControlCommand.parse(new JSONObject().put("type", "stop").put("protocolVersion", 2).put("id", "fixture-command-001"));
            fail("unsupported protocol");
        } catch (JSONException expected) { assertEquals("PROTOCOL_MISMATCH", expected.getMessage()); }
    }
}
