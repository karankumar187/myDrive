package com.drive.sync

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.work.*
import coil.compose.AsyncImage
import coil.request.ImageRequest
import com.drive.sync.workers.SyncWorker
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

data class StoragePoolSummary(
    val totalCapacityBytes: Long,
    val totalUsedBytes: Long,
    val connectedAccountsCount: Int,
    val usagePercentage: Double
)

data class CloudFile(
    val id: String,
    val filename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val createdAt: String,
    val folderId: String? = null
)

data class CloudMedia(
    val id: String,
    val filename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val takenAt: String?
)

data class CloudFolder(
    val id: String,
    val name: String,
    val path: String = ""
)

class MainActivity : ComponentActivity() {

    private val httpClient = OkHttpClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFF9333EA),
                    secondary = Color(0xFFA855F7),
                    background = Color(0xFF0D0D11),
                    surface = Color(0xFF13131A),
                    surfaceVariant = Color(0xFF1E1E28),
                    onBackground = Color(0xFFF3F4F6),
                    onSurface = Color(0xFFF3F4F6)
                )
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainAppScreen(
                        prefs = prefs,
                        onScheduleSync = { serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncVideos ->
                            scheduleBackupWork(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncVideos)
                            Toast.makeText(this, "Periodic background backup scheduled!", Toast.LENGTH_SHORT).show()
                        },
                        onSyncNow = { serverUrl, deviceId, deviceKey, targetFolderId, syncVideos ->
                            triggerImmediateSync(serverUrl, deviceId, deviceKey, targetFolderId, syncVideos)
                            Toast.makeText(this, "Scanning media for cloud backup...", Toast.LENGTH_SHORT).show()
                        },
                        httpClient = httpClient
                    )
                }
            }
        }
    }

    private fun scheduleBackupWork(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        targetFolderId: String?,
        wifiOnly: Boolean,
        chargingOnly: Boolean,
        syncVideos: Boolean
    ) {
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

        val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .setInputData(
                workDataOf(
                    "server_url" to serverUrl,
                    "device_id" to deviceId,
                    "device_key" to deviceKey,
                    "target_folder_id" to (targetFolderId ?: ""),
                    "sync_videos" to syncVideos
                )
            )
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            "UnifiedDriveSync",
            ExistingPeriodicWorkPolicy.UPDATE,
            syncRequest
        )
    }

    private fun triggerImmediateSync(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        targetFolderId: String?,
        syncVideos: Boolean
    ) {
        val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInputData(
                workDataOf(
                    "server_url" to serverUrl,
                    "device_id" to deviceId,
                    "device_key" to deviceKey,
                    "target_folder_id" to (targetFolderId ?: ""),
                    "sync_videos" to syncVideos
                )
            )
            .build()

        WorkManager.getInstance(applicationContext).enqueue(syncRequest)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainAppScreen(
    prefs: android.content.SharedPreferences,
    onScheduleSync: (String, String, String, String?, Boolean, Boolean, Boolean) -> Unit,
    onSyncNow: (String, String, String, String?, Boolean) -> Unit,
    httpClient: OkHttpClient
) {
    val context = LocalContext.current
    var selectedTab by remember { mutableIntStateOf(0) }

    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", "https://mydrive-sti3.onrender.com") ?: "https://mydrive-sti3.onrender.com") }
    var deviceId by remember { mutableStateOf(prefs.getString("device_id", "") ?: "") }
    var deviceKey by remember { mutableStateOf(prefs.getString("device_key", "") ?: "") }
    var targetFolderId by remember { mutableStateOf(prefs.getString("target_folder_id", "") ?: "") }
    var targetFolderName by remember { mutableStateOf(prefs.getString("target_folder_name", "Root (My Drive)") ?: "Root (My Drive)") }
    var wifiOnly by remember { mutableStateOf(prefs.getBoolean("wifi_only", false)) }
    var chargingOnly by remember { mutableStateOf(prefs.getBoolean("charging_only", false)) }
    var syncVideos by remember { mutableStateOf(prefs.getBoolean("sync_videos", true)) }

    // Live sync stats
    var lastSyncTimestamp by remember { mutableLongStateOf(prefs.getLong("last_sync_timestamp", 0L)) }
    var totalSyncedCount by remember { mutableIntStateOf(prefs.getInt("total_synced_count", 0)) }
    var lastSyncStatus by remember { mutableStateOf(prefs.getString("last_sync_status", "Never synced") ?: "Never synced") }

    // Cloud Data States
    var storageSummary by remember { mutableStateOf<StoragePoolSummary?>(null) }
    var filesList by remember { mutableStateOf<List<CloudFile>>(emptyList()) }
    var galleryList by remember { mutableStateOf<List<CloudMedia>>(emptyList()) }
    var foldersList by remember { mutableStateOf<List<CloudFolder>>(emptyList()) }
    var selectedFilterFolderId by remember { mutableStateOf<String?>(null) }

    var isRefreshing by remember { mutableStateOf(false) }
    var fetchError by remember { mutableStateOf<String?>(null) }

    // Dialog States
    var showFolderDialog by remember { mutableStateOf(false) }
    var previewItem by remember { mutableStateOf<CloudFile?>(null) }

    val scope = rememberCoroutineScope()

    val saveCredentials = {
        prefs.edit().apply {
            putString("server_url", serverUrl)
            putString("device_id", deviceId)
            putString("device_key", deviceKey)
            putString("target_folder_id", targetFolderId)
            putString("target_folder_name", targetFolderName)
            putBoolean("wifi_only", wifiOnly)
            putBoolean("charging_only", chargingOnly)
            putBoolean("sync_videos", syncVideos)
            apply()
        }
    }

    val refreshData: () -> Unit = {
        if (serverUrl.isNotBlank() && deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            scope.launch {
                isRefreshing = true
                fetchError = null
                try {
                    val baseUrl = serverUrl.trimEnd('/')

                    withContext(Dispatchers.IO) {
                        // 1. Fetch Storage Pool Summary
                        try {
                            val req = Request.Builder()
                                .url("$baseUrl/api/v1/storage/summary")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .build()
                            val res = httpClient.newCall(req).execute()
                            if (res.isSuccessful) {
                                val json = JSONObject(res.body?.string() ?: "{}")
                                val totalCap = json.optLong("totalCapacityBytes", 64424509440L)
                                val usedCap = if (json.has("usedCapacityBytes")) json.optLong("usedCapacityBytes", 0L) else json.optLong("totalUsedBytes", 0L)
                                val totalAcc = if (json.has("totalAccounts")) json.optInt("totalAccounts", 0) else json.optInt("connectedAccountsCount", 0)
                                val pctUsed = if (json.has("percentUsed")) json.optDouble("percentUsed", 0.0) else json.optDouble("usagePercentage", 0.0)

                                storageSummary = StoragePoolSummary(
                                    totalCapacityBytes = totalCap,
                                    totalUsedBytes = usedCap,
                                    connectedAccountsCount = totalAcc,
                                    usagePercentage = pctUsed
                                )
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }

                        // 2. Fetch Files (fetch all library files, fallback to recentFiles)
                        try {
                            val req = Request.Builder()
                                .url("$baseUrl/api/v1/files?all=true")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .build()
                            val res = httpClient.newCall(req).execute()
                            if (res.isSuccessful) {
                                val json = JSONObject(res.body?.string() ?: "{}")
                                var array = json.optJSONArray("files")
                                if ((array == null || array.length() == 0) && json.has("recentFiles")) {
                                    array = json.optJSONArray("recentFiles")
                                }
                                val list = mutableListOf<CloudFile>()
                                if (array != null) {
                                    for (i in 0 until array.length()) {
                                        val item = array.getJSONObject(i)
                                        list.add(
                                            CloudFile(
                                                id = item.optString("_id"),
                                                filename = item.optString("filename"),
                                                mimeType = item.optString("mimeType"),
                                                sizeBytes = item.optLong("sizeBytes"),
                                                createdAt = item.optString("createdAt"),
                                                folderId = item.optString("folderId", "")
                                            )
                                        )
                                    }
                                }
                                filesList = list
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }

                        // 3. Fetch Gallery Media
                        try {
                            val req = Request.Builder()
                                .url("$baseUrl/api/v1/files/gallery")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .build()
                            val res = httpClient.newCall(req).execute()
                            if (res.isSuccessful) {
                                val json = JSONObject(res.body?.string() ?: "{}")
                                val array = json.optJSONArray("media")
                                val list = mutableListOf<CloudMedia>()
                                if (array != null) {
                                    for (i in 0 until array.length()) {
                                        val item = array.getJSONObject(i)
                                        list.add(
                                            CloudMedia(
                                                id = item.optString("_id"),
                                                filename = item.optString("filename"),
                                                mimeType = item.optString("mimeType"),
                                                sizeBytes = item.optLong("sizeBytes"),
                                                takenAt = item.optString("createdAt")
                                            )
                                        )
                                    }
                                }
                                galleryList = list
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }

                        // 4. Fetch Folders
                        try {
                            val req = Request.Builder()
                                .url("$baseUrl/api/v1/files/folders/list")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .build()
                            val res = httpClient.newCall(req).execute()
                            if (res.isSuccessful) {
                                val json = JSONObject(res.body?.string() ?: "{}")
                                val array = json.optJSONArray("folders")
                                val list = mutableListOf<CloudFolder>()
                                if (array != null) {
                                    for (i in 0 until array.length()) {
                                        val item = array.getJSONObject(i)
                                        list.add(
                                            CloudFolder(
                                                id = item.optString("_id"),
                                                name = item.optString("name"),
                                                path = item.optString("path", "")
                                            )
                                        )
                                    }
                                }
                                foldersList = list
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }

                    // Reload sync preferences
                    lastSyncTimestamp = prefs.getLong("last_sync_timestamp", 0L)
                    totalSyncedCount = prefs.getInt("total_synced_count", 0)
                    lastSyncStatus = prefs.getString("last_sync_status", "Up to date") ?: "Up to date"
                } catch (e: Exception) {
                    fetchError = e.localizedMessage ?: "Failed to connect to backend"
                } finally {
                    isRefreshing = false
                }
            }
        }
    }

    val createFolderAction: (String) -> Unit = { folderName ->
        if (folderName.isNotBlank() && serverUrl.isNotBlank() && deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            scope.launch(Dispatchers.IO) {
                try {
                    val baseUrl = serverUrl.trimEnd('/')
                    val body = JSONObject().apply {
                        put("name", folderName.trim())
                    }
                    val req = Request.Builder()
                        .url("$baseUrl/api/v1/files/folders/create")
                        .addHeader("x-device-id", deviceId)
                        .addHeader("x-device-key", deviceKey)
                        .post(body.toString().toRequestBody("application/json".toMediaType()))
                        .build()
                    val res = httpClient.newCall(req).execute()
                    if (res.isSuccessful) {
                        val json = JSONObject(res.body?.string() ?: "{}")
                        val folderObj = json.optJSONObject("folder")
                        if (folderObj != null) {
                            val newId = folderObj.optString("_id")
                            val newName = folderObj.optString("name")
                            withContext(Dispatchers.Main) {
                                targetFolderId = newId
                                targetFolderName = newName
                                saveCredentials()
                                Toast.makeText(context, "Folder '$newName' created & selected as destination!", Toast.LENGTH_SHORT).show()
                                showFolderDialog = false
                            }
                        }
                        refreshData()
                    } else {
                        withContext(Dispatchers.Main) {
                            Toast.makeText(context, "Folder creation failed (${res.code})", Toast.LENGTH_SHORT).show()
                        }
                    }
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Error: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
    }

    LaunchedEffect(Unit) {
        refreshData()
    }

    // In-App Media Preview Dialog (Eliminates Browser Redirects)
    if (previewItem != null) {
        MediaViewerDialog(
            file = previewItem!!,
            serverUrl = serverUrl,
            deviceId = deviceId,
            deviceKey = deviceKey,
            onDismiss = { previewItem = null }
        )
    }

    // Destination Folder Selector & Creator Dialog
    if (showFolderDialog) {
        FolderPickerDialog(
            folders = foldersList,
            currentFolderId = targetFolderId,
            onSelectFolder = { id, name ->
                targetFolderId = id
                targetFolderName = name
                saveCredentials()
                showFolderDialog = false
                Toast.makeText(context, "Upload destination set to: $name", Toast.LENGTH_SHORT).show()
            },
            onCreateFolder = createFolderAction,
            onDismiss = { showFolderDialog = false }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.Cloud,
                            contentDescription = "myDrive Cloud",
                            tint = Color(0xFFA855F7),
                            modifier = Modifier.size(24.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "myDrive",
                            fontWeight = FontWeight.Bold,
                            fontSize = 20.sp,
                            color = Color.White
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = refreshData,
                        enabled = !isRefreshing
                    ) {
                        if (isRefreshing) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = Color(0xFFA855F7),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = "Refresh Data",
                                tint = Color(0xFFA855F7)
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF0D0D11))
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = Color(0xFF13131A),
                contentColor = Color.White
            ) {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0 },
                    icon = { Icon(Icons.Default.Folder, contentDescription = "Files") },
                    label = { Text("Files", fontSize = 12.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color.White,
                        selectedTextColor = Color(0xFFA855F7),
                        indicatorColor = Color(0xFF9333EA),
                        unselectedIconColor = Color(0xFF71717A),
                        unselectedTextColor = Color(0xFF71717A)
                    )
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1 },
                    icon = { Icon(Icons.Default.PhotoLibrary, contentDescription = "Gallery") },
                    label = { Text("Gallery", fontSize = 12.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color.White,
                        selectedTextColor = Color(0xFFA855F7),
                        indicatorColor = Color(0xFF9333EA),
                        unselectedIconColor = Color(0xFF71717A),
                        unselectedTextColor = Color(0xFF71717A)
                    )
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2 },
                    icon = { Icon(Icons.Default.Sync, contentDescription = "Backup") },
                    label = { Text("Backup", fontSize = 12.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color.White,
                        selectedTextColor = Color(0xFFA855F7),
                        indicatorColor = Color(0xFF9333EA),
                        unselectedIconColor = Color(0xFF71717A),
                        unselectedTextColor = Color(0xFF71717A)
                    )
                )
            }
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when (selectedTab) {
                0 -> FilesScreen(
                    storageSummary = storageSummary,
                    files = filesList,
                    folders = foldersList,
                    selectedFolderId = selectedFilterFolderId,
                    onSelectFilterFolder = { selectedFilterFolderId = it },
                    isRefreshing = isRefreshing,
                    onOpenFile = { file -> previewItem = file },
                    onRefresh = refreshData
                )
                1 -> GalleryScreen(
                    mediaList = galleryList,
                    serverUrl = serverUrl,
                    deviceId = deviceId,
                    deviceKey = deviceKey,
                    isRefreshing = isRefreshing,
                    onOpenMedia = { media ->
                        previewItem = CloudFile(
                            id = media.id,
                            filename = media.filename,
                            mimeType = media.mimeType,
                            sizeBytes = media.sizeBytes,
                            createdAt = media.takenAt ?: ""
                        )
                    },
                    onRefresh = refreshData
                )
                2 -> BackupSettingsScreen(
                    serverUrl = serverUrl,
                    deviceId = deviceId,
                    deviceKey = deviceKey,
                    targetFolderId = targetFolderId,
                    targetFolderName = targetFolderName,
                    wifiOnly = wifiOnly,
                    chargingOnly = chargingOnly,
                    syncVideos = syncVideos,
                    lastSyncTimestamp = lastSyncTimestamp,
                    totalSyncedCount = totalSyncedCount,
                    lastSyncStatus = lastSyncStatus,
                    onServerUrlChange = { serverUrl = it; saveCredentials() },
                    onDeviceIdChange = { deviceId = it; saveCredentials() },
                    onDeviceKeyChange = { deviceKey = it; saveCredentials() },
                    onWifiOnlyChange = { wifiOnly = it; saveCredentials() },
                    onChargingOnlyChange = { chargingOnly = it; saveCredentials() },
                    onSyncVideosChange = { syncVideos = it; saveCredentials() },
                    onOpenFolderDialog = { showFolderDialog = true },
                    onSyncNow = {
                        saveCredentials()
                        onSyncNow(serverUrl, deviceId, deviceKey, targetFolderId, syncVideos)
                    },
                    onScheduleSync = {
                        saveCredentials()
                        onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncVideos)
                    }
                )
            }
        }
    }
}

// ----------------------------------------------------
// TAB 0: Files & Storage Pool Explorer
// ----------------------------------------------------
@Composable
fun FilesScreen(
    storageSummary: StoragePoolSummary?,
    files: List<CloudFile>,
    folders: List<CloudFolder>,
    selectedFolderId: String?,
    onSelectFilterFolder: (String?) -> Unit,
    isRefreshing: Boolean,
    onOpenFile: (CloudFile) -> Unit,
    onRefresh: () -> Unit
) {
    val filteredFiles = remember(files, selectedFolderId) {
        if (selectedFolderId == null) {
            files
        } else {
            files.filter { it.folderId == selectedFolderId }
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Storage Pool Overview Card
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(20.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "Pooled Storage",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                        Surface(
                            shape = CircleShape,
                            color = Color(0xFF1E1B4B)
                        ) {
                            Text(
                                text = "${storageSummary?.connectedAccountsCount ?: 0} Drives",
                                fontSize = 11.sp,
                                color = Color(0xFFC084FC),
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    LinearProgressIndicator(
                        progress = {
                            val pct = (storageSummary?.usagePercentage ?: 0.0) / 100f
                            pct.toFloat().coerceIn(0f, 1f)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(6.dp)
                            .clip(RoundedCornerShape(3.dp)),
                        color = Color(0xFFA855F7),
                        trackColor = Color(0xFF27273A)
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        val used = formatBytes(storageSummary?.totalUsedBytes ?: 0L)
                        val total = formatBytes(storageSummary?.totalCapacityBytes ?: (60L * 1024 * 1024 * 1024))
                        Text(
                            text = "$used used of $total",
                            fontSize = 11.sp,
                            color = Color(0xFF94A3B8)
                        )
                        Text(
                            text = "%.0f%%".format(storageSummary?.usagePercentage ?: 0.0),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFA855F7)
                        )
                    }
                }
            }
        }

        // Folders Section (if folders exist in library)
        if (folders.isNotEmpty()) {
            item {
                Column(modifier = Modifier.padding(vertical = 4.dp)) {
                    Text(
                        text = "Cloud Folders",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFF94A3B8),
                        modifier = Modifier.padding(bottom = 6.dp)
                    )
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        item {
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (selectedFolderId == null) Color(0xFF26193E) else Color(0xFF181824),
                                modifier = Modifier.clickable { onSelectFilterFolder(null) }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.CloudQueue,
                                        contentDescription = null,
                                        tint = if (selectedFolderId == null) Color(0xFFC084FC) else Color(0xFF71717A),
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = "All Files",
                                        color = Color.White,
                                        fontSize = 12.sp,
                                        fontWeight = if (selectedFolderId == null) FontWeight.Bold else FontWeight.Normal
                                    )
                                }
                            }
                        }

                        items(folders) { folder ->
                            val isSelected = selectedFolderId == folder.id
                            Surface(
                                shape = RoundedCornerShape(10.dp),
                                color = if (isSelected) Color(0xFF26193E) else Color(0xFF181824),
                                modifier = Modifier.clickable { onSelectFilterFolder(folder.id) }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.Folder,
                                        contentDescription = null,
                                        tint = if (isSelected) Color(0xFFC084FC) else Color(0xFFFBBF24),
                                        modifier = Modifier.size(16.dp)
                                    )
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = folder.name,
                                        color = Color.White,
                                        fontSize = 12.sp,
                                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }

        // Files List Header
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 6.dp, bottom = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Cloud Files (${filteredFiles.size})",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = Color.White
                )
            }
        }

        if (filteredFiles.isEmpty() && !isRefreshing) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 40.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(
                            Icons.Default.CloudQueue,
                            contentDescription = null,
                            modifier = Modifier.size(48.dp),
                            tint = Color(0xFF3F3F46)
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text("No files found in this view", color = Color(0xFF71717A), fontSize = 13.sp)
                        Spacer(modifier = Modifier.height(2.dp))
                        Text("Backed up media will show here", color = Color(0xFF52525B), fontSize = 11.sp)
                    }
                }
            }
        }

        items(filteredFiles) { file ->
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onOpenFile(file) },
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    val icon = when {
                        file.mimeType.startsWith("image/") -> Icons.Default.Image
                        file.mimeType.startsWith("video/") -> Icons.Default.Videocam
                        file.mimeType.contains("pdf") -> Icons.Default.PictureAsPdf
                        else -> Icons.Default.Description
                    }
                    val iconTint = when {
                        file.mimeType.startsWith("image/") -> Color(0xFF38BDF8)
                        file.mimeType.startsWith("video/") -> Color(0xFFA855F7)
                        file.mimeType.contains("pdf") -> Color(0xFFF87171)
                        else -> Color(0xFFFBBF24)
                    }

                    Box(
                        modifier = Modifier
                            .size(38.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(Color(0xFF1C1C28)),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(20.dp))
                    }

                    Spacer(modifier = Modifier.width(12.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = file.filename,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium,
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = formatBytes(file.sizeBytes),
                            fontSize = 11.sp,
                            color = Color(0xFF71717A)
                        )
                    }

                    Icon(
                        Icons.Default.Visibility,
                        contentDescription = "View",
                        tint = Color(0xFF71717A),
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }
    }
}

