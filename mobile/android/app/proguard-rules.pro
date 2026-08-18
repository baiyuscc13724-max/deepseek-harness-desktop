-keep class com.google.zxing.** { *; }
-keep class com.journeyapps.barcodescanner.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
