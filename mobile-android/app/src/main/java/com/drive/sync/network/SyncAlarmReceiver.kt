package com.drive.sync.network

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.os.PowerManager
import android.util.Log
import androidx.work.*
import com.drive.sync.workers.SyncWorker

/**
 * BroadcastReceiver triggered by AlarmManager even during Doze mode.
 * Wakes up CPU via WakeLock, verifies Wi-Fi and charging constraints, posts a visible
 * notification, triggers the sync worker, and arms the next schedule.
 */
class SyncAlarmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action != SyncAlarmScheduler.ACTION_SCHEDULED_SYNC) return

        Log.d("SyncAlarmReceiver", "Scheduled auto-sync alarm triggered!")
        val prefs = context.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", "") ?: ""
        val deviceKey = prefs.getString("device_key", "") ?: ""

        if (deviceId.isBlank() || deviceKey.isBlank()) {
            Log.d("SyncAlarmReceiver", "Device not paired. Skipping.")
            return
        }

        val defaultEdgeUrl = "https://drive-edge-cache.karan9302451907.workers.dev"
        var rawServerUrl = prefs.getString("server_url", defaultEdgeUrl) ?: defaultEdgeUrl
        if (rawServerUrl.isBlank() || rawServerUrl.contains("onrender.com")) {
            rawServerUrl = defaultEdgeUrl
            prefs.edit().putString("server_url", defaultEdgeUrl).apply()
        }
        var serverUrl = rawServerUrl.trim().trimEnd('/')
        if (!serverUrl.startsWith("http://") && !serverUrl.startsWith("https://")) {
            serverUrl = if (serverUrl.matches(Regex("^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}(:\\d+)?.*"))) "http://$serverUrl" else "https://$serverUrl"
        }
        val targetFolderId = prefs.getString("target_folder_id", "") ?: ""
        val wifiOnly = prefs.getBoolean("wifi_only", false)
        val chargingOnly = prefs.getBoolean("charging_only", false)
        val syncPhotos = prefs.getBoolean("sync_photos", true)
        val syncVideos = prefs.getBoolean("sync_videos", true)
        val syncDocuments = prefs.getBoolean("sync_documents", true)
        val intervalHours = prefs.getInt("sync_interval_hours", 2)

        // 1. Acquire partial WakeLock to guarantee CPU stays active until WorkManager runs
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        val wakeLock = powerManager?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "myDrive:SyncAlarmWakeLock"
        )
        try {
            wakeLock?.acquire(60 * 1000L) // 60s max safety timeout
        } catch (_: Exception) {}

        // 2. Functional check: Wi-Fi constraint
        if (wifiOnly && !isWifiConnected(context)) {
            Log.d("SyncAlarmReceiver", "Auto-sync postponed: Wi-Fi required but currently on cellular/disconnected.")
            SyncLogManager.init(context)
            SyncLogManager.log("⏸ Scheduled auto-sync postponed: Waiting for Wi-Fi.")
            rescheduleRetry(context, 15)
            try {
                if (wakeLock?.isHeld == true) wakeLock.release()
            } catch (_: Exception) {}
            return
        }

        // 3. Functional check: Charging constraint
        if (chargingOnly && !isDeviceCharging(context)) {
            Log.d("SyncAlarmReceiver", "Auto-sync postponed: Charging required but device is on battery.")
            SyncLogManager.init(context)
            SyncLogManager.log("⏸ Scheduled auto-sync postponed: Waiting for charger.")
            rescheduleRetry(context, 15)
            try {
                if (wakeLock?.isHeld == true) wakeLock.release()
            } catch (_: Exception) {}
            return
        }

        // 4. Push visible notification to status bar immediately
        SyncNotificationHelper.showAutoSyncTriggered(context, intervalHours)

        // 5. Build and enqueue WorkManager expedited request
        val inputData = workDataOf(
            "server_url" to serverUrl,
            "device_id" to deviceId,
            "device_key" to deviceKey,
            "target_folder_id" to targetFolderId,
            "wifi_only" to wifiOnly,
            "charging_only" to chargingOnly,
            "sync_photos" to syncPhotos,
            "sync_videos" to syncVideos,
            "sync_documents" to syncDocuments,
            "is_manual" to false
        )

        val constraints = Constraints.Builder().apply {
            if (wifiOnly) {
                setRequiredNetworkType(NetworkType.UNMETERED)
            } else {
                setRequiredNetworkType(NetworkType.CONNECTED)
            }
            if (chargingOnly) {
                setRequiresCharging(true)
            }
        }.build()

        val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints)
            .setInputData(inputData)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .addTag("UnifiedDriveSyncTag")
            .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "UnifiedDriveScheduledAlarmSync",
            ExistingWorkPolicy.REPLACE,
            syncRequest
        )

        // 6. Arm the next alarm for next scheduled cycle
        val nextSync = System.currentTimeMillis() + (intervalHours * 3600 * 1000L)
        prefs.edit().putLong("next_sync_timestamp", nextSync).apply()
        SyncAlarmScheduler.scheduleNextAlarm(context)

        // WakeLock safely held for WorkManager kickoff, will auto-release after timeout or GC
    }

    private fun rescheduleRetry(context: Context, retryMinutes: Int) {
        val prefs = context.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val nextSync = System.currentTimeMillis() + (retryMinutes * 60 * 1000L)
        prefs.edit().putLong("next_sync_timestamp", nextSync).apply()
        SyncAlarmScheduler.scheduleNextAlarm(context)
    }

    companion object {
        fun isWifiConnected(context: Context): Boolean {
            return try {
                val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager ?: return false
                val network = cm.activeNetwork ?: return false
                val capabilities = cm.getNetworkCapabilities(network) ?: return false
                capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
                        capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) ||
                        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            } catch (e: Exception) {
                true // Fail open if permission check fails
            }
        }

        fun isDeviceCharging(context: Context): Boolean {
            return try {
                val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
                val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
                status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
            } catch (e: Exception) {
                true // Fail open if battery check fails
            }
        }
    }
}
