package com.easytier.jni;

/** Minimal Java binding for the official EasyTier Android JNI library. */
public final class EasyTierJNI {
    static {
        System.loadLibrary("easytier_ffi");
        System.loadLibrary("easytier_android_jni");
    }

    private EasyTierJNI() {}

    public static native int parseConfig(String config);
    public static native int runNetworkInstance(String config);
    public static native int retainNetworkInstance(String[] instanceNames);
    public static native String collectNetworkInfos(int maxLength);
    public static native String getLastError();

    public static int stopAllInstances() {
        return retainNetworkInstance(new String[0]);
    }
}