// ----------------------------------------------------
// TAB 1: Gallery Timeline Screen
// ----------------------------------------------------
@Composable
fun GalleryScreen(
    mediaList: List<CloudMedia>,
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    isRefreshing: Boolean,
    onOpenMedia: (CloudMedia) -> Unit,
    onRefresh: () -> Unit
) {
    if (mediaList.isEmpty() && !isRefreshing) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Default.PhotoLibrary,
                    contentDescription = null,
                    modifier = Modifier.size(56.dp),
                    tint = Color(0xFF3F3F46)
                )
                Spacer(modifier = Modifier.height(10.dp))
                Text("No Photos or Videos Yet", fontWeight = FontWeight.Bold, color = Color.White, fontSize = 15.sp)
                Text("Tap 'Sync Now' in Backup to upload camera media", color = Color(0xFF71717A), fontSize = 12.sp)
            }
        }
    } else {
        LazyVerticalGrid(
            columns = GridCells.Fixed(3),
            modifier = Modifier
                .fillMaxSize()
                .padding(4.dp),
            contentPadding = PaddingValues(2.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp)
        ) {
            items(mediaList) { item ->
                val isVideo = item.mimeType.startsWith("video/")
                val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"

                Box(
                    modifier = Modifier
                        .aspectRatio(1f)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Color(0xFF181822))
                        .clickable { onOpenMedia(item) }
                ) {
                    if (isVideo) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .background(
                                    Brush.verticalGradient(
                                        listOf(Color(0xFF2E1065), Color(0xFF0F172A))
                                    )
                                ),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center,
                                modifier = Modifier.padding(6.dp)
                            ) {
                                Icon(
                                    Icons.Default.PlayCircle,
                                    contentDescription = "Play Video",
                                    tint = Color(0xFFA855F7),
                                    modifier = Modifier.size(32.dp)
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = item.filename,
                                    color = Color(0xFFCBD5E1),
                                    fontSize = 9.sp,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                    } else {
                        AsyncImage(
                            model = ImageRequest.Builder(LocalContext.current)
                                .data(streamUrl)
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .crossfade(true)
                                .build(),
                            contentDescription = item.filename,
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Crop
                        )
                    }

                    if (isVideo) {
                        Box(
                            modifier = Modifier
                                .align(Alignment.TopEnd)
                                .padding(4.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(Color.Black.copy(alpha = 0.7f))
                                .padding(horizontal = 4.dp, vertical = 2.dp)
                        ) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Default.PlayArrow,
                                    contentDescription = null,
                                    tint = Color.White,
                                    modifier = Modifier.size(10.dp)
                                )
                                Spacer(modifier = Modifier.width(2.dp))
                                Text("VIDEO", color = Color.White, fontSize = 8.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            }
        }
    }
}

// ----------------------------------------------------
// TAB 2: Backup & Sync Management Screen
// ----------------------------------------------------
@Composable
fun BackupSettingsScreen(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    targetFolderId: String,
    targetFolderName: String,
    wifiOnly: Boolean,
    chargingOnly: Boolean,
    syncVideos: Boolean,
    lastSyncTimestamp: Long,
    totalSyncedCount: Int,
    lastSyncStatus: String,
    onServerUrlChange: (String) -> Unit,
    onDeviceIdChange: (String) -> Unit,
    onDeviceKeyChange: (String) -> Unit,
    onWifiOnlyChange: (Boolean) -> Unit,
    onChargingOnlyChange: (Boolean) -> Unit,
    onSyncVideosChange: (Boolean) -> Unit,
    onOpenFolderDialog: () -> Unit,
    onSyncNow: () -> Unit,
    onScheduleSync: () -> Unit
) {
    val scrollState = rememberScrollState()
    val isPaired = deviceId.isNotBlank() && deviceKey.isNotBlank()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Live Device Status Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text("Device Status", fontSize = 11.sp, color = Color(0xFF71717A), fontWeight = FontWeight.SemiBold)
                        Text(if (isPaired) "Paired & Active" else "Unpaired", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    }
                    Surface(
                        shape = CircleShape,
                        color = if (isPaired) Color(0xFF064E3B) else Color(0xFF7F1D1D)
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .clip(CircleShape)
                                    .background(if (isPaired) Color(0xFF34D399) else Color(0xFFF87171))
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = if (isPaired) "ONLINE" else "DISCONNECTED",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (isPaired) Color(0xFF6EE7B7) else Color(0xFFFCA5A5)
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))
                HorizontalDivider(color = Color(0xFF22222E))
                Spacer(modifier = Modifier.height(10.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("Total Uploaded", fontSize = 10.sp, color = Color(0xFF71717A))
                        Text("$totalSyncedCount files", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("Last Sync", fontSize = 10.sp, color = Color(0xFF71717A))
                        val formattedTime = if (lastSyncTimestamp > 0) {
                            SimpleDateFormat("h:mm a, MMM d", Locale.getDefault()).format(Date(lastSyncTimestamp))
                        } else "Never"
                        Text(formattedTime, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFFA855F7))
                    }
                }
            }
        }

        // Upload Destination Folder Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.weight(1f)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(38.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF26193E)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.Default.FolderSpecial,
                                contentDescription = null,
                                tint = Color(0xFFC084FC),
                                modifier = Modifier.size(20.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text(
                                text = "Upload Destination Folder",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                            Text(
                                text = if (targetFolderId.isBlank()) "Root (My Drive)" else targetFolderName,
                                fontSize = 12.sp,
                                color = Color(0xFFA855F7),
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }

                    OutlinedButton(
                        onClick = onOpenFolderDialog,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFA855F7)),
                        border = BorderStroke(1.dp, Color(0xFFA855F7)),
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)
                    ) {
                        Text("Select", fontSize = 12.sp)
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "All photos and videos backed up from this phone will be sent directly to this cloud folder.",
                    fontSize = 11.sp,
                    color = Color(0xFF71717A)
                )
            }
        }

        // Connection & Keys Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("Connection & Keys", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)

                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = onServerUrlChange,
                    label = { Text("Server Backend URL") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = deviceId,
                    onValueChange = onDeviceIdChange,
                    label = { Text("Device ID") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = deviceKey,
                    onValueChange = onDeviceKeyChange,
                    label = { Text("Device Key") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
            }
        }

        // Backup Policy Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text("Backup Constraints", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Wi-Fi Only Uploads", fontSize = 13.sp, color = Color(0xFFE4E4E7))
                    Switch(checked = wifiOnly, onCheckedChange = onWifiOnlyChange)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Charging Only Uploads", fontSize = 13.sp, color = Color(0xFFE4E4E7))
                    Switch(checked = chargingOnly, onCheckedChange = onChargingOnlyChange)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Backup Videos", fontSize = 13.sp, color = Color(0xFFE4E4E7))
                    Switch(checked = syncVideos, onCheckedChange = onSyncVideosChange)
                }
            }
        }

        // Trigger Buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            OutlinedButton(
                onClick = onSyncNow,
                modifier = Modifier.weight(1f),
                enabled = isPaired
            ) {
                Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("Sync Now")
            }

            Button(
                onClick = onScheduleSync,
                modifier = Modifier.weight(1f),
                enabled = isPaired,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7E22CE))
            ) {
                Icon(Icons.Default.Schedule, contentDescription = null, modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(6.dp))
                Text("Auto Sync")
            }
        }
    }
}

