package com.drive.sync.workers

import android.content.ContentUris
import android.content.Context
import android.net.Uri
import android.provider.MediaStore
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.drive.sync.crypto.VaultCrypto
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.os.Build
import android.util.Base64
import android.util.Size
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.ByteArrayOutputStream

class SyncWorker(
    context: Context,
    params: WorkerParameters
) : CoroutineWorker(context, params) {

    private val client = com.drive.sync.sharedHttpClient

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
        val serverUrl = (inputData.getString("server_url") ?: "http://10.0.2.2:5000").trimEnd('/')
        val deviceId = inputData.getString("device_id") ?: return@withContext Result.failure()
        val deviceKey = inputData.getString("device_key") ?: return@withContext Result.failure()
        val syncVideos = inputData.getBoolean("sync_videos", true)
        val syncPhotos = inputData.getBoolean("sync_photos", true)
        val syncDocuments = inputData.getBoolean("sync_documents", true)

        val prefs = applicationContext.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val targetFolderId = inputData.getString("target_folder_id") ?: prefs.getString("target_folder_id", null)

        // Prevent rapid repeated syncs (debounce 3 minutes unless run attempt is a legitimate single retry)
        val lastSync = prefs.getLong("last_sync_timestamp", 0L)
        if (System.currentTimeMillis() - lastSync < 3 * 60 * 1000L && runAttemptCount == 0) {
            Log.d("SyncWorker", "Debouncing background sync - device synced recently.")
            return@withContext Result.success()
        }

        Log.d("SyncWorker", "Starting media sync for device $deviceId (photos=$syncPhotos, videos=$syncVideos, docs=$syncDocuments, targetFolderId=$targetFolderId)")
        reportStatus(serverUrl, deviceId, deviceKey, "syncing", "Background auto-sync started", "Worker triggered")

        try {
            // 1. Sync Photos if enabled
            val imageCount = if (syncPhotos) {
                reportStatus(serverUrl, deviceId, deviceKey, "syncing", "Scanning and backing up photos...")
                syncCollection(
                    collectionUri = MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    serverUrl = serverUrl,
                    deviceId = deviceId,
                    deviceKey = deviceKey,
                    targetFolderId = targetFolderId,
                    defaultMime = "image/jpeg",
                    namePrefix = "photo"
                )
            } else 0

            // 2. Sync Videos if enabled
            val videoCount = if (syncVideos) {
                reportStatus(serverUrl, deviceId, deviceKey, "syncing", "Scanning and backing up videos...")
                syncCollection(
                    collectionUri = MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    serverUrl = serverUrl,
                    deviceId = deviceId,
                    deviceKey = deviceKey,
                    targetFolderId = targetFolderId,
                    defaultMime = "video/mp4",
                    namePrefix = "video"
                )
            } else 0

            // 3. Sync Documents if enabled
            val docCount = if (syncDocuments) {
                reportStatus(serverUrl, deviceId, deviceKey, "syncing", "Scanning documents...")
                val docSelection = "${MediaStore.MediaColumns.MIME_TYPE} LIKE ? OR ${MediaStore.MediaColumns.MIME_TYPE} LIKE ? OR ${MediaStore.MediaColumns.MIME_TYPE} LIKE ?"
                val docArgs = arrayOf("application/%", "text/%", "%document%")
                syncCollection(
                    collectionUri = MediaStore.Files.getContentUri("external"),
                    serverUrl = serverUrl,
                    deviceId = deviceId,
                    deviceKey = deviceKey,
                    targetFolderId = targetFolderId,
                    defaultMime = "application/pdf",
                    namePrefix = "doc",
                    selection = docSelection,
                    selectionArgs = docArgs
                )
            } else 0

            val totalSynced = imageCount + videoCount + docCount
            Log.d("SyncWorker", "Outbound sync complete: $imageCount images, $videoCount videos, $docCount documents processed.")

            // 4. Inbound Sync according to Paired Device Policy
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
                        // Check local paired device rules to confirm autoDownloadToGallery
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
                                    reportStatus(serverUrl, deviceId, deviceKey, "syncing", "Downloading $fName to phone storage")
                                    val ok = downloadInboundItemInternal(serverUrl, deviceId, deviceKey, fId, fName, fMime)
                                    if (ok) totalDownloaded++
                                }
                            }
                        }
                    }
                }
            } catch (e: Exception) {
                Log.w("SyncWorker", "Inbound sync error in worker: ${e.message}")
            }

            val prevTotal = prefs.getInt("total_synced_count", 0)
            val newTotal = prevTotal + totalSynced
            val intervalHours = prefs.getInt("sync_interval_hours", 2).toLong()
            val nextSync = System.currentTimeMillis() + (intervalHours * 3600 * 1000L)
            val summary = "Auto-sync complete: $totalSynced uploaded, $totalDownloaded downloaded"

            prefs.edit().apply {
                putLong("last_sync_timestamp", System.currentTimeMillis())
                putLong("next_sync_timestamp", nextSync)
                putInt("last_sync_count", totalSynced)
                putInt("total_synced_count", newTotal)
                putString("last_sync_status", summary)
                apply()
            }

            reportStatus(serverUrl, deviceId, deviceKey, "online", "Idle ($summary)", summary)
            Result.success()
        } catch (e: Exception) {
            Log.e("SyncWorker", "Sync worker error: ${e.message}", e)
            val prefs = applicationContext.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
            prefs.edit().apply {
                putLong("last_sync_timestamp", System.currentTimeMillis())
                putString("last_sync_status", "Sync notice: ${e.localizedMessage ?: "Network error"}")
                apply()
            }
            reportStatus(serverUrl, deviceId, deviceKey, "online", "Idle (Error: ${e.localizedMessage})", "Sync notice: ${e.message}")
            if (runAttemptCount >= 1) {
                Result.failure()
            } else {
                Result.retry()
            }
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

    private fun syncCollection(
        collectionUri: Uri,
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        targetFolderId: String?,
        defaultMime: String,
        namePrefix: String,
        selection: String? = null,
        selectionArgs: Array<String>? = null
    ): Int {
        val category = when (namePrefix) {
            "photo" -> "photos"
            "video" -> "videos"
            else -> "documents"
        }
        val history = loadHistory(category)

        val projection = arrayOf(
            MediaStore.MediaColumns._ID,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.SIZE
        )

        val sortOrder = "${MediaStore.MediaColumns.DATE_ADDED} DESC"
        val cursor = applicationContext.contentResolver.query(
            collectionUri,
            projection,
            selection,
            selectionArgs,
            sortOrder
        ) ?: return 0

        var processedCount = 0

        cursor.use {
            val idColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns._ID)
            val nameColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.DISPLAY_NAME)
            val mimeColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.MIME_TYPE)
            val sizeColumn = it.getColumnIndexOrThrow(MediaStore.MediaColumns.SIZE)

            while (it.moveToNext()) {
                val id = it.getLong(idColumn)
                if (id in history) {
                    continue
                }

                val filename = it.getString(nameColumn) ?: "${namePrefix}_$id"
                val mimeType = it.getString(mimeColumn) ?: defaultMime
                val sizeBytes = it.getLong(sizeColumn)

                if (sizeBytes <= 0) continue

                val contentUri = ContentUris.withAppendedId(collectionUri, id)

                // Read bytes & compute SHA-256 for instant deduplication
                val byteStream = applicationContext.contentResolver.openInputStream(contentUri) ?: continue
                val bytes = byteStream.use { input ->
                    val buffer = ByteArrayOutputStream()
                    input.copyTo(buffer)
                    buffer.toByteArray()
                }

                val contentHash = VaultCrypto.calculateSha256(bytes.inputStream())

                // 1. Initiate Upload request with Backend
                val initJson = JSONObject().apply {
                    put("filename", filename)
                    put("mimeType", mimeType)
                    put("sizeBytes", sizeBytes)
                    put("contentHash", contentHash)
                }

                val initRequest = Request.Builder()
                    .url("$serverUrl/api/v1/files/upload/initiate")
                    .addHeader("x-device-id", deviceId)
                    .addHeader("x-device-key", deviceKey)
                    .post(initJson.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                val initResponse = client.newCall(initRequest).execute()
                if (!initResponse.isSuccessful) {
                    Log.w("SyncWorker", "Failed initiate for $filename: ${initResponse.code}")
                    continue
                }

                val initResult = JSONObject(initResponse.body?.string() ?: "{}")
                val isDuplicate = initResult.optBoolean("isDuplicate", false)

                if (isDuplicate) {
                    Log.d("SyncWorker", "Exact duplicate detected for $filename. Upload skipped!")
                    appendHistory(category, id)
                    history.add(id)
                    processedCount++
                    continue
                }

                // 2. Stream bytes directly to Google Drive Resumable Upload Session
                val uploadUrl = initResult.getString("uploadSessionUrl")
                val storageAccountId = initResult.getString("storageAccountId")
                val driveOpaqueName = initResult.optString("driveOpaqueName", "")

                val putRequest = Request.Builder()
                    .url(uploadUrl)
                    .put(bytes.toRequestBody(mimeType.toMediaType()))
                    .build()

                val putResponse = client.newCall(putRequest).execute()
                if (!putResponse.isSuccessful && putResponse.code != 200 && putResponse.code != 201) {
                    Log.w("SyncWorker", "Google Drive stream failed for $filename: ${putResponse.code}")
                    putResponse.close()
                    continue
                }

                val putBody = putResponse.body?.string() ?: ""
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

                // Extract video frame thumbnail locally if video
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
                        Log.w("SyncWorker", "Could not generate local video thumbnail for $filename: ${e.message}")
                    }
                }

                // 3. Finalize upload with backend
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

                client.newCall(completeRequest).execute().close()
                Log.d("SyncWorker", "Successfully backed up $filename to pooled storage (ID: $providerFileId)")
                appendHistory(category, id)
                history.add(id)
                processedCount++
            }
        }

        return processedCount
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

            val isImage = mimeType.startsWith("image/")
            val isVideo = mimeType.startsWith("video/")
            val isMedia = isImage || isVideo

            val contentResolver = applicationContext.contentResolver
            var insertedUri: Uri? = null

            if (isMedia) {
                val contentValues = android.content.ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                    put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                        put(
                            MediaStore.MediaColumns.RELATIVE_PATH,
                            if (isVideo) android.os.Environment.DIRECTORY_MOVIES + "/myDrive" else android.os.Environment.DIRECTORY_PICTURES + "/myDrive"
                        )
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                }
                val collection = if (isVideo) {
                    MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                } else {
                    MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                }
                insertedUri = contentResolver.insert(collection, contentValues)
            } else {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val contentValues = android.content.ContentValues().apply {
                        put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
                        put(MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/myDrive")
                        put(MediaStore.MediaColumns.IS_PENDING, 1)
                    }
                    insertedUri = contentResolver.insert(MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY), contentValues)
                } else {
                    val downloadsDir = java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS), "myDrive")
                    downloadsDir.mkdirs()
                    val targetFile = java.io.File(downloadsDir, filename)
                    targetFile.outputStream().use { outStream ->
                        body.byteStream().use { inStream ->
                            inStream.copyTo(outStream)
                        }
                    }
                }
            }

            if (insertedUri != null) {
                contentResolver.openOutputStream(insertedUri)?.use { outStream ->
                    body.byteStream().use { inStream ->
                        inStream.copyTo(outStream)
                    }
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    val updateValues = android.content.ContentValues().apply {
                        put(MediaStore.MediaColumns.IS_PENDING, 0)
                    }
                    contentResolver.update(insertedUri, updateValues, null, null)
                }
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
