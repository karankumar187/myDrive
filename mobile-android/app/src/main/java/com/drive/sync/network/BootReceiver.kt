package com.drive.sync.network

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Automatically re-arms background auto-sync when the phone reboots or when
 * the application package is updated.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        Log.d("BootReceiver", "Device reboot / package update received ($action). Restoring myDrive auto-sync schedule...")

        val prefs = context.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", "") ?: ""
        val deviceKey = prefs.getString("device_key", "") ?: ""

        if (deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            SyncAlarmScheduler.scheduleNextAlarm(context)
            Log.d("BootReceiver", "myDrive background auto-sync alarm successfully restored on boot.")
        }
    }
}