// ----------------------------------------------------
// In-App Media Viewer (Zero Browser Redirects)
// ----------------------------------------------------
@Composable
fun MediaViewerDialog(
    file: CloudFile,
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    onDismiss: () -> Unit
) {
    val context = LocalContext.current
    val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${file.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
    val isImage = file.mimeType.startsWith("image/")
    val isVideo = file.mimeType.startsWith("video/")

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = Color(0xF80B0B12)
        ) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .systemBarsPadding()
            ) {
                // Top Action Bar
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                    }

                    Column(
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 8.dp)
                    ) {
                        Text(
                            text = file.filename,
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = "${formatBytes(file.sizeBytes)} • ${file.mimeType}",
                            color = Color(0xFF94A3B8),
                            fontSize = 11.sp
                        )
                    }

                    IconButton(
                        onClick = {
                            downloadFileToDevice(context, streamUrl, file.filename, deviceId, deviceKey)
                        }
                    ) {
                        Icon(Icons.Default.Download, contentDescription = "Download", tint = Color(0xFFA855F7))
                    }
                }

                // Media Preview Body
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    if (isImage) {
                        var isLoading by remember { mutableStateOf(true) }

                        AsyncImage(
                            model = ImageRequest.Builder(context)
                                .data(streamUrl)
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .crossfade(true)
                                .listener(
                                    onSuccess = { _, _ -> isLoading = false },
                                    onError = { _, _ -> isLoading = false }
                                )
                                .build(),
                            contentDescription = file.filename,
                            modifier = Modifier
                                .fillMaxSize()
                                .padding(12.dp),
                            contentScale = ContentScale.Fit
                        )

                        if (isLoading) {
                            CircularProgressIndicator(
                                color = Color(0xFFA855F7),
                                modifier = Modifier.size(44.dp)
                            )
                        }
                    } else if (isVideo) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                            modifier = Modifier.padding(24.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(80.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFF26193E))
                                    .clickable {
                                        try {
                                            val intent = Intent(Intent.ACTION_VIEW).apply {
                                                setDataAndType(Uri.parse(streamUrl), "video/*")
                                                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                                            }
                                            context.startActivity(intent)
                                        } catch (e: Exception) {
                                            Toast.makeText(context, "No video player available", Toast.LENGTH_SHORT).show()
                                        }
                                    },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    Icons.Default.PlayArrow,
                                    contentDescription = "Play",
                                    tint = Color(0xFFC084FC),
                                    modifier = Modifier.size(44.dp)
                                )
                            }
                            Spacer(modifier = Modifier.height(16.dp))
                            Text("Cloud Video Stream", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                            Spacer(modifier = Modifier.height(6.dp))
                            Text(file.filename, color = Color(0xFF94A3B8), fontSize = 12.sp, maxLines = 2)
                            Spacer(modifier = Modifier.height(16.dp))
                            Button(
                                onClick = {
                                    try {
                                        val intent = Intent(Intent.ACTION_VIEW).apply {
                                            setDataAndType(Uri.parse(streamUrl), "video/*")
                                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                                        }
                                        context.startActivity(intent)
                                    } catch (e: Exception) {
                                        Toast.makeText(context, "No video player available", Toast.LENGTH_SHORT).show()
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7E22CE)),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(Icons.Default.PlayArrow, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("Play in Video Player")
                            }
                        }
                    } else {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                            modifier = Modifier.padding(24.dp)
                        ) {
                            Icon(
                                Icons.Default.Description,
                                contentDescription = null,
                                tint = Color(0xFFC084FC),
                                modifier = Modifier.size(72.dp)
                            )
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(file.filename, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp, maxLines = 2)
                            Spacer(modifier = Modifier.height(6.dp))
                            Text("${formatBytes(file.sizeBytes)} • ${file.mimeType}", color = Color(0xFF71717A), fontSize = 12.sp)
                        }
                    }
                }

                // Bottom Action Footer
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    OutlinedButton(
                        onClick = onDismiss,
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF94A3B8)),
                        border = BorderStroke(1.dp, Color(0xFF27273A)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Close")
                    }

                    Button(
                        onClick = {
                            downloadFileToDevice(context, streamUrl, file.filename, deviceId, deviceKey)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFA855F7)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Save to Phone")
                    }
                }
            }
        }
    }
}

