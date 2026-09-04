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

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val serverUrl = (inputData.getString("server_url") ?: "http://10.0.2.2:5000").trimEnd('/')
        val deviceId = inputData.getString("device_id") ?: return@withContext Result.failure()
        val deviceKey = inputData.getString("device_key") ?: return@withContext Result.failure()
        val syncVideos = inputData.getBoolean("sync_videos", true)
        val syncPhotos = inputData.getBoolean("sync_photos", true)
        val syncDocuments = inputData.getBoolean("sync_documents", true)

        val prefs = applicationContext.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val targetFolderId = inputData.getString("target_folder_id") ?: prefs.getString("target_folder_id", null)

        Log.d("SyncWorker", "Starting media sync for device $deviceId (photos=$syncPhotos, videos=$syncVideos, docs=$syncDocuments, targetFolderId=$targetFolderId)")

        try {
            // 1. Sync Photos if enabled
            val imageCount = if (syncPhotos) {
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
            Log.d("SyncWorker", "Sync complete: $imageCount images, $videoCount videos, $docCount documents processed.")

            val prevTotal = prefs.getInt("total_synced_count", 0)
            val newTotal = prevTotal + totalSynced
            prefs.edit().apply {
                putLong("last_sync_timestamp", System.currentTimeMillis())
                putInt("last_sync_count", totalSynced)
                putInt("total_synced_count", newTotal)
                putString("last_sync_status", "Synced $imageCount photos, $videoCount videos, $docCount docs")
                apply()
            }

            Result.success()
        } catch (e: Exception) {
            Log.e("SyncWorker", "Sync worker error: ${e.message}", e)
            val prefs = applicationContext.getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
            prefs.edit().apply {
                putLong("last_sync_timestamp", System.currentTimeMillis())
                putString("last_sync_status", "Sync notice: ${e.localizedMessage ?: "Network error"}")
                apply()
            }
            Result.retry()
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

            while (it.moveToNext() && processedCount < 100) {
                val id = it.getLong(idColumn)
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
                    processedCount++
                    continue
                }

                // 2. Stream bytes directly to Google Drive Resumable Upload Session
                val uploadUrl = initResult.getString("uploadSessionUrl")
                val storageAccountId = initResult.getString("storageAccountId")

                val putRequest = Request.Builder()
                    .url(uploadUrl)
                    .put(bytes.toRequestBody(mimeType.toMediaType()))
                    .build()

                val putResponse = client.newCall(putRequest).execute()
                if (!putResponse.isSuccessful && putResponse.code != 200 && putResponse.code != 201) {
                    Log.w("SyncWorker", "Google Drive stream failed for $filename: ${putResponse.code}")
                    continue
                }

                // 3. Finalize upload with backend
                val completeJson = JSONObject().apply {
                    put("filename", filename)
                    put("mimeType", mimeType)
                    put("sizeBytes", sizeBytes)
                    put("contentHash", contentHash)
                    put("storageAccountId", storageAccountId)
                    put("deviceAssetId", id.toString())
                    if (!targetFolderId.isNullOrBlank()) {
                        put("folderId", targetFolderId)
                    }
                }

                val completeRequest = Request.Builder()
                    .url("$serverUrl/api/v1/files/upload/complete")
                    .addHeader("x-device-id", deviceId)
                    .addHeader("x-device-key", deviceKey)
                    .post(completeJson.toString().toRequestBody("application/json".toMediaType()))
                    .build()

                client.newCall(completeRequest).execute()
                Log.d("SyncWorker", "Successfully backed up $filename to pooled storage")
                processedCount++
            }
        }

        return processedCount
    }
}
