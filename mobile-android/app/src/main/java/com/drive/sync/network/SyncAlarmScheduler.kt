package com.drive.sync.network

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log

/**
 * Schedules wakeful background auto-sync using Android's AlarmManager.
 * Uses RTC_WAKEUP and setAndAllowWhileIdle to guarantee wakeup even during deep Doze Mode.
 */
object SyncAlarmScheduler {
    const val ACTION_SCHEDULED_SYNC = "com.drive.sync.ACTION_SCHEDULED_SYNC"
    private const val ALARM_REQUEST_CODE = 42001

    fun scheduleNextAlarm(context: Context, forceImmediate: Boolean = false) {
        val prefs = context.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", "") ?: ""
        val deviceKey = prefs.getString("device_key", "") ?: ""

        if (deviceId.isBlank() || deviceKey.isBlank()) {
            Log.d("SyncAlarmScheduler", "Skipping alarm schedule: device not paired.")
            return
        }

        val intervalHours = prefs.getInt("sync_interval_hours", 2).coerceAtLeast(1)
        val staggerMinutes = prefs.getInt("stagger_offset_minutes", 0).coerceAtLeast(0)
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return

        val intent = Intent(context, SyncAlarmReceiver::class.java).apply {
            action = ACTION_SCHEDULED_SYNC
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val triggerAtMillis = if (forceImmediate) {
            System.currentTimeMillis() + 5000L // 5 seconds
        } else {
            val nextSaved = prefs.getLong("next_sync_timestamp", 0L)
            val minDelay = if (staggerMinutes > 0) staggerMinutes * 60 * 1000L else intervalHours * 3600 * 1000L
            if (nextSaved > System.currentTimeMillis() + 10000L) {
                nextSaved
            } else {
                System.currentTimeMillis() + minDelay
            }
        }

        prefs.edit().putLong("next_sync_timestamp", triggerAtMillis).apply()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                // setAndAllowWhileIdle guarantees wakeup even when phone is in deep Doze mode
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP,
                    triggerAtMillis,
                    pendingIntent
                )
            } else {
                alarmManager.set(
                    AlarmManager.RTC_WAKEUP,
                    triggerAtMillis,
                    pendingIntent
                )
            }
            Log.d("SyncAlarmScheduler", "Scheduled auto-sync alarm at $triggerAtMillis (interval: ${intervalHours}h)")
        } catch (e: Exception) {
            Log.e("SyncAlarmScheduler", "Failed to schedule alarm", e)
        }
    }

    fun cancelAlarm(context: Context) {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        val intent = Intent(context, SyncAlarmReceiver::class.java).apply {
            action = ACTION_SCHEDULED_SYNC
        }
        val pendingIntent = PendingIntent.getBroadcast(
            context,
            ALARM_REQUEST_CODE,
            intent,
            PendingIntent.FLAG_NO_CREATE or PendingIntent.FLAG_IMMUTABLE
        )
        if (pendingIntent != null) {
            alarmManager.cancel(pendingIntent)
            pendingIntent.cancel()
            Log.d("SyncAlarmScheduler", "Cancelled existing auto-sync alarm")
        }
    }
}
