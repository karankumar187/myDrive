package com.drive.sync.workers

import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.util.Size
import androidx.work.CoroutineWorker
import androidx.work.ForegroundInfo
import androidx.work.WorkerParameters
import com.drive.sync.crypto.VaultCrypto
import com.drive.sync.network.SyncLogManager
import com.drive.sync.network.SyncNotificationHelper
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit

class SyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    private val client = com.drive.sync.sharedHttpClient

    // Dedicated client with generous timeouts for large file/video streaming to Google Drive
    private val uploadClient: OkHttpClient by lazy {
        client.newBuilder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(10, TimeUnit.MINUTES)
            .writeTimeout(10, TimeUnit.MINUTES)
            .retryOnConnectionFailure(true)
            .build()
    }

    override suspend fun getForegroundInfo(): ForegroundInfo {
        return SyncNotificationHelper.createForegroundInfo(
            applicationContext,
            title = "myDrive Live Backup ⚡",
            message = "Checking for new media to back up...",
            isIndeterminate = true
        )
    }

    private fun reportStatus(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        status: String,
        activity: String,
        logMessage: String? = null
    ) {
        if (serverUrl.isBlank() || deviceId.isBlank() || deviceKey.isBlank()) return
        try {
            val base = serverUrl.trimEnd('/')
            val json = JSONObject().apply {
                put("status", status)
                put("activity", activity)
                if (!logMessage.isNullOrBlank()) {
                    put("logMessage", logMessage)
                }
            }
            val req = Request.Builder()
                .url("$base/api/v1/devices/sync-status")
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .post(json.toString().toRequestBody("application/json".toMediaType()))
                .build()
            client.newCall(req).execute().close()
        } catch (_: Exception) {}
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        SyncLogManager.init(applicationContext)
        val prefs = applicationContext.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val serverUrl = (inputData.getString("server_url") ?: prefs.getString("server_url", "https://drive-edge-cache.karan9302451907.workers.dev") ?: "https://drive-edge-cache.karan9302451907.workers.dev").trimEnd('/')
        val deviceId = inputData.getString("device_id") ?: prefs.getString("device_id", "") ?: return@withContext Result.failure()
        val deviceKey = inputData.getString("device_key") ?: prefs.getString("device_key", "") ?: return@withContext Result.failure()

        if (deviceId.isBlank() || deviceKey.isBlank()) {
            SyncLogManager.log("❌ Sync halted: Device is not paired.")
            return@withContext Result.failure()
        }

        val syncVideos = inputData.getBoolean("sync_videos", prefs.getBoolean("sync_videos", true))
        val syncPhotos = inputData.getBoolean("sync_photos", prefs.getBoolean("sync_photos", true))
        val syncDocuments = inputData.getBoolean("sync_documents", prefs.getBoolean("sync_documents", true))
        val targetFolderId = inputData.getString("target_folder_id") ?: prefs.getString("target_folder_id", null)
        val isManual = inputData.getBoolean("is_manual", false)
        val wifiOnly = inputData.getBoolean("wifi_only", prefs.getBoolean("wifi_only", false))
        val chargingOnly = inputData.getBoolean("charging_only", prefs.getBoolean("charging_only", false))

        // Check Wi-Fi & Charging constraints directly at runtime
        if (!isManual) {
            if (wifiOnly && !com.drive.sync.network.SyncAlarmReceiver.isWifiConnected(applicationContext)) {
                SyncLogManager.log("⏸ Sync postponed: Wi-Fi connection required by settings.")
                return@withContext Result.retry()
            }
            if (chargingOnly && !com.drive.sync.network.SyncAlarmReceiver.isDeviceCharging(applicationContext)) {
                SyncLogManager.log("⏸ Sync postponed: Device charging required by settings.")
                return@withContext Result.retry()
            }
        }

        // Prevent rapid repeated background syncs (debounce 3 minutes)
        val lastSync = prefs.getLong("last_sync_timestamp", 0L)
        if (!isManual && System.currentTimeMillis() - lastSync < 3 * 60 * 1000L && runAttemptCount == 0) {
            Log.d("SyncWorker", "Debouncing background sync - device synced recently.")
            return@withContext Result.success()
        }

        SyncNotificationHelper.resetCancel()

        // Promote to Foreground Service for persistent Play Store-style background execution
        try {
            setForeground(
                SyncNotificationHelper.createForegroundInfo(
                    applicationContext,
                    title = "myDrive Live Backup ⚡",
                    message = "Scanning media on device...",
                    isIndeterminate = true
                )
            )
        } catch (e: Exception) {
            Log.w("SyncWorker", "Could not set foreground service: ${e.message}")
        }

        val syncType = if (isManual) "Manual sync" else "Auto-sync"
        SyncLogManager.log("── $syncType started ──")
        SyncLogManager.status("Scanning media for $syncType…")
        reportStatus(serverUrl, deviceId, deviceKey, "syncing", "$syncType started", "Worker triggered")

        // Retrieve connected storage account label
        var driveLabel = "Cloud Drive"
        try {
            val req = Request.Builder()
                .url("$serverUrl/api/v1/storage/summary")
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .build()
            val res = client.newCall(req).execute()
            if (res.isSuccessful) {
                val j = JSONObject(res.body?.string() ?: "{}")
                val accs = j.optJSONArray("accounts")
                if (accs != null && accs.length() > 0) {
                    val acc = accs.getJSONObject(0)
                    driveLabel = acc.optString("accountEmail", "").ifBlank {
                        acc.optString("providerType", "Google Drive")
                    }
                }
            }
            res.close()
        } catch (_: Exception) {}

        SyncLogManager.log("☁ Target: $driveLabel")

        try {
            var totalUploaded = 0
            var totalFailed = 0

            // 1. Sync Photos if enabled
            if (syncPhotos) {
                val res = syncCollection(
                    collectionUri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    serverUrl = serverUrl,
                    deviceId = deviceId,
                    deviceKey = deviceKey,
                    targetFolderId = targetFolderId,
                    defaultMime = "image/jpeg",
                    namePrefix = "photo",
                    driveLabel = driveLabel
                )
                totalUploaded += res.uploaded
                totalFailed += res.failed
            }

            // 2. Sync Videos if enabled
            if (syncVideos && !SyncNotificationHelper.isSyncCancelled() && !isStopped) {
                val res = syncCollection(
                    collectionUri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    serverUrl = serverUrl,
                    deviceId = deviceId,
                    deviceKey = deviceKey,
                    targetFolderId = targetFolderId,
                    defaultMime = "video/mp4",
                    namePrefix = "video",
                    driveLabel = driveLabel
                )
                totalUploaded += res.uploaded
                totalFailed += res.failed
            }

            // 3. Sync Documents if enabled
            if (syncDocuments && !SyncNotificationHelper.isSyncCancelled() && !isStopped) {
                val docSelection = "${MediaStore.MediaColumns.MIME_TYPE} LIKE ? OR ${MediaStore.MediaColumns.MIME_TYPE} LIKE ? OR ${MediaStore.MediaColumns.MIME_TYPE} LIKE ?"
                val docArgs = arrayOf("application/%", "text/%", "%document%")
                val res = syncCollection(
                    collectionUri = MediaStore.Files.getContentUri("external"),
                    serverUrl = serverUrl,
                    deviceId = deviceId,
                    deviceKey = deviceKey,
                    targetFolderId = targetFolderId,
                    defaultMime = "application/pdf",
                    namePrefix = "doc",
                    selection = docSelection,
                    selectionArgs = docArgs,
                    driveLabel = driveLabel
                )
                totalUploaded += res.uploaded
                totalFailed += res.failed
            }

            // 4. Inbound Sync according to Paired Device Policy
            var totalDownloaded = 0
            if (!SyncNotificationHelper.isSyncCancelled() && !isStopped) {
                totalDownloaded = performInboundSync(serverUrl, deviceId, deviceKey, prefs)
            }

            val isCancelled = SyncNotificationHelper.isSyncCancelled() || isStopped
            val prevTotal = prefs.getInt("total_synced_count", 0)
            val newTotal = prevTotal + totalUploaded
            val intervalHours = prefs.getInt("sync_interval_hours", 2).toLong()
            val nextSync = System.currentTimeMillis() + (intervalHours * 3600 * 1000L)
            val summary = when {
                isCancelled -> "Sync stopped: $totalUploaded uploaded, $totalDownloaded downloaded"
                totalFailed > 0 -> "Sync complete: $totalUploaded uploaded ($totalFailed failed), $totalDownloaded downloaded"
                else -> "Sync complete: $totalUploaded uploaded, $totalDownloaded downloaded"
            }

            prefs.edit().apply {
                putLong("last_sync_timestamp", System.currentTimeMillis())
                putLong("next_sync_timestamp", nextSync)
                putInt("last_sync_count", totalUploaded)
                putInt("total_synced_count", newTotal)
                putString("last_sync_status", summary)
                apply()
            }

            SyncLogManager.log("═══════════════════════════════")
            SyncLogManager.log(if (isCancelled) "⏸ $summary" else if (totalFailed > 0) "⚠ $summary" else "✅ $summary")
            SyncLogManager.status(summary)

            reportStatus(serverUrl, deviceId, deviceKey, "online", "Idle ($summary)", summary)

            if (isCancelled) {
                SyncNotificationHelper.showStopped(applicationContext)
            } else {
                SyncNotificationHelper.showCompletion(applicationContext, totalUploaded, totalFailed)
            }

            // Continuously re-arm the next exact background alarm
            com.drive.sync.network.SyncAlarmScheduler.scheduleNextAlarm(applicationContext)

            Result.success()
        } catch (e: Exception) {
            Log.e("SyncWorker", "Sync worker error: ${e.message}", e)
            val errorMsg = e.localizedMessage ?: e.message ?: "Network or sync error occurred"
            SyncLogManager.log("❌ Sync error: $errorMsg")
            SyncLogManager.status("Sync paused: $errorMsg")
            SyncNotificationHelper.showError(applicationContext, errorMsg)

            prefs.edit().apply {
                putLong("last_sync_timestamp", System.currentTimeMillis())
                putString("last_sync_status", "Sync notice: $errorMsg")
                apply()
            }
            reportStatus(serverUrl, deviceId, deviceKey, "online", "Idle (Error: $errorMsg)", "Sync notice: $errorMsg")

            if (runAttemptCount >= 1) Result.failure() else Result.retry()
        }
    }

    private fun getHistoryFile(category: String): java.io.File {
        return java.io.File(applicationContext.filesDir, "synced_${category.lowercase()}.txt")
    }

    private fun loadHistory(category: String): MutableSet<Long> {
        val file = getHistoryFile(category)
        if (!file.exists()) return mutableSetOf()
        return try {
            file.readLines().mapNotNull { it.trim().toLongOrNull() }.toMutableSet()
        } catch (e: Exception) {
            mutableSetOf()
        }
    }

    private fun appendHistory(category: String, id: Long) {
        try {
            getHistoryFile(category).appendText("$id\n")
        } catch (e: Exception) {
            Log.w("SyncWorker", "Failed to append history for $id: ${e.message}")
        }
    }

    private data class PendingSyncItem(
        val id: Long,
        val filename: String,
        val mimeType: String,
        val sizeBytes: Long
    )

    private data class SyncResult(
        val uploaded: Int = 0,
        val failed: Int = 0,
        val skipped: Int = 0
    )

    private fun syncCollection(
        collectionUri: Uri,
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        targetFolderId: String?,
        defaultMime: String,
        namePrefix: String,
        selection: String? = null,
        selectionArgs: Array<String>? = null,
        driveLabel: String? = null
    ): SyncResult {
        val category = when (namePrefix) {
            "photo" -> "photos"
            "video" -> "videos"
            else -> "documents"
        }
        val history = loadHistory(category)
        SyncNotificationHelper.showScanning(applicationContext, category)
        SyncLogManager.log("🔍 Scanning $category on device...")
        SyncLogManager.status("Scanning $category on device...")

        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE
        )

        val sortOrder = "${MediaStore.MediaColumns.DATE_ADDED} DESC"
        val cursor = try {
            applicationContext.contentResolver.query(
                collectionUri,
                projection,
                selection,
                selectionArgs,
                sortOrder
            )
        } catch (e: Exception) {
            SyncLogManager.log("✗ Failed querying $category: ${e.message}")
            return SyncResult()
        } ?: return SyncResult()

        val pendingItems = mutableListOf<PendingSyncItem>()
        var existingCount = 0
        cursor.use {
            val idColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val nameColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val mimeColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
            val sizeColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)

            while (it.moveToNext()) {
                val id = it.getLong(idColumn)
                if (id in history) {
                    existingCount++
                } else {
                    val filename = it.getString(nameColumn) ?: "${namePrefix}_$id"
                    val mimeType = it.getString(mimeColumn) ?: defaultMime
                    val sizeBytes = it.getLong(sizeColumn)
                    if (sizeBytes > 0) {
                        pendingItems.add(PendingSyncItem(id, filename, mimeType, sizeBytes))
                    }
                }
            }
        }

        val totalPending = pendingItems.size
        SyncLogManager.log("📂 $category: $totalPending new item(s) pending ($existingCount already in history)")

        if (totalPending == 0) return SyncResult(0, 0, existingCount)

        var uploadedCount = 0
        var failedCount = 0
        var skippedCount = 0

        for ((index, item) in pendingItems.withIndex()) {
            if (isStopped || SyncNotificationHelper.isSyncCancelled()) {
                SyncLogManager.log("⏸ Sync paused by user or system.")
                break
            }

            val num = index + 1
            val id = item.id
            val filename = item.filename
            val mimeType = item.mimeType
            val sizeBytes = item.sizeBytes
            val formattedSize = SyncLogManager.formatBytes(sizeBytes)
            val contentUri = ContentUris.withAppendedId(collectionUri, id)

            SyncNotificationHelper.showProgress(
                context = applicationContext,
                filename = filename,
                current = num,
                total = totalPending,
                sizeBytes = sizeBytes,
                driveLabel = driveLabel
            )
            SyncLogManager.status("⬆ Uploading $filename ($formattedSize) [$num/$totalPending] • ☁ $driveLabel")

            // Compute SHA-256 directly from stream for instant deduplication
            val contentHash = try {
                applicationContext.contentResolver.openInputStream(contentUri)?.use { stream ->
                    VaultCrypto.calculateSha256(stream)
                }
            } catch (e: Exception) {
                SyncLogManager.log("✗ $filename ($formattedSize) — read error: ${e.message}")
                failedCount++
                null
            } ?: continue

            // 1. Initiate Upload request with Backend
            val initJson = JSONObject().apply {
                put("filename", filename)
                put("mimeType", mimeType)
                put("sizeBytes", sizeBytes)
                put("contentHash", contentHash)
                if (!targetFolderId.isNullOrBlank()) {
                    put("folderId", targetFolderId)
                }
            }

            val initRequest = Request.Builder()
                .url("$serverUrl/api/v1/files/upload/initiate")
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .post(initJson.toString().toRequestBody("application/json".toMediaType()))
                .build()

            val initResponse = try {
                client.newCall(initRequest).execute()
            } catch (e: Exception) {
                SyncLogManager.log("✗ $filename ($formattedSize) — initiate network error: ${e.localizedMessage ?: e.message}")
                failedCount++
                continue
            }

            if (!initResponse.isSuccessful) {
                val errBody = try { initResponse.body?.string() ?: "" } catch (_: Exception) { "" }
                initResponse.close()
                SyncLogManager.log("✗ $filename ($formattedSize) — server initiate rejected (HTTP ${initResponse.code}): ${errBody.take(120)}")
                failedCount++
                continue
            }

            val initBody = try { initResponse.body?.string() ?: "{}" } catch (_: Exception) { "{}" }
            initResponse.close()
            val initResult = try { JSONObject(initBody) } catch (_: Exception) { JSONObject() }
            val isDuplicate = initResult.optBoolean("isDuplicate", false)

            if (isDuplicate) {
                appendHistory(category, id)
                history.add(id)
                skippedCount++
                SyncLogManager.log("⏩ $filename ($formattedSize) — already in cloud (duplicate)")
                continue
            }

            val uploadUrl = initResult.optString("uploadSessionUrl", "")
            val storageAccountId = initResult.optString("storageAccountId", "")
            val driveOpaqueName = initResult.optString("driveOpaqueName", "")

            if (uploadUrl.isBlank()) {
                val err = initResult.optString("error", "No upload URL provided by cloud")
                SyncLogManager.log("✗ $filename ($formattedSize) — upload URL missing: $err")
                failedCount++
                continue
            }

            // 2. Stream bytes directly to Google Drive Resumable Upload Session
            val streamingBody = object : RequestBody() {
                override fun contentType() = mimeType.toMediaType()
                override fun contentLength() = sizeBytes
                override fun writeTo(sink: BufferedSink) {
                    applicationContext.contentResolver.openInputStream(contentUri)?.use { stream ->
                        sink.writeAll(stream.source())
                    } ?: throw java.io.IOException("Cannot open input stream for $contentUri")
                }
            }

            val putRequest = Request.Builder()
                .url(uploadUrl)
                .put(streamingBody)
                .build()

            val putResponse = try {
                uploadClient.newCall(putRequest).execute()
            } catch (e: Exception) {
                SyncLogManager.log("✗ $filename ($formattedSize) — Google Drive streaming error: ${e.localizedMessage ?: e.message}")
                failedCount++
                continue
            }

            if (!putResponse.isSuccessful && putResponse.code != 200 && putResponse.code != 201) {
                val putBody = try { putResponse.body?.string() ?: "" } catch (_: Exception) { "" }
                putResponse.close()
                SyncLogManager.log("✗ $filename ($formattedSize) — Google Drive returned HTTP ${putResponse.code}: ${putBody.take(120)}")
                failedCount++
                continue
            }

            val putBody = try { putResponse.body?.string() ?: "" } catch (_: Exception) { "" }
            putResponse.close()
            var providerFileId = ""
            try {
                if (putBody.isNotBlank()) {
                    val putJson = JSONObject(putBody)
                    providerFileId = putJson.optString("id", "")
                }
            } catch (_: Exception) {}
            if (providerFileId.isBlank()) {
                providerFileId = driveOpaqueName
            }

            // 3. Extract video frame thumbnail locally if video
            var videoThumbBase64: String? = null
            val isVideo = mimeType.startsWith("video/") ||
                filename.lowercase().matches(Regex(".*\\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|3gp|ts)$"))
            if (isVideo) {
                try {
                    val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        applicationContext.contentResolver.loadThumbnail(contentUri, Size(320, 320), null)
                    } else {
                        val retriever = MediaMetadataRetriever()
                        retriever.setDataSource(applicationContext, contentUri)
                        val frame = retriever.getFrameAtTime(1000000)
                        retriever.release()
                        frame
                    }
                    if (bitmap != null) {
                        val out = ByteArrayOutputStream()
                        bitmap.compress(Bitmap.CompressFormat.JPEG, 75, out)
                        val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
                        videoThumbBase64 = "data:image/jpeg;base64,$b64"
                    }
                } catch (e: Exception) {
                    Log.w("SyncWorker", "Thumbnail generation error for $filename: ${e.message}")
                }
            }

            // 4. Finalize upload with backend
            val completeJson = JSONObject().apply {
                put("filename", filename)
                put("mimeType", mimeType)
                put("sizeBytes", sizeBytes)
                put("contentHash", contentHash)
                put("storageAccountId", storageAccountId)
                put("providerFileId", providerFileId)
                put("driveOpaqueName", driveOpaqueName)
                put("deviceAssetId", id.toString())
                if (!targetFolderId.isNullOrBlank()) {
                    put("folderId", targetFolderId)
                }
                if (!videoThumbBase64.isNullOrBlank()) {
                    put("thumbnail", videoThumbBase64)
                }
            }

            val completeRequest = Request.Builder()
                .url("$serverUrl/api/v1/files/upload/complete")
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .post(completeJson.toString().toRequestBody("application/json".toMediaType()))
                .build()

            val completeResponse = try {
                client.newCall(completeRequest).execute()
            } catch (e: Exception) {
                SyncLogManager.log("✗ $filename ($formattedSize) — finalize network error: ${e.localizedMessage ?: e.message}")
                failedCount++
                continue
            }

            if (!completeResponse.isSuccessful) {
                val compErr = try { completeResponse.body?.string() ?: "" } catch (_: Exception) { "" }
                completeResponse.close()
                SyncLogManager.log("✗ $filename ($formattedSize) — finalize error (HTTP ${completeResponse.code}): ${compErr.take(120)}")
                failedCount++
            } else {
                completeResponse.close()
                appendHistory(category, id)
                history.add(id)
                uploadedCount++
                SyncLogManager.log("✓ $filename ($formattedSize) → $driveLabel")
            }
        }

        SyncLogManager.log("── $category finished: $uploadedCount uploaded, $failedCount failed, $skippedCount skipped ──")
        return SyncResult(uploadedCount, failedCount, skippedCount)
    }

    private fun performInboundSync(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        prefs: android.content.SharedPreferences
    ): Int {
        var totalDownloaded = 0
        try {
            reportStatus(serverUrl, deviceId, deviceKey, "syncing", "Checking paired devices for incoming media...")
            val inReq = Request.Builder()
                .url("$serverUrl/api/v1/files/device/$deviceId/inbound-sync")
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .build()
            val inRes = client.newCall(inReq).execute()
            if (inRes.isSuccessful) {
                val inJson = JSONObject(inRes.body?.string() ?: "{}")
                val arr = inJson.optJSONArray("files")
                if (arr != null) {
                    val savedRulesJson = prefs.getString("paired_device_rules_json", null)
                    val autoDlDeviceIds = mutableSetOf<String>()
                    if (!savedRulesJson.isNullOrBlank()) {
                        try {
                            val rArr = org.json.JSONArray(savedRulesJson)
                            for (ri in 0 until rArr.length()) {
                                val rObj = rArr.getJSONObject(ri)
                                if (rObj.optBoolean("autoDownloadToGallery", false)) {
                                    autoDlDeviceIds.add(rObj.optString("sourceDeviceId"))
                                }
                            }
                        } catch (_: Exception) {}
                    }

                    for (i in 0 until arr.length()) {
                        if (isStopped || SyncNotificationHelper.isSyncCancelled()) break
                        val fObj = arr.getJSONObject(i)
                        val isDownloaded = fObj.optBoolean("isDownloadedLocally", false)
                        val isForce = fObj.optBoolean("isForceDownload", false)
                        val autoDl = fObj.optBoolean("autoDownloadToGallery", false) ||
                            autoDlDeviceIds.contains(fObj.optString("sourceDeviceId"))

                        if (!isDownloaded && (isForce || autoDl)) {
                            val fId = fObj.optString("_id")
                            val fName = fObj.optString("filename")
                            val fMime = fObj.optString("mimeType")
                            if (fId.isNotBlank() && fName.isNotBlank()) {
                                val isMedia = fMime.startsWith("image/") || fMime.startsWith("video/") ||
                                        fName.endsWith(".jpg", true) || fName.endsWith(".jpeg", true) ||
                                        fName.endsWith(".png", true) || fName.endsWith(".webp", true) ||
                                        fName.endsWith(".mp4", true) || fName.endsWith(".mov", true) ||
                                        fName.endsWith(".mkv", true)
                                val destLabel = if (isMedia) "Phone Gallery" else "phone storage"
                                SyncLogManager.log("⬇ Downloading $fName from paired device")
                                reportStatus(serverUrl, deviceId, deviceKey, "syncing", "Downloading $fName to $destLabel")
                                val ok = downloadInboundItemInternal(serverUrl, deviceId, deviceKey, fId, fName, fMime)
                                if (ok) {
                                    totalDownloaded++
                                    SyncLogManager.log("✓ $fName saved to $destLabel")
                                }
                            }
                        }
                    }
                }
            }
            inRes.close()
        } catch (e: Exception) {
            Log.w("SyncWorker", "Inbound sync error in worker: ${e.message}")
        }
        return totalDownloaded
    }

    private fun downloadInboundItemInternal(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        fileId: String,
        filename: String,
        mimeType: String
    ): Boolean {
        return try {
            val streamUrl = "$serverUrl/api/v1/files/$fileId/stream?deviceId=$deviceId&deviceKey=$deviceKey"
            val req = Request.Builder()
                .url(streamUrl)
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .build()
            val res = client.newCall(req).execute()
            if (!res.isSuccessful) {
                res.close()
                return false
            }
            val body = res.body ?: return false

            val isImage = mimeType.startsWith("image/") ||
                    filename.endsWith(".jpg", true) ||
                    filename.endsWith(".jpeg", true) ||
                    filename.endsWith(".png", true) ||
                    filename.endsWith(".webp", true) ||
                    filename.endsWith(".heic", true) ||
                    filename.endsWith(".gif", true) ||
                    filename.endsWith(".bmp", true)

            val isVideo = mimeType.startsWith("video/") ||
                    filename.endsWith(".mp4", true) ||
                    filename.endsWith(".mkv", true) ||
                    filename.endsWith(".mov", true) ||
                    filename.endsWith(".webm", true) ||
                    filename.endsWith(".3gp", true)

            val isMedia = isImage || isVideo

            val effectiveMime = when {
                mimeType.isNotBlank() && mimeType != "application/octet-stream" -> mimeType
                isVideo -> "video/mp4"
                isImage -> if (filename.endsWith(".png", true)) "image/png" else "image/jpeg"
                filename.endsWith(".pdf", true) -> "application/pdf"
                filename.endsWith(".zip", true) -> "application/zip"
                filename.endsWith(".txt", true) -> "text/plain"
                else -> "application/octet-stream"
            }

            val contentResolver = applicationContext.contentResolver
            var insertedUri: Uri? = null
            var localFilePath: String? = null

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val collection = when {
                    isVideo -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    isImage -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                }
                val relPath = when {
                    isVideo -> android.os.Environment.DIRECTORY_MOVIES + "/myDrive"
                    isImage -> android.os.Environment.DIRECTORY_PICTURES + "/myDrive"
                    else -> android.os.Environment.DIRECTORY_DOWNLOADS + "/myDrive"
                }

                val contentValues = android.content.ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                    put(MediaStore.MediaColumns.MIME_TYPE, effectiveMime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, relPath)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }

                insertedUri = contentResolver.insert(collection, contentValues)
                if (insertedUri == null) {
                    val dot = filename.lastIndexOf('.')
                    val safeName = if (dot != -1) {
                        "${filename.substring(0, dot)}_${System.currentTimeMillis()}${filename.substring(dot)}"
                    } else {
                        "${filename}_${System.currentTimeMillis()}"
                    }
                    contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                    insertedUri = contentResolver.insert(collection, contentValues)
                }

                if (insertedUri != null) {
                    contentResolver.openOutputStream(insertedUri)?.use { outStream ->
                        body.byteStream().use { inStream ->
                            inStream.copyTo(outStream)
                        }
                    }
                    val updateValues = android.content.ContentValues().apply {
                        put(MediaStore.MediaColumns.IS_PENDING, 0)
                    }
                    contentResolver.update(insertedUri, updateValues, null, null)

                    try {
                        contentResolver.query(insertedUri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use { cursor ->
                            if (cursor.moveToFirst()) {
                                val idx = cursor.getColumnIndexOrThrow(MediaStore.MediaColumns.DATA)
                                localFilePath = cursor.getString(idx)
                            }
                        }
                    } catch (_: Exception) {}
                }
            } else {
                // Pre-Q (API < 29)
                val baseDir = when {
                    isVideo -> android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_MOVIES)
                    isImage -> android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES)
                    else -> android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS)
                }
                val targetDir = java.io.File(baseDir, "myDrive")
                targetDir.mkdirs()
                var targetFile = java.io.File(targetDir, filename)
                if (targetFile.exists()) {
                    val dot = filename.lastIndexOf('.')
                    val safeName = if (dot != -1) {
                        "${filename.substring(0, dot)}_${System.currentTimeMillis()}${filename.substring(dot)}"
                    } else {
                        "${filename}_${System.currentTimeMillis()}"
                    }
                    targetFile = java.io.File(targetDir, safeName)
                }
                targetFile.outputStream().use { outStream ->
                    body.byteStream().use { inStream ->
                        inStream.copyTo(outStream)
                    }
                }
                localFilePath = targetFile.absolutePath
                insertedUri = Uri.fromFile(targetFile)
            }

            // Force native Gallery indexing via MediaScannerConnection and broadcast
            if (!localFilePath.isNullOrBlank()) {
                MediaScannerConnection.scanFile(
                    applicationContext,
                    arrayOf(localFilePath),
                    arrayOf(effectiveMime),
                    null
                )
            }
            if (insertedUri != null) {
                try {
                    val scanIntent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, insertedUri)
                    applicationContext.sendBroadcast(scanIntent)
                } catch (_: Exception) {}
            }

            // Record in history file so outbound sync never re-uploads
            val localId = insertedUri?.lastPathSegment?.toLongOrNull()
            if (localId != null) {
                val category = when {
                    isImage -> "photos"
                    isVideo -> "videos"
                    else -> "documents"
                }
                appendHistory(category, localId)
            }

            // Post download completion notification
            SyncNotificationHelper.showDownloadCompleteNotification(
                context = applicationContext,
                filename = filename,
                isMedia = isMedia,
                fileUri = insertedUri
            )

            // Mark synced with backend
            val markJson = JSONObject().apply {
                put("fileId", fileId)
                if (localId != null) put("deviceAssetId", localId.toString())
            }
            val markReq = Request.Builder()
                .url("$serverUrl/api/v1/files/device/$deviceId/mark-synced")
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .post(markJson.toString().toRequestBody("application/json".toMediaType()))
                .build()
            val markRes = client.newCall(markReq).execute()
            markRes.close()

            true
        } catch (e: Exception) {
            Log.w("SyncWorker", "Error downloading inbound item: ${e.message}")
            false
        }
    }
}
