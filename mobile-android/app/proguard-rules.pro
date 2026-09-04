# ProGuard / R8 Rules for myDrive

# Keep Kotlin reflect and coroutines
-keepattributes *Annotation*,InnerClasses,EnclosingMethod,Signature
-dontwarn java.lang.invoke.**
-dontwarn javax.annotation.**

# OkHttp & Okio
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
-keep interface okhttp3.** { *; }

# Coil Image Loader
-keep class coil.** { *; }
-keep interface coil.** { *; }

# WorkManager
-keep class * extends androidx.work.Worker { *; }
-keep class * extends androidx.work.ListenableWorker { *; }
-keep class com.drive.sync.workers.** { *; }

# Jetpack Compose
-keep class androidx.compose.** { *; }

# myDrive Data Classes (prevent field obfuscation during JSON parsing)
-keep class com.drive.sync.CloudFile { *; }
-keep class com.drive.sync.CloudMedia { *; }
-keep class com.drive.sync.CloudFolder { *; }
-keep class com.drive.sync.PairedDevice { *; }
-keep class com.drive.sync.PairedDeviceRule { *; }
-keep class com.drive.sync.DeviceUploadItem { *; }
-keep class com.drive.sync.InboundSyncItem { *; }
-keep class com.drive.sync.StoragePoolSummary { *; }
-keep class com.drive.sync.crypto.** { *; }
