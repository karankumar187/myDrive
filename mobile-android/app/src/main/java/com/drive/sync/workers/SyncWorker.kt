package com.drive.sync.workers

import android.content.ContentUris
import android.content.Context
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

    private val client = OkHttpClient()

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val serverUrl = inputData.getString("server_url") ?: "http://10.0.2.2:5000"
        val deviceId = inputData.getString("device_id") ?: return@withContext Result.failure()
        val deviceKey = inputData.getString("device_key") ?: return@withContext Result.failure()

        Log.d("SyncWorker", "Starting background media sync for device $deviceId")

        try {
            // 1. Query Android MediaStore for local images
            val projection = arrayOf(
                MediaStore.Images.Media._ID,
                MediaStore.Images.Media.DISPLAY_NAME,
                MediaStore.Images.Media.MIME_TYPE,
                MediaStore.Images.Media.SIZE
            )

            val sortOrder = "${MediaStore.Images.Media.DATE_ADDED} DESC"
            val cursor = applicationContext.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                projection,
                null,
                null,
                sortOrder
            )

            cursor?.use {
                val idColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media._ID)
                val nameColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.DISPLAY_NAME)
                val mimeColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.MIME_TYPE)
                val sizeColumn = it.getColumnIndexOrThrow(MediaStore.Images.Media.SIZE)

                var processedCount = 0

                while (it.moveToNext() && processedCount < 20) { // Batch 20 files per run
                    val id = it.getLong(idColumn)
                    val filename = it.getString(nameColumn) ?: "photo_$id.jpg"
                    val mimeType = it.getString(mimeColumn) ?: "image/jpeg"
                    val sizeBytes = it.getLong(sizeColumn)

                    if (sizeBytes <= 0) continue

                    val contentUri = ContentUris.withAppendedId(
                        MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                        id
                    )

                    // 2. Read bytes and compute raw SHA-256 for instant deduplication
                    val byteStream = applicationContext.contentResolver.openInputStream(contentUri) ?: continue
                    val bytes = byteStream.use { input ->
                        val buffer = ByteArrayOutputStream()
                        input.copyTo(buffer)
                        buffer.toByteArray()
                    }

                    val contentHash = VaultCrypto.calculateSha256(bytes.inputStream())

                    // 3. Initiate Upload request with Backend
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

                    // 4. Stream bytes directly to Google Drive Resumable Upload Session
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

                    // 5. Finalize upload with backend
                    val completeJson = JSONObject().apply {
                        put("filename", filename)
                        put("mimeType", mimeType)
                        put("sizeBytes", sizeBytes)
                        put("contentHash", contentHash)
                        put("storageAccountId", storageAccountId)
                        put("deviceAssetId", id.toString())
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

            Result.success()
        } catch (e: Exception) {
            Log.e("SyncWorker", "Sync worker error: ${e.message}", e)
            Result.retry()
        }
    }
}
