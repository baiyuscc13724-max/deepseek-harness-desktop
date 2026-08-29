-keep class com.google.zxing.** { *; }
-keep class com.journeyapps.barcodescanner.** { *; }

# WebRTC's JNI_OnLoad and jni_zero generated bindings resolve exact Java class,
# method, field, and annotation names. Obfuscating these symbols makes the
# release APK trap in libjingle_peerconnection_so.so as soon as P2P starts.
-keep class org.webrtc.** { *; }
-keep class org.jni_zero.** { *; }
-keepattributes *Annotation*

-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
