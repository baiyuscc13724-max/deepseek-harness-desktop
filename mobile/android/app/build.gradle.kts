plugins {
    id("com.android.application")
}

val releaseKeystorePath = providers.environmentVariable("HARNESS_ANDROID_KEYSTORE_PATH").orNull
val releaseKeyAlias = providers.environmentVariable("HARNESS_ANDROID_KEY_ALIAS").orNull
val releaseStorePassword = providers.environmentVariable("HARNESS_ANDROID_STORE_PASSWORD").orNull
val releaseKeyPassword = providers.environmentVariable("HARNESS_ANDROID_KEY_PASSWORD").orNull
val releaseSigningConfigured = listOf(releaseKeystorePath, releaseKeyAlias, releaseStorePassword, releaseKeyPassword).all { !it.isNullOrBlank() }

android {
    namespace = "io.harnessdesktop.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.harnessdesktop.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 10034
        versionName = "1.0.34"
        val updateManifestUrl = providers.gradleProperty("HARNESS_MOBILE_UPDATE_MANIFEST_URL").orElse("").get()
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

tasks.configureEach {
    if (name == "packageRelease" || name == "signReleaseBundle") dependsOn(verifyReleaseSigningConfiguration)
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
