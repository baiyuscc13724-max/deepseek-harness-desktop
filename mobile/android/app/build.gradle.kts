import java.util.Properties

plugins {
    id("com.android.application")
}

val releaseKeystorePath = providers.environmentVariable("HARNESS_ANDROID_KEYSTORE_PATH").orNull
val releaseKeyAlias = providers.environmentVariable("HARNESS_ANDROID_KEY_ALIAS").orNull
val releaseStorePassword = providers.environmentVariable("HARNESS_ANDROID_STORE_PASSWORD").orNull
val releaseKeyPassword = providers.environmentVariable("HARNESS_ANDROID_KEY_PASSWORD").orNull
val releaseSigningConfigured = listOf(releaseKeystorePath, releaseKeyAlias, releaseStorePassword, releaseKeyPassword).all { !it.isNullOrBlank() }
val mobileVersionProperties = Properties().apply {
    file("version.properties").inputStream().use { load(it) }
}
val mobileVersionNameOverride = providers.gradleProperty("HARNESS_MOBILE_VERSION_NAME").orNull?.trim()?.takeIf { it.isNotEmpty() }
val mobileVersionCodeOverride = providers.gradleProperty("HARNESS_MOBILE_VERSION_CODE").orNull?.trim()?.takeIf { it.isNotEmpty() }
require((mobileVersionNameOverride == null) == (mobileVersionCodeOverride == null)) {
    "HARNESS_MOBILE_VERSION_NAME and HARNESS_MOBILE_VERSION_CODE must be supplied together"
}
val mobileVersionName = mobileVersionNameOverride
    ?: requireNotNull(mobileVersionProperties.getProperty("versionName")) { "version.properties must define versionName" }
val mobileVersionCode = (mobileVersionCodeOverride
    ?: requireNotNull(mobileVersionProperties.getProperty("versionCode")) { "version.properties must define versionCode" }).toInt()
require(Regex("^\\d+\\.\\d+\\.\\d+(?:\\.\\d+)?$").matches(mobileVersionName)) { "Android versionName is invalid: '$mobileVersionName'" }
require(mobileVersionCode in 1..2_147_483_647) { "Android versionCode is invalid" }

android {
    namespace = "io.harnessdesktop.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.harnessdesktop.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = mobileVersionCode
        versionName = mobileVersionName
        val defaultUpdateManifestUrl = "https://raw.githubusercontent.com/baiyuscc13724-max/deepseek-harness-desktop/main/mobile/mobile-app-update.json"
        val updateManifestUrl = providers.gradleProperty("HARNESS_MOBILE_UPDATE_MANIFEST_URL").orElse(defaultUpdateManifestUrl).get()
        buildConfigField("String", "MOBILE_UPDATE_MANIFEST_URL", "\"${updateManifestUrl.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (releaseSigningConfigured) {
            create("release") {
                storeFile = file(releaseKeystorePath!!)
                keyAlias = releaseKeyAlias
                storePassword = releaseStorePassword
                keyPassword = releaseKeyPassword
                enableV1Signing = true
                enableV2Signing = true
                enableV3Signing = true
                enableV4Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseSigningConfigured) signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

val verifyReleaseSigningConfiguration = tasks.register("verifyReleaseSigningConfiguration") {
    doLast {
        if (!releaseSigningConfigured) {
            throw GradleException("Release signing is not configured. Set the four HARNESS_ANDROID_* environment variables; never publish a debug or unsigned APK.")
        }
    }
}

val verifyReleaseWebRtcJniSymbols = tasks.register("verifyReleaseWebRtcJniSymbols") {
    dependsOn("minifyReleaseWithR8")
    doLast {
        val mappingFile = layout.buildDirectory.file("outputs/mapping/release/mapping.txt").get().asFile
        if (!mappingFile.isFile) throw GradleException("Release R8 mapping is missing: ${mappingFile.absolutePath}")
        val mapping = mappingFile.readText()
        val lines = mapping.lineSequence().toList()
        val checks = listOf(
            "PeerConnectionFactory class" to mapping.contains("org.webrtc.PeerConnectionFactory -> org.webrtc.PeerConnectionFactory:"),
            "PeerConnectionFactory.initialize" to lines.any { it.contains("void initialize(org.webrtc.PeerConnectionFactory\$InitializationOptions)") && it.endsWith(" -> initialize") },
            "NativeLibrary class" to mapping.contains("org.webrtc.NativeLibrary -> org.webrtc.NativeLibrary:"),
            "NativeLibrary.initialize" to lines.any { it.contains("void initialize(org.webrtc.NativeLibraryLoader,java.lang.String)") && it.endsWith(" -> initialize") },
            "jni_zero JniInit class" to mapping.contains("org.jni_zero.JniInit -> org.jni_zero.JniInit:")
        )
        val failed = checks.filterNot { it.second }.map { it.first }
        if (failed.isNotEmpty()) {
            throw GradleException("Release shrinker renamed WebRTC JNI bindings: ${failed.joinToString()}")
        }
    }
}

tasks.configureEach {
    if (name == "packageRelease" || name == "signReleaseBundle") dependsOn(verifyReleaseSigningConfiguration)
    if (name == "assembleRelease") dependsOn(verifyReleaseWebRtcJniSymbols)
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    // BSD-3-Clause WebRTC SDK. The AAR ships arm64-v8a, armeabi-v7a, x86 and
    // x86_64 native libraries; no camera/microphone APIs or permissions are used.
    implementation("io.github.webrtc-sdk:android:144.7559.14")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
