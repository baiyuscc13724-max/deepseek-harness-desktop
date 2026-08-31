package io.harnessdesktop.mobile;

/**
 * Debounces Android default-network callbacks and commits only stable changes.
 * Observed candidates stay pending during the holdoff, so a working logical
 * connection remains usable while Wi-Fi and cellular callbacks overlap.
 */
final class NetworkReconnectPolicy {
    static final long NO_NETWORK = Long.MIN_VALUE;
    static final long RECOVERY_HOLDOFF_MS = 250L;
    static final long SWITCH_HOLDOFF_MS = 3_000L;
    static final long LOSS_HOLDOFF_MS = 1_500L;

    static final class Transition {
        final long generation;
        final long previousHandle;
        final long activeHandle;
        final boolean previouslyUsable;
        final boolean usable;

        Transition(long generation, long previousHandle, long activeHandle, boolean previouslyUsable, boolean usable) {
            this.generation = generation;
            this.previousHandle = previousHandle;
            this.activeHandle = activeHandle;
            this.previouslyUsable = previouslyUsable;
            this.usable = usable;
        }

        boolean recovered() { return !previouslyUsable && usable; }
        boolean switched() { return previouslyUsable && usable && previousHandle != activeHandle; }
        boolean disconnected() { return previouslyUsable && !usable; }
    }

    private boolean initialized;
    private long activeHandle = NO_NETWORK;
    private boolean usable;
    private boolean pending;
    private long pendingHandle = NO_NETWORK;
    private boolean pendingUsable;
    private long generation;

    synchronized void seed(long handle, boolean networkUsable) {
        initialized = true;
        activeHandle = handle;
        usable = networkUsable;
        pending = false;
        pendingHandle = NO_NETWORK;
        pendingUsable = false;
    }

    synchronized boolean available(long handle, boolean networkUsable) {
        if (!initialized) {
            seed(handle, networkUsable);
            return false;
        }
        if (pending && pendingHandle == handle && pendingUsable == networkUsable) return false;
        if (!pending && activeHandle == handle && usable == networkUsable) return false;
        pending = true;
        pendingHandle = handle;
        pendingUsable = networkUsable;
        return true;
    }

    synchronized boolean lost(long handle) {
        if (!initialized) return false;
        // Android commonly reports the old default lost after already announcing
        // its usable successor. Never overwrite that newer candidate with a
        // transient offline state.
        if (pending && pendingUsable && pendingHandle != handle) return false;
        if (pending && pendingHandle == handle && !pendingUsable) return false;
        if ((!pending && activeHandle != handle) || (pending && pendingHandle != handle && activeHandle != handle)) return false;
        pending = true;
        pendingHandle = NO_NETWORK;
        pendingUsable = false;
        return true;
    }

    synchronized long pendingDelayMillis() {
        if (!pending) return 0L;
        if (pendingUsable && !usable) return RECOVERY_HOLDOFF_MS;
        if (pendingUsable) return SWITCH_HOLDOFF_MS;
        return LOSS_HOLDOFF_MS;
    }

    synchronized Transition commitPending() {
        if (!pending) return null;
        long previousHandle = activeHandle;
        boolean previouslyUsable = initialized && activeHandle != NO_NETWORK && usable;
        activeHandle = pendingHandle;
        usable = pendingUsable;
        pending = false;
        pendingHandle = NO_NETWORK;
        pendingUsable = false;
        if (previousHandle == activeHandle && previouslyUsable == usable) return null;
        return new Transition(++generation, previousHandle, activeHandle, previouslyUsable, hasUsableNetwork());
    }

    synchronized boolean hasUsableNetwork() {
        return initialized && activeHandle != NO_NETWORK && usable;
    }

    synchronized long generation() { return generation; }
}
