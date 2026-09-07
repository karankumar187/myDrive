package com.drive.sync.network

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.WorkManager

/**
 * BroadcastReceiver triggered when the user taps "Stop Sync" on the ongoing live notification.
 * Cancels WorkManager sync and updates notification & persistent log.
 */
class SyncActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_STOP_SYNC = "com.drive.sync.ACTION_STOP_SYNC"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent?.action == ACTION_STOP_SYNC) {
            SyncNotificationHelper.requestCancel()
            try {
                val workManager = WorkManager.getInstance(context)
                workManager.cancelUniqueWork("UnifiedDriveImmediateSync")
                workManager.cancelUniqueWork("UnifiedDrivePeriodicSync")
                workManager.cancelUniqueWork("UnifiedDriveSync")
                workManager.cancelAllWorkByTag("UnifiedDriveSyncTag")
                workManager.cancelAllWorkByTag("UnifiedDriveSync")
            } catch (_: Exception) {}
            SyncLogManager.log("⏸ Sync stopped by user via notification")
            SyncLogManager.status("Sync stopped by user")
            SyncNotificationHelper.showStopped(context)
        }
    }
}
