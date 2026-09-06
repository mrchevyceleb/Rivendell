import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// One version for the whole ship: the repository's root package.json.
val rootPackage = JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>
val shipVersion = rootPackage["version"] as String
// versionCode must rise with every release Android is asked to update to, so
// each semver component gets three digits and anything wider fails the build.
val versionParts = shipVersion.split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
require(versionParts.size == 3 && versionParts.all { it in 0..999 }) {
    "package.json version '$shipVersion' must be MAJOR.MINOR.PATCH with each part below 1000"
}
val shipVersionCode = versionParts[0] * 1_000_000 + versionParts[1] * 1_000 + versionParts[2]

// Release signing comes from android/keystore.properties (never committed) or
// the ANDROID_KEYSTORE_* environment variables in CI. Without either, release
// builds fall back to the debug key so a sideloadable APK still comes out.
val keystore = Properties().apply {
    val file = rootProject.file("keystore.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
val ksFile = keystore.getProperty("storeFile") ?: System.getenv("ANDROID_KEYSTORE_FILE")
val ksPassword = keystore.getProperty("storePassword") ?: System.getenv("ANDROID_KEYSTORE_PASSWORD")
val ksAlias = keystore.getProperty("keyAlias") ?: System.getenv("ANDROID_KEY_ALIAS")
val ksKeyPassword = keystore.getProperty("keyPassword") ?: System.getenv("ANDROID_KEY_PASSWORD")
val hasReleaseKey = !ksFile.isNullOrBlank() && !ksPassword.isNullOrBlank() &&
    !ksAlias.isNullOrBlank() && !ksKeyPassword.isNullOrBlank()

android {
    namespace = "app.tardis.mobile"
    // -Ptardis.compileSdk=34 lets an arm64 Linux box (no official AAPT2 build)
    // smoke-compile with its distribution aapt2; releases use the default.
    compileSdk = (project.findProperty("tardis.compileSdk") as String?)?.toInt() ?: 36

    defaultConfig {
        applicationId = "app.tardis.mobile"
        minSdk = 29
        targetSdk = 34
        versionCode = shipVersionCode
        versionName = shipVersion
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = rootProject.file(ksFile!!)
                storePassword = ksPassword
                keyAlias = ksAlias
                keyPassword = ksKeyPassword
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.webkit:webkit:1.12.1")
}
