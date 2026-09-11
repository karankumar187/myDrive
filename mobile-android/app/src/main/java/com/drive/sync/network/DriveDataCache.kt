package com.drive.sync.network

import android.content.Context
import com.drive.sync.CloudFile
import com.drive.sync.CloudFolder
import com.drive.sync.CloudMedia
import com.drive.sync.DeviceUploadItem
import com.drive.sync.InboundSyncItem
import com.drive.sync.PairedDevice
import com.drive.sync.StoragePoolSummary
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * DriveDataCache: High-performance memory and disk cache.
 * Provides offline-first instant loading (0ms) on cold start and when returning
 * from background, completely eliminating empty "No photos or videos yet" screens
 * and "Connecting to Drive..." reloading flashes.
 */
object DriveDataCache {

    @Volatile
    var storageSummary: StoragePoolSummary? = null

    @Volatile
    var filesList: List<CloudFile> = emptyList()

    @Volatile
    var galleryList: List<CloudMedia> = emptyList()

    @Volatile
    var foldersList: List<CloudFolder> = emptyList()

    @Volatile
    var uploadedFilesList: List<DeviceUploadItem> = emptyList()

    @Volatile
    var inboundSyncList: List<InboundSyncItem> = emptyList()

    @Volatile
    var pairedDevicesList: List<PairedDevice> = emptyList()

    private var isInitialized = false

    fun hasData(): Boolean {
        return galleryList.isNotEmpty() || filesList.isNotEmpty() || foldersList.isNotEmpty()
    }

