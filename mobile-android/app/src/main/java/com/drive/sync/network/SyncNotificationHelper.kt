package com.drive.sync.network

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.ForegroundInfo
import com.drive.sync.MainActivity
import com.drive.sync.R
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Unified Live Notification Manager for myDrive backups.
 * Provides real-time Zomato/delivery-style status updates in the status bar
 * with live progress bars, current item name, file sizes, speed/destination,
 * an actionable Stop button, and descriptive error/completion states.
 */
object SyncNotificationHelper {
    const val CHANNEL_ID = "mydrive_sync_live_channel"
    const val SYNC_NOTIFICATION_ID = 1001
    const val COMPLETION_NOTIFICATION_ID = 1002
    const val STOPPED_NOTIFICATION_ID = 1003
    const val ERROR_NOTIFICATION_ID = 1004

    private val isCancelled = AtomicBoolean(false)

    fun isSyncCancelled(): Boolean = isCancelled.get()

    fun requestCancel() {
        isCancelled.set(true)
    }

    fun resetCancel() {
        isCancelled.set(false)
    }

    fun ensureNotificationChannel(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            val channel = NotificationChannel(
                CHANNEL_ID,
                "myDrive Live Backup",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Displays live progress of photo, video, and file backups"
                setShowBadge(true)
                enableVibration(false)
                enableLights(false)
            }
            nm.createNotificationChannel(channel)
        }
    }

    private fun getOpenAppPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        return PendingIntent.getActivity(
            context,
            100,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun getStopPendingIntent(context: Context): PendingIntent {
        val intent = Intent(context, SyncActionReceiver::class.java).apply {
            action = SyncActionReceiver.ACTION_STOP_SYNC
        }
        return PendingIntent.getBroadcast(
            context,
            101,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    fun buildLiveNotification(
        context: Context,
        title: String = "myDrive Live Backup ⚡",
        message: String,
        current: Int = 0,
        total: Int = 0,
        isIndeterminate: Boolean = false,
        driveLabel: String? = null
    ): Notification {
        ensureNotificationChannel(context)

        val subText = if (!driveLabel.isNullOrBlank()) "☁ $driveLabel" else if (total > 0) "$current of $total items" else "Live Sync"

        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(message)
            .setSubText(subText)
            .setSmallIcon(R.drawable.ic_mydrive_logo)
            .setColor(0xFF38BDF8.toInt())
            .setContentIntent(getOpenAppPendingIntent(context))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop Sync", getStopPendingIntent(context))

        if (isIndeterminate) {
            builder.setProgress(0, 0, true)
        } else if (total > 0) {
            builder.setProgress(total, current, false)
        }

        return builder.build()
    }

    fun createForegroundInfo(
        context: Context,
        title: String = "myDrive Live Backup ⚡",
        message: String = "Preparing backup...",
        current: Int = 0,
        total: Int = 0,
        isIndeterminate: Boolean = false,
        driveLabel: String? = null
    ): ForegroundInfo {
        val notification = buildLiveNotification(context, title, message, current, total, isIndeterminate, driveLabel)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(SYNC_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(SYNC_NOTIFICATION_ID, notification)
        }
    }

    fun showScanning(context: Context, category: String) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            val notification = buildLiveNotification(
                context = context,
                title = "myDrive Live Backup ⚡",
                message = "Scanning $category on device...",
                isIndeterminate = true
            )
            nm.notify(SYNC_NOTIFICATION_ID, notification)
        } catch (_: Exception) {}
    }

    fun showProgress(
        context: Context,
        filename: String,
        current: Int,
        total: Int,
        sizeBytes: Long = 0L,
        driveLabel: String? = null
    ) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            val percent = if (total > 0) (current * 100) / total else 0
            val sizeStr = if (sizeBytes > 0) " (${SyncLogManager.formatBytes(sizeBytes)})" else ""
            val title = if (total > 0) "myDrive Live Backup ⚡ ($current/$total • $percent%)" else "myDrive Live Backup ⚡"
            val message = "Uploading $filename$sizeStr"
            val notification = buildLiveNotification(
                context = context,
                title = title,
                message = message,
                current = current,
                total = total,
                isIndeterminate = false,
                driveLabel = driveLabel
            )
            nm.notify(SYNC_NOTIFICATION_ID, notification)
        } catch (_: Exception) {}
    }

    fun showError(context: Context, errorMsg: String) {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            nm.cancel(SYNC_NOTIFICATION_ID)

            if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setContentTitle("myDrive: Sync Paused ⚠")
                    .setContentText(errorMsg)
                    .setStyle(NotificationCompat.BigTextStyle().bigText("Sync could not complete:\n$errorMsg\n\nWill retry automatically on schedule."))
                    .setSmallIcon(R.drawable.ic_mydrive_logo)
                    .setColor(0xFFEF4444.toInt())
                    .setContentIntent(getOpenAppPendingIntent(context))
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .build()
                nm.notify(ERROR_NOTIFICATION_ID, notification)
            }
        } catch (_: Exception) {}
    }

    fun showCompletion(context: Context, totalUploaded: Int, totalFailed: Int = 0) {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            nm.cancel(SYNC_NOTIFICATION_ID)

            if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                val (title, text) = when {
                    totalUploaded > 0 && totalFailed > 0 ->
                        Pair("myDrive: Backup Finished with Notice", "$totalUploaded item(s) backed up ($totalFailed failed). Tap to view logs.")
                    totalUploaded > 0 ->
                        Pair("myDrive: Backup Complete ✓", "$totalUploaded new item(s) safely synced to Cloud Drive.")
                    totalFailed > 0 ->
                        Pair("myDrive: Backup Notice", "$totalFailed item(s) failed to sync. Tap to view logs.")
                    else ->
                        Pair("myDrive: Up to date", "Everything is already backed up and up to date.")
                }
                val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setSmallIcon(R.drawable.ic_mydrive_logo)
                    .setColor(0xFF38BDF8.toInt())
                    .setContentIntent(getOpenAppPendingIntent(context))
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .build()
                nm.notify(COMPLETION_NOTIFICATION_ID, notification)
            }
        } catch (_: Exception) {}
    }

    fun showStopped(context: Context) {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            nm.cancel(SYNC_NOTIFICATION_ID)

            if (NotificationManagerCompat.from(context).areNotificationsEnabled()) {
                val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                    .setContentTitle("myDrive: Sync Paused")
                    .setContentText("Backup was stopped by user.")
                    .setSmallIcon(R.drawable.ic_mydrive_logo)
                    .setColor(0xFF38BDF8.toInt())
                    .setContentIntent(getOpenAppPendingIntent(context))
                    .setAutoCancel(true)
                    .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                    .build()
                nm.notify(STOPPED_NOTIFICATION_ID, notification)
            }
        } catch (_: Exception) {}
    }

    fun showDownloadCompleteNotification(
        context: Context,
        filename: String,
        isMedia: Boolean,
        fileUri: android.net.Uri? = null
    ) {
        try {
            ensureNotificationChannel(context)
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
            if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return

            val dest = if (isMedia) "Phone Gallery" else "Downloads/myDrive"
            val contentIntent = if (fileUri != null) {
                val mimeType = if (isMedia) {
                    if (filename.endsWith(".mp4", true) || filename.endsWith(".mkv", true) || filename.endsWith(".mov", true)) "video/*" else "image/*"
                } else "*/*"
                val viewIntent = Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(fileUri, mimeType)
                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                }
                PendingIntent.getActivity(
                    context,
                    (System.currentTimeMillis() % 100000).toInt(),
                    viewIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
            } else {
                getOpenAppPendingIntent(context)
            }

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setContentTitle(if (isMedia) "Saved to Gallery ✓" else "Download Complete ✓")
                .setContentText("$filename saved to $dest")
                .setSmallIcon(R.drawable.ic_mydrive_logo)
                .setColor(0xFF38BDF8.toInt())
                .setContentIntent(contentIntent)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .build()

            nm.notify((System.currentTimeMillis() % 100000).toInt() + 3000, notification)
        } catch (_: Exception) {}
    }
}
