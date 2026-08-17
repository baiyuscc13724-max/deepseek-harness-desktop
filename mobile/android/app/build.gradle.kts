plugins {
    id("com.android.application")
}

android {
    namespace = "io.harnessdesktop.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "io.harnessdesktop.mobile"
        minSdk = 26
        targetSdk = 35
        versionCode = 10017
        versionName = "1.0.17"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity:1.10.1")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("com.journeyapps:zxing-android-embedded:4.3.0")
    testImplementation("junit:junit:4.13.2")
}