    /**
     * Initializes cache synchronously from local disk so data is immediately available
     * on the very first frame of UI rendering.
     */
    fun init(context: Context) {
        if (isInitialized) return
        synchronized(this) {
            if (isInitialized) return
            try {
                val file = File(context.filesDir, "drive_data_cache.json")
                if (file.exists()) {
                    val content = file.readText()
                    if (content.isNotBlank()) {
                        parseDiskCache(JSONObject(content))
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            } finally {
                isInitialized = true
            }
        }
    }

    fun updateCache(
        context: Context,
        summary: StoragePoolSummary? = null,
        files: List<CloudFile>? = null,
        gallery: List<CloudMedia>? = null,
        folders: List<CloudFolder>? = null,
        uploads: List<DeviceUploadItem>? = null,
        inbound: List<InboundSyncItem>? = null,
        pairedDevices: List<PairedDevice>? = null
    ) {
        if (summary != null) storageSummary = summary
        if (files != null && (files.isNotEmpty() || filesList.isEmpty())) filesList = files
        if (gallery != null && (gallery.isNotEmpty() || galleryList.isEmpty())) galleryList = gallery
        if (folders != null && (folders.isNotEmpty() || foldersList.isEmpty())) foldersList = folders
        if (uploads != null) uploadedFilesList = uploads
        if (inbound != null) inboundSyncList = inbound
        if (pairedDevices != null) pairedDevicesList = pairedDevices

        // Persist to disk asynchronously
        CoroutineScope(Dispatchers.IO).launch {
            try {
                persistToDisk(context)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun persistToDisk(context: Context) {
        val root = JSONObject()

        // Storage Summary
        storageSummary?.let { s ->
            root.put("summary", JSONObject().apply {
                put("totalCapacityBytes", s.totalCapacityBytes)
                put("totalUsedBytes", s.totalUsedBytes)
                put("connectedAccountsCount", s.connectedAccountsCount)
                put("usagePercentage", s.usagePercentage)
            })
        }

        // Gallery Media
        val gArr = JSONArray()
        galleryList.take(500).forEach { m ->
            gArr.put(JSONObject().apply {
                put("id", m.id)
                put("filename", m.filename)
                put("mimeType", m.mimeType)
                put("sizeBytes", m.sizeBytes)
                put("takenAt", m.takenAt ?: "")
                put("isFavorite", m.isFavorite)
                put("width", m.width ?: -1)
                put("height", m.height ?: -1)
                put("duration", m.duration ?: -1.0)
                put("thumbnail", m.thumbnail ?: "")
                put("cameraMake", m.cameraMake ?: "")
                put("cameraModel", m.cameraModel ?: "")
                put("latitude", m.latitude ?: -999.0)
                put("longitude", m.longitude ?: -999.0)
                put("sourceDeviceName", m.sourceDeviceName ?: "")
                put("sourceDeviceId", m.sourceDeviceId ?: "")
                put("folderName", m.folderName ?: "")
                put("storageAccountName", m.storageAccountName ?: "")
                put("isCloudOnly", m.isCloudOnly)
                put("status", m.status)
            })
        }
        root.put("gallery", gArr)

        // Files
        val fArr = JSONArray()
        filesList.take(500).forEach { f ->
            fArr.put(JSONObject().apply {
                put("id", f.id)
                put("filename", f.filename)
                put("mimeType", f.mimeType)
                put("sizeBytes", f.sizeBytes)
                put("createdAt", f.createdAt)
                put("folderId", f.folderId ?: "")
                put("takenAt", f.takenAt ?: "")
            })
        }
        root.put("files", fArr)

        // Folders
        val foArr = JSONArray()
        foldersList.forEach { fo ->
            foArr.put(JSONObject().apply {
                put("id", fo.id)
                put("name", fo.name)
                put("path", fo.path)
                put("parentFolderId", fo.parentFolderId ?: "")
            })
        }
        root.put("folders", foArr)

        val file = File(context.filesDir, "drive_data_cache.json")
        file.writeText(root.toString())
    }

    private fun parseDiskCache(root: JSONObject) {
        // Storage Summary
        val sObj = root.optJSONObject("summary")
        if (sObj != null) {
            storageSummary = StoragePoolSummary(
                totalCapacityBytes = sObj.optLong("totalCapacityBytes", 64424509440L),
                totalUsedBytes = sObj.optLong("totalUsedBytes", 0L),
                connectedAccountsCount = sObj.optInt("connectedAccountsCount", 0),
                usagePercentage = sObj.optDouble("usagePercentage", 0.0)
            )
        }

        // Gallery
        val gArr = root.optJSONArray("gallery")
        if (gArr != null && gArr.length() > 0) {
            val list = mutableListOf<CloudMedia>()
            for (i in 0 until gArr.length()) {
                val o = gArr.getJSONObject(i)
                list.add(
                    CloudMedia(
                        id = o.optString("id"),
                        filename = o.optString("filename"),
                        mimeType = o.optString("mimeType"),
                        sizeBytes = o.optLong("sizeBytes"),
                        takenAt = o.optString("takenAt").ifBlank { null },
                        isFavorite = o.optBoolean("isFavorite", false),
                        width = o.optInt("width", -1).let { if (it >= 0) it else null },
                        height = o.optInt("height", -1).let { if (it >= 0) it else null },
                        duration = o.optDouble("duration", -1.0).let { if (it >= 0) it else null },
                        thumbnail = o.optString("thumbnail").ifBlank { null },
                        cameraMake = o.optString("cameraMake").ifBlank { null },
                        cameraModel = o.optString("cameraModel").ifBlank { null },
                        latitude = o.optDouble("latitude", -999.0).let { if (it != -999.0) it else null },
                        longitude = o.optDouble("longitude", -999.0).let { if (it != -999.0) it else null },
                        sourceDeviceName = o.optString("sourceDeviceName").ifBlank { null },
                        sourceDeviceId = o.optString("sourceDeviceId").ifBlank { null },
                        folderName = o.optString("folderName").ifBlank { null },
                        storageAccountName = o.optString("storageAccountName").ifBlank { null },
                        isCloudOnly = o.optBoolean("isCloudOnly", true),
                        status = o.optString("status", "✓ Safely backed up")
                    )
                )
            }
            galleryList = list
        }

        // Files
        val fArr = root.optJSONArray("files")
        if (fArr != null && fArr.length() > 0) {
            val list = mutableListOf<CloudFile>()
            for (i in 0 until fArr.length()) {
                val o = fArr.getJSONObject(i)
                list.add(
                    CloudFile(
                        id = o.optString("id"),
                        filename = o.optString("filename"),
                        mimeType = o.optString("mimeType"),
                        sizeBytes = o.optLong("sizeBytes"),
                        createdAt = o.optString("createdAt"),
                        folderId = o.optString("folderId").ifBlank { null },
                        takenAt = o.optString("takenAt").ifBlank { null }
                    )
                )
            }
            filesList = list
        }

        // Folders
        val foArr = root.optJSONArray("folders")
        if (foArr != null && foArr.length() > 0) {
            val list = mutableListOf<CloudFolder>()
            for (i in 0 until foArr.length()) {
                val o = foArr.getJSONObject(i)
                list.add(
                    CloudFolder(
                        id = o.optString("id"),
                        name = o.optString("name"),
                        path = o.optString("path", ""),
                        parentFolderId = o.optString("parentFolderId").ifBlank { null }
                    )
                )
            }
            foldersList = list
        }
    }
}