// ----------------------------------------------------
// Folder Selection & Creation Dialog
// ----------------------------------------------------
@Composable
fun FolderPickerDialog(
    folders: List<CloudFolder>,
    currentFolderId: String,
    onSelectFolder: (String, String) -> Unit,
    onCreateFolder: (String) -> Unit,
    onDismiss: () -> Unit
) {
    var newFolderName by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF14141C),
        title = {
            Text(
                text = "Select Upload Folder",
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 17.sp
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "Choose where photos & videos from this phone will be stored:",
                    color = Color(0xFF94A3B8),
                    fontSize = 12.sp
                )

                // Option: Root Folder
                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            onSelectFolder("", "Root (My Drive)")
                        },
                    color = if (currentFolderId.isBlank()) Color(0xFF26193E) else Color(0xFF1C1C28)
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            Icons.Default.CloudQueue,
                            contentDescription = null,
                            tint = if (currentFolderId.isBlank()) Color(0xFFC084FC) else Color(0xFF94A3B8),
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = "Root (My Drive)",
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = if (currentFolderId.isBlank()) FontWeight.Bold else FontWeight.Normal
                        )
                    }
                }

                // List of existing folders
                folders.forEach { folder ->
                    val isSelected = currentFolderId == folder.id
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable {
                                onSelectFolder(folder.id, folder.name)
                            },
                        color = if (isSelected) Color(0xFF26193E) else Color(0xFF1C1C28)
                    ) {
                        Row(
                            modifier = Modifier.padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                Icons.Default.Folder,
                                contentDescription = null,
                                tint = if (isSelected) Color(0xFFC084FC) else Color(0xFFFBBF24),
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = folder.name,
                                    color = Color.White,
                                    fontSize = 13.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                                )
                                if (folder.path.isNotBlank()) {
                                    Text(
                                        text = folder.path,
                                        color = Color(0xFF71717A),
                                        fontSize = 10.sp
                                    )
                                }
                            }
                            if (isSelected) {
                                Icon(
                                    Icons.Default.Check,
                                    contentDescription = "Selected",
                                    tint = Color(0xFFC084FC),
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    }
                }

                HorizontalDivider(color = Color(0xFF27273A), modifier = Modifier.padding(vertical = 4.dp))

                // Create New Folder section
                Text(
                    text = "Create New Folder:",
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp
                )

                OutlinedTextField(
                    value = newFolderName,
                    onValueChange = { newFolderName = it },
                    placeholder = { Text("e.g. Pixel 8 Backups", color = Color(0xFF52525B), fontSize = 12.sp) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedBorderColor = Color(0xFFA855F7),
                        unfocusedBorderColor = Color(0xFF27273A)
                    )
                )

                Button(
                    onClick = {
                        if (newFolderName.isNotBlank()) {
                            onCreateFolder(newFolderName)
                        }
                    },
                    enabled = newFolderName.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFA855F7),
                        disabledContainerColor = Color(0xFF2E1065)
                    )
                ) {
                    Icon(Icons.Default.CreateNewFolder, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Create & Set as Destination", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel", color = Color(0xFF94A3B8))
            }
        }
    )
}

fun downloadFileToDevice(context: Context, url: String, filename: String, deviceId: String, deviceKey: String) {
    try {
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val uri = Uri.parse(url)
        val request = DownloadManager.Request(uri).apply {
            setTitle(filename)
            setDescription("Downloading from myDrive")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            addRequestHeader("x-device-id", deviceId)
            addRequestHeader("x-device-key", deviceKey)
        }
        dm.enqueue(request)
        Toast.makeText(context, "Downloading $filename to Downloads folder...", Toast.LENGTH_SHORT).show()
    } catch (e: Exception) {
        Toast.makeText(context, "Download notice: ${e.message}", Toast.LENGTH_SHORT).show()
    }
}

fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt()
    val value = bytes / Math.pow(1024.0, digitGroups.toDouble())
    return String.format(Locale.US, "%.1f %s", value, units[digitGroups])
}
