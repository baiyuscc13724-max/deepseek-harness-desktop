package io.harnessdesktop.mobile;

/** Tracks meaningful default-network changes without reacting to duplicate callbacks. */
final class NetworkReconnectPolicy {
    static final long NO_NETWORK = Long.MIN_VALUE;

    private boolean initialized;
    private long activeHandle = NO_NETWORK;
    private boolean usable;

    synchronized void seed(long handle, boolean networkUsable) {
        initialized = true;
        activeHandle = handle;
        usable = networkUsable;
    }

    synchronized boolean available(long handle, boolean networkUsable) {
        if (!initialized) {
            seed(handle, networkUsable);
            return false;
        }
        if (activeHandle == handle && usable == networkUsable) return false;
        activeHandle = handle;
        usable = networkUsable;
        return true;
    }

    synchronized boolean lost(long handle) {
        if (!initialized || activeHandle != handle) return false;
        activeHandle = NO_NETWORK;
        usable = false;
        return true;
    }

    synchronized boolean hasUsableNetwork() {
        return initialized && activeHandle != NO_NETWORK && usable;
    }
}
