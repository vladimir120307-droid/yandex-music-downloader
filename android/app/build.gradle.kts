plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "ru.ymd.downloader"
    compileSdk = 34

    defaultConfig {
        applicationId = "ru.ymd.downloader"
        minSdk = 24            // Android 7.0 — покрывает подавляющее большинство устройств
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    // Ключ лежит прямо в репозитории: приложение раздаётся через GitHub, а не
    // через Play Маркет, и подпись нужна лишь для того, чтобы Android разрешил
    // установку и корректно ставил обновления поверх старой версии.
    signingConfigs {
        create("release") {
            storeFile = file("../release.keystore")
            storePassword = "ymdrelease"
            keyAlias = "ymd"
            keyPassword = "ymdrelease"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    buildFeatures { compose = true }
    composeOptions { kotlinCompilerExtensionVersion = "1.5.14" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("androidx.activity:activity-compose:1.9.1")
    implementation(platform("androidx.compose:compose-bom:2024.08.00"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("org.json:json:20240303")
    debugImplementation("androidx.compose.ui:ui-tooling")
}
