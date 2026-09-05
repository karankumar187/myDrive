package com.drive.sync

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.widget.Toast
import android.provider.OpenableColumns
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import com.drive.sync.crypto.VaultCrypto
import java.io.ByteArrayOutputStream
import java.io.File
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import android.media.MediaPlayer
import android.widget.MediaController
import android.widget.VideoView
import androidx.work.*
import coil.Coil
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.decode.SvgDecoder
import coil.disk.DiskCache
import coil.memory.MemoryCache
import coil.request.ImageRequest
import coil.size.Precision
import coil.size.Size
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
    val takenAt: String?,
    var isFavorite: Boolean = false,
    val width: Int? = null,
    val height: Int? = null,
    val duration: Double? = null,
    val cameraMake: String? = null,
    val cameraModel: String? = null,
    val latitude: Double? = null,
    val longitude: Double? = null,
    val sourceDeviceName: String? = null,
    val sourceDeviceId: String? = null,
    val folderName: String? = null,
    val storageAccountName: String? = null,
    val isCloudOnly: Boolean = true,
    val status: String = "✓ Safely backed up"
)

data class CloudFolder(
    val id: String,
    val name: String,
    val path: String = ""
)

data class PairedDevice(
    val id: String,
    val deviceId: String,
    val deviceName: String,
    val deviceType: String,
    val status: String,
    val lastSeenAt: String
)

data class PairedDeviceRule(
    val sourceDeviceId: String,
    val sourceDeviceName: String,
    val syncPhotos: Boolean = false,
    val syncVideos: Boolean = false,
    val syncDocuments: Boolean = false,
    val autoDownloadToGallery: Boolean = false
)

data class DeviceUploadItem(
    val id: String,
    val filename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val folderName: String?,
    val createdAt: String
)

data class InboundSyncItem(
    val id: String,
    val filename: String,
    val mimeType: String,
    val sizeBytes: Long,
    val folderName: String?,
    val createdAt: String,
    val sourceDeviceLabel: String,
    var isDownloadedLocally: Boolean = false,
    val isForceDownload: Boolean = false
)

class MainActivity : ComponentActivity() {

    private val httpClient = sharedHttpClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val imageLoader = ImageLoader.Builder(this)
            .okHttpClient(sharedHttpClient)
            .memoryCache {
                MemoryCache.Builder(this)
                    .maxSizePercent(0.25)
                    .strongReferencesEnabled(true)
                    .build()
            }
            .diskCache {
                DiskCache.Builder()
                    .directory(cacheDir.resolve("image_cache"))
                    .maxSizeBytes(150L * 1024 * 1024)
                    .build()
            }
            .components {
                add(SvgDecoder.Factory())
            }
            .crossfade(false)
            .respectCacheHeaders(false)
            .build()
        Coil.setImageLoader(imageLoader)

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
                        onScheduleSync = { serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments ->
                            scheduleBackupWork(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments)
                            Toast.makeText(this, "Periodic background backup scheduled!", Toast.LENGTH_SHORT).show()
                        },
                        onSyncNow = { serverUrl, deviceId, deviceKey, targetFolderId, syncPhotos, syncVideos, syncDocuments, onComplete ->
                            triggerImmediateSync(serverUrl, deviceId, deviceKey, targetFolderId, syncPhotos, syncVideos, syncDocuments, onComplete)
                        },
                        httpClient = httpClient
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        val prefs = getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", "") ?: ""
        val deviceKey = prefs.getString("device_key", "") ?: ""
        val serverUrl = prefs.getString("server_url", "https://mydrive-sti3.onrender.com") ?: "https://mydrive-sti3.onrender.com"
        val targetFolderId = prefs.getString("target_folder_id", "") ?: ""
        val wifiOnly = prefs.getBoolean("wifi_only", false)
        val chargingOnly = prefs.getBoolean("charging_only", false)
        val syncPhotos = prefs.getBoolean("sync_photos", true)
        val syncVideos = prefs.getBoolean("sync_videos", true)
        val syncDocuments = prefs.getBoolean("sync_documents", true)

        if (deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            scheduleBackupWork(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments)
        }
    }

    private fun scheduleBackupWork(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        targetFolderId: String?,
        wifiOnly: Boolean,
        chargingOnly: Boolean,
        syncPhotos: Boolean,
        syncVideos: Boolean,
        syncDocuments: Boolean
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

        val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(12, TimeUnit.HOURS)
            .setConstraints(constraints)
            .setInputData(
                workDataOf(
                    "server_url" to serverUrl,
                    "device_id" to deviceId,
                    "device_key" to deviceKey,
                    "target_folder_id" to (targetFolderId ?: ""),
                    "sync_photos" to syncPhotos,
                    "sync_videos" to syncVideos,
                    "sync_documents" to syncDocuments
                )
            )
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            "UnifiedDriveSync",
            ExistingPeriodicWorkPolicy.UPDATE,
            syncRequest
        )
    }

    // triggerImmediateSync is kept for API compatibility but actual implementation
    // is done in-process via performInProcessSync() called from MainAppScreen,
    // so we get live per-file progress in the UI.
    fun triggerImmediateSync(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        targetFolderId: String?,
        syncPhotos: Boolean,
        syncVideos: Boolean,
        syncDocuments: Boolean,
        onComplete: (() -> Unit)? = null
    ) {
        // Immediately invoke onComplete — actual sync runs in-process (see performInProcessSync)
        onComplete?.invoke()
    }
}

// ══════════════════════════════════════════════════════════════════
// Device Setup / Credentials Screen  (shown on first launch)
// ══════════════════════════════════════════════════════════════════
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DeviceSetupScreen(
    prefs: android.content.SharedPreferences,
    httpClient: OkHttpClient,
    onSetupComplete: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    var serverUrl by remember { mutableStateOf("https://mydrive-sti3.onrender.com") }
    var deviceId by remember { mutableStateOf("") }
    var deviceKey by remember { mutableStateOf("") }

    var isConnecting by remember { mutableStateOf(false) }
    var errorMsg by remember { mutableStateOf<String?>(null) }
    var showKey by remember { mutableStateOf(false) }

    fun connectAndSave() {
        if (deviceId.isBlank() || deviceKey.isBlank()) {
            errorMsg = "Device ID and Device Key are required."
            return
        }
        if (serverUrl.isBlank()) {
            errorMsg = "Server URL is required."
            return
        }
        errorMsg = null
        isConnecting = true
        scope.launch(Dispatchers.IO) {
            try {
                val base = serverUrl.trimEnd('/')
                val req = Request.Builder()
                    .url("$base/api/v1/storage/summary")
                    .addHeader("x-device-id", deviceId.trim())
                    .addHeader("x-device-key", deviceKey.trim())
                    .build()
                val res = httpClient.newCall(req).execute()
                withContext(Dispatchers.Main) {
                    isConnecting = false
                    if (res.isSuccessful) {
                        // Save credentials
                        prefs.edit().apply {
                            putString("server_url", serverUrl.trimEnd('/'))
                            putString("device_id", deviceId.trim())
                            putString("device_key", deviceKey.trim())
                            apply()
                        }
                        Toast.makeText(context, "Connected! Welcome to myDrive 🎉", Toast.LENGTH_SHORT).show()
                        onSetupComplete()
                    } else {
                        errorMsg = "Connection failed (HTTP ${res.code}). Check your credentials."
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    isConnecting = false
                    errorMsg = "Could not reach server: ${e.message}"
                }
            }
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    colors = listOf(Color(0xFF0D0D11), Color(0xFF1A0A2E), Color(0xFF0D0D11))
                )
            )
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp, vertical = 56.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // ── Logo ────────────────────────────────────────────────────
            Box(
                modifier = Modifier
                    .size(80.dp)
                    .clip(RoundedCornerShape(20.dp))
                    .background(Color(0xFF1E1E28)),
                contentAlignment = Alignment.Center
            ) {
                Image(
                    painter = painterResource(R.drawable.ic_mydrive_logo),
                    contentDescription = "myDrive",
                    modifier = Modifier.size(52.dp)
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            // ── Headline ────────────────────────────────────────────────
            Text(
                text = buildAnnotatedString {
                    append("my")
                    withStyle(style = SpanStyle(color = Color(0xFFC084FC))) { append("Drive") }
                },
                fontSize = 30.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "Connect your device to get started",
                fontSize = 14.sp,
                color = Color(0xFF9CA3AF),
                textAlign = TextAlign.Center
            )

            Spacer(modifier = Modifier.height(40.dp))

            // ── Card ────────────────────────────────────────────────────
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = Color(0xFF13131A),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(24.dp)) {

                    Text(
                        "Device Credentials",
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        "Enter the credentials generated by your myDrive server.",
                        fontSize = 12.sp,
                        color = Color(0xFF71717A),
                        lineHeight = 18.sp
                    )

                    Spacer(modifier = Modifier.height(20.dp))

                    // Server URL
                    Text("Server URL", fontSize = 12.sp, color = Color(0xFFA1A1AA), fontWeight = FontWeight.Medium)
                    Spacer(modifier = Modifier.height(6.dp))
                    OutlinedTextField(
                        value = serverUrl,
                        onValueChange = { serverUrl = it; errorMsg = null },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        placeholder = { Text("https://your-server.com", color = Color(0xFF52525B), fontSize = 14.sp) },
                        leadingIcon = { Icon(Icons.Default.Cloud, contentDescription = null, tint = Color(0xFF9333EA)) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFF9333EA),
                            unfocusedBorderColor = Color(0xFF27272A),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color(0xFFD4D4D8),
                            cursorColor = Color(0xFFA855F7),
                            focusedContainerColor = Color(0xFF1E1E28),
                            unfocusedContainerColor = Color(0xFF1A1A22)
                        ),
                        shape = RoundedCornerShape(12.dp)
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // Device ID
                    Text("Device ID", fontSize = 12.sp, color = Color(0xFFA1A1AA), fontWeight = FontWeight.Medium)
                    Spacer(modifier = Modifier.height(6.dp))
                    OutlinedTextField(
                        value = deviceId,
                        onValueChange = { deviceId = it; errorMsg = null },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        placeholder = { Text("your-device-id", color = Color(0xFF52525B), fontSize = 14.sp) },
                        leadingIcon = { Icon(Icons.Default.PhoneAndroid, contentDescription = null, tint = Color(0xFF9333EA)) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFF9333EA),
                            unfocusedBorderColor = Color(0xFF27272A),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color(0xFFD4D4D8),
                            cursorColor = Color(0xFFA855F7),
                            focusedContainerColor = Color(0xFF1E1E28),
                            unfocusedContainerColor = Color(0xFF1A1A22)
                        ),
                        shape = RoundedCornerShape(12.dp)
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    // Device Key
                    Text("Device Key", fontSize = 12.sp, color = Color(0xFFA1A1AA), fontWeight = FontWeight.Medium)
                    Spacer(modifier = Modifier.height(6.dp))
                    OutlinedTextField(
                        value = deviceKey,
                        onValueChange = { deviceKey = it; errorMsg = null },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        placeholder = { Text("your-device-key", color = Color(0xFF52525B), fontSize = 14.sp) },
                        leadingIcon = { Icon(Icons.Default.VpnKey, contentDescription = null, tint = Color(0xFF9333EA)) },
                        trailingIcon = {
                            IconButton(onClick = { showKey = !showKey }) {
                                Icon(
                                    if (showKey) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                    contentDescription = if (showKey) "Hide key" else "Show key",
                                    tint = Color(0xFF71717A)
                                )
                            }
                        },
                        visualTransformation = if (showKey)
                            androidx.compose.ui.text.input.VisualTransformation.None
                        else
                            androidx.compose.ui.text.input.PasswordVisualTransformation(),
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFF9333EA),
                            unfocusedBorderColor = Color(0xFF27272A),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color(0xFFD4D4D8),
                            cursorColor = Color(0xFFA855F7),
                            focusedContainerColor = Color(0xFF1E1E28),
                            unfocusedContainerColor = Color(0xFF1A1A22)
                        ),
                        shape = RoundedCornerShape(12.dp)
                    )

                    // Error message
                    if (errorMsg != null) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = Color(0xFF2D1010)
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Icon(
                                    Icons.Default.ErrorOutline,
                                    contentDescription = null,
                                    tint = Color(0xFFEF4444),
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(8.dp))
                                Text(
                                    errorMsg!!,
                                    fontSize = 12.sp,
                                    color = Color(0xFFEF4444),
                                    lineHeight = 16.sp
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    // Connect button
                    Button(
                        onClick = { connectAndSave() },
                        enabled = !isConnecting,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(52.dp),
                        shape = RoundedCornerShape(14.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF9333EA),
                            disabledContainerColor = Color(0xFF3B1F6B)
                        )
                    ) {
                        if (isConnecting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = Color.White,
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text("Connecting...", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        } else {
                            Icon(Icons.Default.Link, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Connect & Save", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            // ── Help hint ────────────────────────────────────────────────
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color(0xFF1E1E28),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.Top
                ) {
                    Icon(
                        Icons.Default.Info,
                        contentDescription = null,
                        tint = Color(0xFF7C3AED),
                        modifier = Modifier.size(16.dp).padding(top = 1.dp)
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                    Text(
                        "Find your Device ID and Device Key in the myDrive web app under Settings → Devices → Register New Device.",
                        fontSize = 12.sp,
                        color = Color(0xFF71717A),
                        lineHeight = 18.sp
                    )
                }
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainAppScreen(
    prefs: android.content.SharedPreferences,
    onScheduleSync: (String, String, String, String?, Boolean, Boolean, Boolean, Boolean, Boolean) -> Unit,
    onSyncNow: (String, String, String, String?, Boolean, Boolean, Boolean, (() -> Unit)?) -> Unit,
    httpClient: OkHttpClient
) {
    val context = LocalContext.current

    // ── Setup gate ──────────────────────────────────────────────────────────
    // isSetupComplete is true only when both device_id AND device_key are persisted.
    var isSetupComplete by remember {
        mutableStateOf(
            prefs.getString("device_id", "").orEmpty().isNotBlank() &&
            prefs.getString("device_key", "").orEmpty().isNotBlank()
        )
    }

    if (!isSetupComplete) {
        DeviceSetupScreen(
            prefs = prefs,
            httpClient = httpClient,
            onSetupComplete = { isSetupComplete = true }
        )
        return
    }
    // ────────────────────────────────────────────────────────────────────────

    val requiredPermissions = remember {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            arrayOf(
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO
            )
        } else {
            arrayOf(
                Manifest.permission.READ_EXTERNAL_STORAGE
            )
        }
    }

    var hasMediaPermissions by remember {
        mutableStateOf(
            requiredPermissions.all {
                ContextCompat.checkSelfPermission(context, it) == PackageManager.PERMISSION_GRANTED
            }
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { results ->
        hasMediaPermissions = results.values.all { it }
        if (hasMediaPermissions) {
            Toast.makeText(context, "Gallery permissions granted for background sync!", Toast.LENGTH_SHORT).show()
        }
    }

    LaunchedEffect(Unit) {
        if (!hasMediaPermissions) {
            permissionLauncher.launch(requiredPermissions)
        }
    }

    var selectedTab by remember { mutableIntStateOf(0) }
    var isFilesSelectionMode by remember { mutableStateOf(false) }

    var serverUrl by remember { mutableStateOf(prefs.getString("server_url", "https://mydrive-sti3.onrender.com") ?: "https://mydrive-sti3.onrender.com") }
    var deviceId by remember { mutableStateOf(prefs.getString("device_id", "") ?: "") }
    var deviceKey by remember { mutableStateOf(prefs.getString("device_key", "") ?: "") }
    var targetFolderId by remember { mutableStateOf(prefs.getString("target_folder_id", "") ?: "") }
    var targetFolderName by remember { mutableStateOf(prefs.getString("target_folder_name", "Root (My Drive)") ?: "Root (My Drive)") }
    var wifiOnly by remember { mutableStateOf(prefs.getBoolean("wifi_only", false)) }
    var chargingOnly by remember { mutableStateOf(prefs.getBoolean("charging_only", false)) }
    var syncPhotos by remember { mutableStateOf(prefs.getBoolean("sync_photos", true)) }
    var syncVideos by remember { mutableStateOf(prefs.getBoolean("sync_videos", true)) }
    var syncDocuments by remember { mutableStateOf(prefs.getBoolean("sync_documents", true)) }

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

    // Activity & Paired Devices States
    var uploadedFilesList by remember { mutableStateOf<List<DeviceUploadItem>>(emptyList()) }
    var inboundSyncList by remember { mutableStateOf<List<InboundSyncItem>>(emptyList()) }
    var pairedDevicesList by remember { mutableStateOf<List<PairedDevice>>(emptyList()) }
    val pairedRulesMap = remember {
        val map = mutableStateMapOf<String, PairedDeviceRule>()
        try {
            val savedJson = prefs.getString("paired_device_rules_json", null)
            if (!savedJson.isNullOrBlank()) {
                val arr = org.json.JSONArray(savedJson)
                for (i in 0 until arr.length()) {
                    val r = arr.getJSONObject(i)
                    val sId = r.optString("sourceDeviceId")
                    if (sId.isNotBlank()) {
                        map[sId] = PairedDeviceRule(
                            sourceDeviceId = sId,
                            sourceDeviceName = r.optString("sourceDeviceName"),
                            syncPhotos = r.optBoolean("syncPhotos", false),
                            syncVideos = r.optBoolean("syncVideos", false),
                            syncDocuments = r.optBoolean("syncDocuments", false),
                            autoDownloadToGallery = r.optBoolean("autoDownloadToGallery", false)
                        )
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        map
    }
    var isSavingPolicy by remember { mutableStateOf(false) }
    var isSyncingNow by remember { mutableStateOf(false) }
    var syncStatusText by remember { mutableStateOf("") }          // current step summary
    val syncLogLines = remember { mutableStateListOf<String>() }   // live per-file log

    var isRefreshing by remember { mutableStateOf(false) }
    var fetchError by remember { mutableStateOf<String?>(null) }

    // Dialog States
    var showFolderDialog by remember { mutableStateOf(false) }
    var previewItem by remember { mutableStateOf<CloudFile?>(null) }

    val scope = rememberCoroutineScope()

    val savePairedRulesToPrefs = {
        try {
            val arr = org.json.JSONArray()
            pairedRulesMap.values.forEach { r ->
                val obj = org.json.JSONObject().apply {
                    put("sourceDeviceId", r.sourceDeviceId)
                    put("sourceDeviceName", r.sourceDeviceName)
                    put("syncPhotos", r.syncPhotos)
                    put("syncVideos", r.syncVideos)
                    put("syncDocuments", r.syncDocuments)
                    put("autoDownloadToGallery", r.autoDownloadToGallery)
                }
                arr.put(obj)
            }
            prefs.edit().putString("paired_device_rules_json", arr.toString()).apply()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ── In-process Sync Now ─────────────────────────────────────────────────
    // Runs directly in a UI-scope coroutine so we can post live progress back.
    val performInProcessSync: () -> Unit = {
        scope.launch {
            if (serverUrl.isBlank() || deviceId.isBlank() || deviceKey.isBlank()) return@launch
            isSyncingNow = true
            syncStatusText = "Starting sync…"
            syncLogLines.clear()

            val base = serverUrl.trimEnd('/')
            val targetFolder = targetFolderId.takeIf { it.isNotBlank() }

            fun log(msg: String) { syncLogLines.add(0, msg) }  // newest first
            fun status(msg: String) { syncStatusText = msg }

            // Helper: fetch storage account name for display
            var driveLabel = "Cloud Drive"
            try {
                withContext(Dispatchers.IO) {
                    val req = Request.Builder()
                        .url("$base/api/v1/storage/summary")
                        .addHeader("x-device-id", deviceId)
                        .addHeader("x-device-key", deviceKey)
                        .build()
                    val res = httpClient.newCall(req).execute()
                    if (res.isSuccessful) {
                        val j = org.json.JSONObject(res.body?.string() ?: "{}")
                        val accs = j.optJSONArray("accounts")
                        if (accs != null && accs.length() > 0) {
                            val acc = accs.getJSONObject(0)
                            driveLabel = acc.optString("accountEmail", "").ifBlank {
                                acc.optString("providerType", "Google Drive")
                            }
                        }
                    }
                }
            } catch (_: Exception) {}

            var totalUploaded = 0
            var totalSkipped = 0

            // ── Local sync history helpers ────────────────────────────────
            // Keyed by collection label → file in app internal storage.
            // Each file holds one asset ID (Long) per line.
            fun historyFile(label: String): java.io.File =
                java.io.File(context.filesDir, "synced_${label.lowercase()}.txt")

            fun loadHistory(label: String): MutableSet<Long> {
                val f = historyFile(label)
                if (!f.exists()) return mutableSetOf()
                return f.readLines().mapNotNull { it.trim().toLongOrNull() }.toMutableSet()
            }

            fun appendHistory(label: String, id: Long) {
                historyFile(label).appendText("$id\n")
            }
            // ─────────────────────────────────────────────────────────────

            suspend fun syncMediaCollection(
                collectionUri: android.net.Uri,
                label: String,
                defaultMime: String,
                namePrefix: String,
                selection: String? = null,
                selectionArgs: Array<String>? = null
            ) {
                status("📂 Scanning $label…")
                log("── Scanning $label ──")

                val projection = arrayOf(
                    android.provider.MediaStore.MediaColumns._ID,
                    android.provider.MediaStore.MediaColumns.DISPLAY_NAME,
                    android.provider.MediaStore.MediaColumns.MIME_TYPE,
                    android.provider.MediaStore.MediaColumns.SIZE
                )
                val cursor = context.contentResolver.query(
                    collectionUri, projection, selection, selectionArgs,
                    "${android.provider.MediaStore.MediaColumns.DATE_ADDED} DESC"
                ) ?: run { log("⚠ Could not read $label"); return }

                val items = mutableListOf<Triple<Long, String, String>>() // id, name, mime
                cursor.use {
                    val idCol = it.getColumnIndexOrThrow(android.provider.MediaStore.MediaColumns._ID)
                    val nameCol = it.getColumnIndexOrThrow(android.provider.MediaStore.MediaColumns.DISPLAY_NAME)
                    val mimeCol = it.getColumnIndexOrThrow(android.provider.MediaStore.MediaColumns.MIME_TYPE)
                    val sizeCol = it.getColumnIndexOrThrow(android.provider.MediaStore.MediaColumns.SIZE)
                    while (it.moveToNext()) {
                        val sz = it.getLong(sizeCol)
                        if (sz <= 0) continue
                        items.add(Triple(it.getLong(idCol), it.getString(nameCol) ?: "${namePrefix}_${it.getLong(idCol)}", it.getString(mimeCol) ?: defaultMime))
                    }
                }

                // Load local history to skip already-synced assets
                val history = withContext(Dispatchers.IO) { loadHistory(label) }
                val pending = items.filter { (id, _, _) -> id !in history }
                val total = items.size
                val alreadyDone = total - pending.size

                status("📂 $label — $total found, ${pending.size} pending, $alreadyDone already backed up")
                log("Found $total $label — ${pending.size} to upload, $alreadyDone in history")

                pending.forEachIndexed { idx, (id, filename, mimeType) ->
                    val num = idx + 1
                    status("⬆ Uploading $filename  ($num/${pending.size})\n☁ Drive: $driveLabel")
                    withContext(Dispatchers.IO) {
                        try {
                            val contentUri = android.content.ContentUris.withAppendedId(collectionUri, id)
                            val bytes = context.contentResolver.openInputStream(contentUri)?.use { stream ->
                                val buf = java.io.ByteArrayOutputStream(); stream.copyTo(buf); buf.toByteArray()
                            } ?: return@withContext

                            val hash = com.drive.sync.crypto.VaultCrypto.calculateSha256(bytes.inputStream())
                            val sizeBytes = bytes.size.toLong()

                            val initJson = org.json.JSONObject().apply {
                                put("filename", filename); put("mimeType", mimeType)
                                put("sizeBytes", sizeBytes); put("contentHash", hash)
                                targetFolder?.let { put("folderId", it) }
                            }
                            val initReq = Request.Builder()
                                .url("$base/api/v1/files/upload/initiate")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .post(initJson.toString().toRequestBody("application/json".toMediaType()))
                                .build()
                            val initRes = httpClient.newCall(initReq).execute()
                            if (!initRes.isSuccessful) {
                                withContext(Dispatchers.Main) { log("✗ $filename — initiate failed (${initRes.code})") }
                                return@withContext
                            }
                            val initResult = org.json.JSONObject(initRes.body?.string() ?: "{}")
                            if (initResult.optBoolean("isDuplicate", false)) {
                                // Content hash match — already in cloud; record in local history
                                appendHistory(label, id)
                                withContext(Dispatchers.Main) {
                                    log("⏩ $filename — already backed up (hash match)")
                                    totalSkipped++
                                }
                                return@withContext
                            }
                            val uploadUrl = initResult.getString("uploadSessionUrl")
                            val storageAccountId = initResult.getString("storageAccountId")
                            val driveOpaqueName = initResult.optString("driveOpaqueName", "")

                            val putRes = httpClient.newCall(
                                Request.Builder().url(uploadUrl).put(bytes.toRequestBody(mimeType.toMediaType())).build()
                            ).execute()
                            if (!putRes.isSuccessful && putRes.code != 200 && putRes.code != 201) {
                                withContext(Dispatchers.Main) { log("✗ $filename — upload to drive failed (${putRes.code})") }
                                putRes.close(); return@withContext
                            }
                            val putBody = putRes.body?.string() ?: ""
                            var providerFileId = try { if (putBody.isNotBlank()) org.json.JSONObject(putBody).optString("id", "") else "" } catch (_: Exception) { "" }
                            if (providerFileId.isBlank()) providerFileId = driveOpaqueName

                            val completeJson = org.json.JSONObject().apply {
                                put("filename", filename); put("mimeType", mimeType)
                                put("sizeBytes", sizeBytes); put("contentHash", hash)
                                put("storageAccountId", storageAccountId)
                                put("providerFileId", providerFileId)
                                put("driveOpaqueName", driveOpaqueName)
                                put("deviceAssetId", id.toString())
                                targetFolder?.let { put("folderId", it) }
                            }
                            httpClient.newCall(
                                Request.Builder()
                                    .url("$base/api/v1/files/upload/complete")
                                    .addHeader("x-device-id", deviceId)
                                    .addHeader("x-device-key", deviceKey)
                                    .post(completeJson.toString().toRequestBody("application/json".toMediaType()))
                                    .build()
                            ).execute().close()

                            // Record in local history so this asset is never re-uploaded
                            appendHistory(label, id)

                            withContext(Dispatchers.Main) {
                                log("✓ $filename → $driveLabel")
                                totalUploaded++
                            }
                        } catch (e: Exception) {
                            withContext(Dispatchers.Main) { log("✗ $filename — ${e.message}") }
                        }
                    }
                }
                log("── $label done: ${pending.size} processed ──")
            }

            try {
                if (syncPhotos) syncMediaCollection(
                    android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
                    "Photos", "image/jpeg", "photo"
                )
                if (syncVideos) syncMediaCollection(
                    android.provider.MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                    "Videos", "video/mp4", "video"
                )
                if (syncDocuments) syncMediaCollection(
                    android.provider.MediaStore.Files.getContentUri("external"),
                    "Documents", "application/pdf", "doc",
                    selection = "${android.provider.MediaStore.MediaColumns.MIME_TYPE} LIKE ? OR ${android.provider.MediaStore.MediaColumns.MIME_TYPE} LIKE ? OR ${android.provider.MediaStore.MediaColumns.MIME_TYPE} LIKE ?",
                    selectionArgs = arrayOf("application/%", "text/%", "%document%")
                )
            } catch (e: Exception) {
                log("❌ Sync error: ${e.message}")
            }

            val summary = "Sync complete — $totalUploaded uploaded, $totalSkipped already backed up"
            status("✅ $summary")
            log("═══════════════════════════════")
            log("✅ $summary")

            prefs.edit().apply {
                putLong("last_sync_timestamp", System.currentTimeMillis())
                putString("last_sync_status", summary)
                putInt("last_sync_count", totalUploaded)
                putInt("total_synced_count", prefs.getInt("total_synced_count", 0) + totalUploaded)
                apply()
            }
            // refreshData() called via LaunchedEffect(isSyncingNow) below
            isSyncingNow = false
        }
    }
    // ───────────────────────────────────────────────────────────────────────

    val saveCredentials = {
        prefs.edit().apply {
            putString("server_url", serverUrl)
            putString("device_id", deviceId)
            putString("device_key", deviceKey)
            putString("target_folder_id", targetFolderId)
            putString("target_folder_name", targetFolderName)
            putBoolean("wifi_only", wifiOnly)
            putBoolean("charging_only", chargingOnly)
            putBoolean("sync_photos", syncPhotos)
            putBoolean("sync_videos", syncVideos)
            putBoolean("sync_documents", syncDocuments)
            apply()
        }
    }

    val downloadInboundItem: (InboundSyncItem) -> Unit = { item ->
        val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
        val isMedia = item.mimeType.startsWith("image/") || item.mimeType.startsWith("video/")
        downloadFileToDevice(
            context = context,
            url = streamUrl,
            filename = item.filename,
            deviceId = deviceId,
            deviceKey = deviceKey,
            saveToGallery = isMedia,
            onSuccess = {
                scope.launch(Dispatchers.IO) {
                    try {
                        val baseUrl = serverUrl.trimEnd('/')
                        val body = JSONObject().apply { put("fileId", item.id) }
                        val req = Request.Builder()
                            .url("$baseUrl/api/v1/files/device/$deviceId/mark-synced")
                            .addHeader("x-device-id", deviceId)
                            .addHeader("x-device-key", deviceKey)
                            .post(body.toString().toRequestBody("application/json".toMediaType()))
                            .build()
                        httpClient.newCall(req).execute()
                        withContext(Dispatchers.Main) {
                            item.isDownloadedLocally = true
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }
        )
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
                                        val meta = item.optJSONObject("metadata")
                                        val sourceIds = item.optJSONArray("sourceDeviceIds")
                                        list.add(
                                            CloudMedia(
                                                id = item.optString("_id"),
                                                filename = item.optString("filename"),
                                                mimeType = item.optString("mimeType"),
                                                sizeBytes = item.optLong("sizeBytes"),
                                                takenAt = meta?.optString("takenAt")?.ifBlank { null }
                                                    ?: item.optString("createdAt"),
                                                isFavorite = item.optBoolean("isFavorite", false),
                                                width = if (meta != null && meta.has("width")) meta.optInt("width") else null,
                                                height = if (meta != null && meta.has("height")) meta.optInt("height") else null,
                                                duration = if (meta != null && meta.has("duration")) meta.optDouble("duration") else null,
                                                cameraMake = meta?.optString("cameraMake")?.ifBlank { null },
                                                cameraModel = meta?.optString("cameraModel")?.ifBlank { null },
                                                latitude = if (meta != null && meta.has("latitude")) meta.optDouble("latitude") else null,
                                                longitude = if (meta != null && meta.has("longitude")) meta.optDouble("longitude") else null,
                                                sourceDeviceName = item.optString("sourceDeviceName").ifBlank { "Pixel 8" },
                                                sourceDeviceId = item.optString("sourceDeviceId").ifBlank { null },
                                                folderName = item.optString("folderName").ifBlank { null },
                                                storageAccountName = item.optString("storageAccountName").ifBlank { "Google Drive • Account 1" },
                                                isCloudOnly = (sourceIds == null || sourceIds.length() == 0),
                                                status = "✓ Safely backed up"
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

                        // 5. Fetch Uploaded Files by This Device
                        try {
                            val req = Request.Builder()
                                .url("$baseUrl/api/v1/files/device/$deviceId/uploads")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .build()
                            val res = httpClient.newCall(req).execute()
                            if (res.isSuccessful) {
                                val json = JSONObject(res.body?.string() ?: "{}")
                                val arr = json.optJSONArray("files")
                                val list = mutableListOf<DeviceUploadItem>()
                                if (arr != null) {
                                    for (i in 0 until arr.length()) {
                                        val item = arr.getJSONObject(i)
                                        val fObj = item.optJSONObject("folderId")
                                        list.add(
                                            DeviceUploadItem(
                                                id = item.optString("_id"),
                                                filename = item.optString("filename"),
                                                mimeType = item.optString("mimeType"),
                                                sizeBytes = item.optLong("sizeBytes"),
                                                folderName = fObj?.optString("name"),
                                                createdAt = item.optString("createdAt")
                                            )
                                        )
                                    }
                                }
                                uploadedFilesList = list
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }

                        // 6. Fetch Inbound Synced Files from Paired Devices
                        try {
                            val req = Request.Builder()
                                .url("$baseUrl/api/v1/files/device/$deviceId/inbound-sync")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .build()
                            val res = httpClient.newCall(req).execute()
                            if (res.isSuccessful) {
                                val json = JSONObject(res.body?.string() ?: "{}")
                                val arr = json.optJSONArray("files")
                                val list = mutableListOf<InboundSyncItem>()
                                if (arr != null) {
                                    for (i in 0 until arr.length()) {
                                        val item = arr.getJSONObject(i)
                                        val fObj = item.optJSONObject("folderId")
                                        list.add(
                                            InboundSyncItem(
                                                id = item.optString("_id"),
                                                filename = item.optString("filename"),
                                                mimeType = item.optString("mimeType"),
                                                sizeBytes = item.optLong("sizeBytes"),
                                                folderName = fObj?.optString("name"),
                                                createdAt = item.optString("createdAt"),
                                                sourceDeviceLabel = item.optString("sourceDeviceLabel", "Cloud Drive"),
                                                isDownloadedLocally = item.optBoolean("isDownloadedLocally", false),
                                                isForceDownload = item.optBoolean("isForceDownload", false)
                                            )
                                        )
                                    }
                                }
                                inboundSyncList = list

                                // Automatically trigger download for force-download items requested from Web
                                val forcePending = list.filter { it.isForceDownload && !it.isDownloadedLocally }
                                if (forcePending.isNotEmpty()) {
                                    withContext(Dispatchers.Main) {
                                        Toast.makeText(context, "Force download: saving ${forcePending.size} file(s) to Gallery...", Toast.LENGTH_SHORT).show()
                                        forcePending.forEach { fItem ->
                                            downloadInboundItem(fItem)
                                        }
                                    }
                                }
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }

                        // 7. Fetch Policy & Paired Devices
                        try {
                            val req = Request.Builder()
                                .url("$baseUrl/api/v1/devices/my-policy?deviceId=$deviceId")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .build()
                            val res = httpClient.newCall(req).execute()
                            if (res.isSuccessful) {
                                val json = JSONObject(res.body?.string() ?: "{}")
                                val pArr = json.optJSONArray("pairedDevices")
                                val pList = mutableListOf<PairedDevice>()
                                if (pArr != null) {
                                    for (i in 0 until pArr.length()) {
                                        val item = pArr.getJSONObject(i)
                                        val devId = item.optString("deviceId")
                                        pList.add(
                                            PairedDevice(
                                                id = item.optString("_id"),
                                                deviceId = devId,
                                                deviceName = item.optString("deviceName"),
                                                deviceType = item.optString("deviceType", "desktop"),
                                                status = item.optString("status", "offline"),
                                                lastSeenAt = item.optString("lastSeenAt", "")
                                            )
                                        )
                                        // Ensure a default rule exists in pairedRulesMap for each paired device
                                        if (!pairedRulesMap.containsKey(devId)) {
                                            pairedRulesMap[devId] = PairedDeviceRule(
                                                sourceDeviceId = devId,
                                                sourceDeviceName = item.optString("deviceName"),
                                                syncPhotos = false,
                                                syncVideos = false,
                                                syncDocuments = false,
                                                autoDownloadToGallery = false
                                            )
                                        }
                                    }
                                }
                                pairedDevicesList = pList
                                val polObj = json.optJSONObject("policy")
                                if (polObj != null) {
                                    val rArr = polObj.optJSONArray("pairedDeviceRules")
                                    if (rArr != null) {
                                        for (i in 0 until rArr.length()) {
                                            val r = rArr.getJSONObject(i)
                                            val sId = r.optString("sourceDeviceId")
                                            if (sId.isNotBlank()) {
                                                pairedRulesMap[sId] = PairedDeviceRule(
                                                    sourceDeviceId = sId,
                                                    sourceDeviceName = r.optString("sourceDeviceName"),
                                                    syncPhotos = r.optBoolean("syncPhotos", false),
                                                    syncVideos = r.optBoolean("syncVideos", false),
                                                    syncDocuments = r.optBoolean("syncDocuments", false),
                                                    autoDownloadToGallery = r.optBoolean("autoDownloadToGallery", false)
                                                )
                                            }
                                        }
                                    }
                                }
                                savePairedRulesToPrefs()
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

    val syncAllToGallery: () -> Unit = {
        val pending = inboundSyncList.filter { !it.isDownloadedLocally }
        if (pending.isEmpty()) {
            Toast.makeText(context, "All paired device files already in Gallery!", Toast.LENGTH_SHORT).show()
        } else {
            Toast.makeText(context, "Downloading ${pending.size} files to Gallery...", Toast.LENGTH_SHORT).show()
            pending.forEach { item ->
                downloadInboundItem(item)
            }
        }
    }

    val savePolicyAction: () -> Unit = {
        if (serverUrl.isNotBlank() && deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            scope.launch(Dispatchers.IO) {
                isSavingPolicy = true
                try {
                    saveCredentials()
                    val baseUrl = serverUrl.trimEnd('/')
                    val rulesArray = org.json.JSONArray()
                    pairedRulesMap.values.forEach { rule ->
                        rulesArray.put(JSONObject().apply {
                            put("sourceDeviceId", rule.sourceDeviceId)
                            put("sourceDeviceName", rule.sourceDeviceName)
                            put("syncPhotos", rule.syncPhotos)
                            put("syncVideos", rule.syncVideos)
                            put("syncDocuments", rule.syncDocuments)
                            put("autoDownloadToGallery", rule.autoDownloadToGallery)
                        })
                    }
                    val policyObj = JSONObject().apply {
                        put("syncPhotos", syncPhotos)
                        put("syncVideos", syncVideos)
                        put("syncDocuments", syncDocuments)
                        put("wifiOnly", wifiOnly)
                        put("chargingOnly", chargingOnly)
                        put("pairedDeviceRules", rulesArray)
                    }
                    val body = JSONObject().apply {
                        put("policy", policyObj)
                        put("deviceId", deviceId)
                    }
                    val req = Request.Builder()
                        .url("$baseUrl/api/v1/devices/my-policy")
                        .addHeader("x-device-id", deviceId)
                        .addHeader("x-device-key", deviceKey)
                        .put(body.toString().toRequestBody("application/json".toMediaType()))
                        .build()
                    val res = httpClient.newCall(req).execute()
                    withContext(Dispatchers.Main) {
                        if (res.isSuccessful) {
                            Toast.makeText(context, "Personalized sync policy saved to cloud!", Toast.LENGTH_SHORT).show()
                        } else {
                            Toast.makeText(context, "Policy saved locally (${res.code})", Toast.LENGTH_SHORT).show()
                        }
                    }
                    refreshData()
                } catch (e: Exception) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(context, "Policy saved: ${e.message}", Toast.LENGTH_SHORT).show()
                    }
                } finally {
                    isSavingPolicy = false
                }
            }
        } else {
            saveCredentials()
            Toast.makeText(context, "Policy saved locally!", Toast.LENGTH_SHORT).show()
        }
    }

    LaunchedEffect(Unit) {
        refreshData()
    }

    // Auto-refresh cloud data when Sync Now finishes
    LaunchedEffect(isSyncingNow) {
        if (!isSyncingNow) {
            refreshData()
        }
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

    var isManualUploading by remember { mutableStateOf(false) }
    var uploadStatusText by remember { mutableStateOf("") }
    var showManualUploadDialog by remember { mutableStateOf(false) }

    val performManualUpload: (List<Uri>) -> Unit = { uris ->
        if (uris.isNotEmpty() && serverUrl.isNotBlank() && deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            scope.launch(Dispatchers.IO) {
                isManualUploading = true
                val total = uris.size
                var successCount = 0
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Uploading $total item(s) to $targetFolderName...", Toast.LENGTH_SHORT).show()
                }

                uris.forEachIndexed { idx, uri ->
                    try {
                        withContext(Dispatchers.Main) {
                            uploadStatusText = "Uploading ${idx + 1}/$total..."
                        }

                        var filename = "upload_${System.currentTimeMillis()}"
                        var sizeBytes = 0L
                        val mimeType = context.contentResolver.getType(uri) ?: "application/octet-stream"

                        val cursor = context.contentResolver.query(uri, null, null, null, null)
                        cursor?.use { c ->
                            val nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                            val sizeIdx = c.getColumnIndex(OpenableColumns.SIZE)
                            if (c.moveToFirst()) {
                                if (nameIdx != -1) filename = c.getString(nameIdx) ?: filename
                                if (sizeIdx != -1) sizeBytes = c.getLong(sizeIdx)
                            }
                        }

                        val bytes = context.contentResolver.openInputStream(uri)?.use { stream ->
                            val buffer = ByteArrayOutputStream()
                            stream.copyTo(buffer)
                            buffer.toByteArray()
                        } ?: return@forEachIndexed

                        if (sizeBytes <= 0) sizeBytes = bytes.size.toLong()

                        val contentHash = VaultCrypto.calculateSha256(bytes.inputStream())
                        val baseUrl = serverUrl.trimEnd('/')

                        val initJson = JSONObject().apply {
                            put("filename", filename)
                            put("mimeType", mimeType)
                            put("sizeBytes", sizeBytes)
                            put("contentHash", contentHash)
                            if (targetFolderId.isNotBlank()) {
                                put("folderId", targetFolderId)
                            }
                        }

                        val initReq = Request.Builder()
                            .url("$baseUrl/api/v1/files/upload/initiate")
                            .addHeader("x-device-id", deviceId)
                            .addHeader("x-device-key", deviceKey)
                            .post(initJson.toString().toRequestBody("application/json".toMediaType()))
                            .build()

                        val initRes = httpClient.newCall(initReq).execute()
                        if (initRes.isSuccessful) {
                            val initResult = JSONObject(initRes.body?.string() ?: "{}")
                            val isDuplicate = initResult.optBoolean("isDuplicate", false)

                            if (!isDuplicate) {
                                val uploadUrl = initResult.getString("uploadSessionUrl")
                                val storageAccountId = initResult.getString("storageAccountId")
                                val driveOpaqueName = initResult.optString("driveOpaqueName", "")

                                val putReq = Request.Builder()
                                    .url(uploadUrl)
                                    .put(bytes.toRequestBody(mimeType.toMediaType()))
                                    .build()

                                val putRes = httpClient.newCall(putReq).execute()
                                if (putRes.isSuccessful || putRes.code == 200 || putRes.code == 201) {
                                    val putBody = putRes.body?.string() ?: ""
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

                                    val compJson = JSONObject().apply {
                                        put("filename", filename)
                                        put("mimeType", mimeType)
                                        put("sizeBytes", sizeBytes)
                                        put("contentHash", contentHash)
                                        put("storageAccountId", storageAccountId)
                                        put("providerFileId", providerFileId)
                                        put("driveOpaqueName", driveOpaqueName)
                                        if (targetFolderId.isNotBlank()) {
                                            put("folderId", targetFolderId)
                                        }
                                    }
                                    val compReq = Request.Builder()
                                        .url("$baseUrl/api/v1/files/upload/complete")
                                        .addHeader("x-device-id", deviceId)
                                        .addHeader("x-device-key", deviceKey)
                                        .post(compJson.toString().toRequestBody("application/json".toMediaType()))
                                        .build()
                                    httpClient.newCall(compReq).execute().close()
                                    successCount++
                                } else {
                                    putRes.close()
                                }
                            } else {
                                successCount++
                            }
                        }
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }

                withContext(Dispatchers.Main) {
                    isManualUploading = false
                    uploadStatusText = ""
                    Toast.makeText(context, "Upload complete: $successCount of $total items saved to $targetFolderName!", Toast.LENGTH_LONG).show()
                    refreshData()
                }
            }
        }
    }

    val galleryPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickMultipleVisualMedia()
    ) { uris: List<Uri> ->
        if (uris.isNotEmpty()) {
            performManualUpload(uris)
        }
    }

    val documentPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.OpenMultipleDocuments()
    ) { uris: List<Uri> ->
        if (uris.isNotEmpty()) {
            performManualUpload(uris)
        }
    }

    // Manual Upload Options Dialog
    if (showManualUploadDialog) {
        ManualUploadDialog(
            targetFolderName = targetFolderName,
            onOpenFolderSelector = {
                showManualUploadDialog = false
                showFolderDialog = true
            },
            onPickGallery = {
                showManualUploadDialog = false
                galleryPickerLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
            },
            onPickStorage = {
                showManualUploadDialog = false
                documentPickerLauncher.launch(arrayOf("*/*"))
            },
            onDismiss = { showManualUploadDialog = false }
        )
    }

    Scaffold(
        topBar = {
            if (selectedTab != 1) {
                TopAppBar(
                    title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Image(
                            painter = painterResource(R.drawable.ic_mydrive_logo),
                            contentDescription = "myDrive",
                            modifier = Modifier
                                .size(32.dp)
                                .clip(RoundedCornerShape(8.dp))
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                text = buildAnnotatedString {
                                    append("my")
                                    withStyle(style = SpanStyle(color = Color(0xFFC084FC))) {
                                        append("Drive")
                                    }
                                },
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 20.sp,
                                color = Color.White
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .clip(CircleShape)
                                    .background(Color(0xFFA855F7))
                            )
                        }
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
        }
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
                    label = { Text("Files", fontSize = 11.sp) },
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
                    label = { Text("Gallery", fontSize = 11.sp) },
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
                    icon = { Icon(Icons.Default.SyncAlt, contentDescription = "Transfers") },
                    label = { Text("Transfers", fontSize = 11.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color.White,
                        selectedTextColor = Color(0xFFA855F7),
                        indicatorColor = Color(0xFF9333EA),
                        unselectedIconColor = Color(0xFF71717A),
                        unselectedTextColor = Color(0xFF71717A)
                    )
                )
                NavigationBarItem(
                    selected = selectedTab == 3,
                    onClick = { selectedTab = 3 },
                    icon = { Icon(Icons.Default.Tune, contentDescription = "Policies") },
                    label = { Text("Policies", fontSize = 11.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color.White,
                        selectedTextColor = Color(0xFFA855F7),
                        indicatorColor = Color(0xFF9333EA),
                        unselectedIconColor = Color(0xFF71717A),
                        unselectedTextColor = Color(0xFF71717A)
                    )
                )
            }
        },
        floatingActionButton = {
            if (selectedTab != 3 && selectedTab != 1 && !(selectedTab == 0 && isFilesSelectionMode)) {
                FloatingActionButton(
                    onClick = { showManualUploadDialog = true },
                    containerColor = Color(0xFFA855F7),
                    contentColor = Color.White,
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (isManualUploading) {
                            CircularProgressIndicator(modifier = Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(uploadStatusText.ifBlank { "Uploading..." }, fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        } else {
                            Icon(Icons.Default.CloudUpload, contentDescription = "Manual Upload", modifier = Modifier.size(20.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Upload", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (!hasMediaPermissions) {
                Surface(
                    color = Color(0xFF2E1065),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                Icons.Default.Warning,
                                contentDescription = "Permission Warning",
                                tint = Color(0xFFFBBF24),
                                modifier = Modifier.size(20.dp)
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text(
                                "Allow gallery access to enable background photo & video sync",
                                fontSize = 12.sp,
                                color = Color(0xFFF4F4F5),
                                lineHeight = 16.sp
                            )
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Button(
                            onClick = { permissionLauncher.launch(requiredPermissions) },
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFA855F7)),
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text("Allow", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        }
                    }
                }
            }

            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
            ) {
                when (selectedTab) {
                    0 -> FilesScreen(
                        storageSummary = storageSummary,
                        files = filesList,
                        folders = foldersList,
                        selectedFolderId = selectedFilterFolderId,
                        onSelectFilterFolder = { selectedFilterFolderId = it },
                        serverUrl = serverUrl,
                        deviceId = deviceId,
                        deviceKey = deviceKey,
                        isRefreshing = isRefreshing,
                        isSelectionMode = isFilesSelectionMode,
                        onSelectionModeChange = { isFilesSelectionMode = it },
                        onOpenFile = { file -> previewItem = file },
                        onRefresh = refreshData
                    )
                    1 -> FullGalleryScreen(
                        mediaList = galleryList,
                        foldersList = foldersList,
                        pairedDevices = pairedDevicesList,
                        serverUrl = serverUrl,
                        deviceId = deviceId,
                        deviceKey = deviceKey,
                        isRefreshing = isRefreshing,
                        onRefresh = refreshData
                    )
                    2 -> TransfersScreen(
                        uploadedFiles = uploadedFilesList,
                        inboundFiles = inboundSyncList,
                        serverUrl = serverUrl,
                        deviceId = deviceId,
                        deviceKey = deviceKey,
                        isRefreshing = isRefreshing,
                        onOpenFile = { file -> previewItem = file },
                        onDownloadToGallery = { item -> downloadInboundItem(item) },
                        onSyncAllToGallery = syncAllToGallery,
                        onRefresh = refreshData,
                        onTriggerUploadGallery = {
                            galleryPickerLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                        },
                        onTriggerUploadFiles = {
                            documentPickerLauncher.launch(arrayOf("*/*"))
                        }
                    )
                    3 -> DeviceAndPolicyScreen(
                        serverUrl = serverUrl,
                        deviceId = deviceId,
                        deviceKey = deviceKey,
                        targetFolderId = targetFolderId,
                        targetFolderName = targetFolderName,
                        wifiOnly = wifiOnly,
                        chargingOnly = chargingOnly,
                        syncPhotos = syncPhotos,
                        syncVideos = syncVideos,
                        syncDocuments = syncDocuments,
                        lastSyncTimestamp = lastSyncTimestamp,
                        totalSyncedCount = totalSyncedCount,
                        lastSyncStatus = lastSyncStatus,
                        pairedDevices = pairedDevicesList,
                        pairedRules = pairedRulesMap.values.toList(),
                        isSavingPolicy = isSavingPolicy,
                        onServerUrlChange = { serverUrl = it; saveCredentials() },
                        onDeviceIdChange = { deviceId = it; saveCredentials() },
                        onDeviceKeyChange = { deviceKey = it; saveCredentials() },
                        onWifiOnlyChange = { wifiOnly = it; saveCredentials() },
                        onChargingOnlyChange = { chargingOnly = it; saveCredentials() },
                        onSyncPhotosChange = { syncPhotos = it; saveCredentials() },
                        onSyncVideosChange = { syncVideos = it; saveCredentials() },
                        onSyncDocumentsChange = { syncDocuments = it; saveCredentials() },
                        onUpdatePairedRule = { sId, updatedRule ->
                            pairedRulesMap[sId] = updatedRule
                            savePairedRulesToPrefs()
                        },
                        onSavePolicy = savePolicyAction,
                        onOpenFolderDialog = { showFolderDialog = true },
                        onSyncNow = {
                            saveCredentials()
                            performInProcessSync()
                        },
                        onScheduleSync = {
                            saveCredentials()
                            onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments)
                        },
                        isSyncingNow = isSyncingNow,
                        syncStatusText = syncStatusText,
                        syncLogLines = syncLogLines
                    )
                }
            }
        }
    }
}

// ----------------------------------------------------
// TAB 0: Files & Storage Pool Explorer
// ----------------------------------------------------
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun FilesScreen(
    storageSummary: StoragePoolSummary?,
    files: List<CloudFile>,
    folders: List<CloudFolder>,
    selectedFolderId: String?,
    onSelectFilterFolder: (String?) -> Unit,
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    isRefreshing: Boolean,
    isSelectionMode: Boolean = false,
    onSelectionModeChange: (Boolean) -> Unit = {},
    onOpenFile: (CloudFile) -> Unit,
    onRefresh: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    val selectedFileIds = remember { mutableStateListOf<String>() }

    var selectedFileForMenu by remember { mutableStateOf<CloudFile?>(null) }
    var selectedFolderForMenu by remember { mutableStateOf<CloudFolder?>(null) }
    var fileToRename by remember { mutableStateOf<CloudFile?>(null) }
    var newFileName by remember { mutableStateOf("") }
    var fileToShowDetails by remember { mutableStateOf<CloudFile?>(null) }
    var showMoveDialog by remember { mutableStateOf(false) }
    var folderToDelete by remember { mutableStateOf<CloudFolder?>(null) }
    var folderToRename by remember { mutableStateOf<CloudFolder?>(null) }
    var renameFolderNameInput by remember { mutableStateOf("") }
    
    var showHeaderMenu by remember { mutableStateOf(false) }

    val filteredFiles = remember(files, selectedFolderId) {
        if (selectedFolderId == null) {
            files
        } else {
            files.filter { it.folderId == selectedFolderId }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
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
                                    modifier = Modifier.combinedClickable(
                                        onClick = { onSelectFilterFolder(folder.id) },
                                        onLongClick = { selectedFolderForMenu = folder }
                                    )
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
                    val headerText = if (isSelectionMode) {
                        "${selectedFileIds.size} Selected"
                    } else {
                        "Cloud Files (${filteredFiles.size})"
                    }
                    Text(
                        text = headerText,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White
                    )
                    
                    Box {
                        IconButton(onClick = { showHeaderMenu = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "Menu", tint = Color.White)
                        }
                        DropdownMenu(
                            expanded = showHeaderMenu,
                            onDismissRequest = { showHeaderMenu = false },
                            modifier = Modifier.background(Color(0xFF1C1C28))
                        ) {
                            DropdownMenuItem(
                                text = { Text("Select Mode", color = Color.White) },
                                onClick = {
                                    onSelectionModeChange(true)
                                    showHeaderMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Select All", color = Color.White) },
                                onClick = {
                                    onSelectionModeChange(true)
                                    selectedFileIds.clear()
                                    selectedFileIds.addAll(filteredFiles.map { it.id })
                                    showHeaderMenu = false
                                }
                            )
                            DropdownMenuItem(
                                text = { Text("Refresh", color = Color.White) },
                                onClick = {
                                    onRefresh()
                                    showHeaderMenu = false
                                }
                            )
                        }
                    }
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

            items(filteredFiles, key = { it.id }) { file ->
                val isSelected = selectedFileIds.contains(file.id)
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .combinedClickable(
                            onClick = {
                                if (isSelectionMode) {
                                    if (isSelected) selectedFileIds.remove(file.id) else selectedFileIds.add(file.id)
                                    if (selectedFileIds.isEmpty()) onSelectionModeChange(false)
                                } else {
                                    onOpenFile(file)
                                }
                            },
                            onLongClick = {
                                if (isSelectionMode) {
                                    if (isSelected) selectedFileIds.remove(file.id) else selectedFileIds.add(file.id)
                                    if (selectedFileIds.isEmpty()) onSelectionModeChange(false)
                                } else {
                                    selectedFileForMenu = file
                                }
                            }
                        ),
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = if (isSelected) Color(0xFF26193E) else Color(0xFF14141C)),
                    border = if (isSelected) BorderStroke(1.dp, Color(0xFFA855F7)) else null
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
                            if (isSelectionMode) {
                                Checkbox(
                                    checked = isSelected,
                                    onCheckedChange = null,
                                    colors = CheckboxDefaults.colors(
                                        checkedColor = Color(0xFFA855F7),
                                        uncheckedColor = Color(0xFF71717A)
                                    )
                                )
                            } else {
                                Icon(icon, contentDescription = null, tint = iconTint, modifier = Modifier.size(20.dp))
                            }
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
                        
                        if (!isSelectionMode) {
                            IconButton(onClick = { selectedFileForMenu = file }, modifier = Modifier.size(36.dp)) {
                                Icon(
                                    Icons.Default.MoreVert,
                                    contentDescription = "More options",
                                    tint = Color(0xFF94A3B8),
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    }
                }
            }
            
            if (isSelectionMode) {
                item { Spacer(modifier = Modifier.height(80.dp)) }
            }
        }

        // Floating Selection Bar
        if (isSelectionMode && selectedFileIds.isNotEmpty()) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 16.dp, start = 16.dp, end = 16.dp)
                    .fillMaxWidth()
            ) {
                Surface(
                    shape = RoundedCornerShape(24.dp),
                    color = Color(0xFF26193E),
                    shadowElevation = 8.dp,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        IconButton(onClick = {
                            if (selectedFileIds.size == filteredFiles.size) {
                                selectedFileIds.clear()
                                onSelectionModeChange(false)
                            } else {
                                selectedFileIds.clear()
                                selectedFileIds.addAll(filteredFiles.map { it.id })
                            }
                        }) {
                            Icon(Icons.Default.SelectAll, contentDescription = "Select All", tint = Color(0xFFA855F7))
                        }
                        IconButton(onClick = {
                            val itemsToDownload = filteredFiles.filter { it.id in selectedFileIds }
                            itemsToDownload.forEach { f ->
                                val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${f.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
                                downloadFileToDevice(context, streamUrl, f.filename, deviceId, deviceKey)
                            }
                            onSelectionModeChange(false)
                            selectedFileIds.clear()
                        }) {
                            Icon(Icons.Default.Download, contentDescription = "Download", tint = Color(0xFFA855F7))
                        }
                        IconButton(onClick = {
                            coroutineScope.launch {
                                apiBulkAction(serverUrl, deviceId, deviceKey, "favorite", selectedFileIds.toList())
                                onRefresh()
                                onSelectionModeChange(false)
                                selectedFileIds.clear()
                            }
                        }) {
                            Icon(Icons.Default.Star, contentDescription = "Favorite", tint = Color.White)
                        }
                        IconButton(onClick = { showMoveDialog = true }) {
                            Icon(Icons.Default.DriveFileMove, contentDescription = "Move", tint = Color.White)
                        }
                        IconButton(onClick = {
                            coroutineScope.launch {
                                apiBulkAction(serverUrl, deviceId, deviceKey, "trash", selectedFileIds.toList())
                                onRefresh()
                                onSelectionModeChange(false)
                                selectedFileIds.clear()
                            }
                        }) {
                            Icon(Icons.Default.Delete, contentDescription = "Trash", tint = Color.Red)
                        }
                        IconButton(onClick = {
                            onSelectionModeChange(false)
                            selectedFileIds.clear()
                        }) {
                            Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                        }
                    }
                }
            }
        }
    }

    // Context Menu Bottom Sheet / Dialog
    if (selectedFileForMenu != null) {
        val file = selectedFileForMenu!!
        AlertDialog(
            onDismissRequest = { selectedFileForMenu = null },
            containerColor = Color(0xFF1C1C28),
            title = { Text(file.filename, color = Color.White, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            text = {
                Column {
                    DropdownMenuItem(
                        text = { Text("Select", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFFA855F7)) },
                        onClick = {
                            onSelectionModeChange(true)
                            if (!selectedFileIds.contains(file.id)) {
                                selectedFileIds.add(file.id)
                            }
                            selectedFileForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Download to Phone", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.Download, contentDescription = null, tint = Color.White) },
                        onClick = {
                            val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${file.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
                            downloadFileToDevice(context, streamUrl, file.filename, deviceId, deviceKey)
                            selectedFileForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Rename", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null, tint = Color.White) },
                        onClick = {
                            fileToRename = file
                            newFileName = file.filename
                            selectedFileForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Move to Folder", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.DriveFileMove, contentDescription = null, tint = Color.White) },
                        onClick = {
                            selectedFileIds.clear()
                            selectedFileIds.add(file.id)
                            showMoveDialog = true
                            selectedFileForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Favorite / Unfavorite", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.Star, contentDescription = null, tint = Color.White) },
                        onClick = {
                            coroutineScope.launch {
                                apiToggleFavorite(serverUrl, deviceId, deviceKey, file.id, true)
                                onRefresh()
                            }
                            selectedFileForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Move to Trash", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = Color.White) },
                        onClick = {
                            coroutineScope.launch {
                                apiTrashFile(serverUrl, deviceId, deviceKey, file.id)
                                onRefresh()
                            }
                            selectedFileForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("File Details", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.Info, contentDescription = null, tint = Color.White) },
                        onClick = {
                            fileToShowDetails = file
                            selectedFileForMenu = null
                        }
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { selectedFileForMenu = null }) {
                    Text("Close", color = Color(0xFFA855F7))
                }
            }
        )
    }

    if (fileToRename != null) {
        AlertDialog(
            onDismissRequest = { fileToRename = null },
            containerColor = Color(0xFF14141C),
            title = { Text("Rename File", color = Color.White) },
            text = {
                OutlinedTextField(
                    value = newFileName,
                    onValueChange = { newFileName = it },
                    label = { Text("Filename") },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = Color(0xFFA855F7),
                        unfocusedBorderColor = Color(0xFF2E2E3E),
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White
                    )
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    val f = fileToRename!!
                    coroutineScope.launch {
                        apiRenameFile(serverUrl, deviceId, deviceKey, f.id, newFileName)
                        onRefresh()
                    }
                    fileToRename = null
                }) {
                    Text("Rename", color = Color(0xFFA855F7))
                }
            },
            dismissButton = {
                TextButton(onClick = { fileToRename = null }) {
                    Text("Cancel", color = Color(0xFF94A3B8))
                }
            }
        )
    }

    if (fileToShowDetails != null) {
        val f = fileToShowDetails!!
        AlertDialog(
            onDismissRequest = { fileToShowDetails = null },
            containerColor = Color(0xFF14141C),
            title = { Text("File Details", color = Color.White) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Name: ${f.filename}", color = Color.White)
                    Text("Type: ${f.mimeType}", color = Color.White)
                    Text("Size: ${formatBytes(f.sizeBytes)}", color = Color.White)
                    Text("Created: ${f.createdAt}", color = Color.White)
                    Text("Folder ID: ${f.folderId ?: "None"}", color = Color.White)
                }
            },
            confirmButton = {
                TextButton(onClick = { fileToShowDetails = null }) {
                    Text("Close", color = Color(0xFFA855F7))
                }
            }
        )
    }

    if (showMoveDialog) {
        FolderPickerDialog(
            folders = folders,
            currentFolderId = "", 
            onSelectFolder = { folderId, _ ->
                coroutineScope.launch {
                    if (selectedFileIds.isNotEmpty()) {
                        apiBulkAction(serverUrl, deviceId, deviceKey, "move", selectedFileIds.toList(), folderId)
                    }
                    onRefresh()
                    onSelectionModeChange(false)
                    selectedFileIds.clear()
                }
                showMoveDialog = false
            },
            onCreateFolder = { folderName ->
            },
            onDismiss = { showMoveDialog = false }
        )
    }
    
    if (selectedFolderForMenu != null) {
        val f = selectedFolderForMenu!!
        AlertDialog(
            onDismissRequest = { selectedFolderForMenu = null },
            containerColor = Color(0xFF1C1C28),
            title = { Text(f.name, color = Color.White) },
            text = {
                Column {
                    DropdownMenuItem(
                        text = { Text("Open Folder", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.FolderOpen, contentDescription = null, tint = Color(0xFFFBBF24)) },
                        onClick = {
                            onSelectFilterFolder(f.id)
                            selectedFolderForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Rename Folder", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null, tint = Color(0xFFF59E0B)) },
                        onClick = {
                            folderToRename = f
                            renameFolderNameInput = f.name
                            selectedFolderForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Delete Folder", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = Color.Red) },
                        onClick = {
                            folderToDelete = f
                            selectedFolderForMenu = null
                        }
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { selectedFolderForMenu = null }) {
                    Text("Close", color = Color(0xFFA855F7))
                }
            }
        )
    }

    if (folderToRename != null) {
        val f = folderToRename!!
        AlertDialog(
            onDismissRequest = { folderToRename = null },
            containerColor = Color(0xFF14141C),
            title = { Text("Rename Folder", color = Color.White) },
            text = {
                OutlinedTextField(
                    value = renameFolderNameInput,
                    onValueChange = { renameFolderNameInput = it },
                    label = { Text("Folder Name", color = Color(0xFF94A3B8)) },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedBorderColor = Color(0xFFA855F7),
                        unfocusedBorderColor = Color(0xFF333340)
                    ),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val newName = renameFolderNameInput.trim()
                        if (newName.isNotEmpty() && newName != f.name) {
                            coroutineScope.launch {
                                apiRenameFolder(serverUrl, deviceId, deviceKey, f.id, newName)
                                onRefresh()
                            }
                        }
                        folderToRename = null
                    },
                    enabled = renameFolderNameInput.isNotBlank() && renameFolderNameInput.trim() != f.name
                ) {
                    Text("Rename", color = Color(0xFFA855F7))
                }
            },
            dismissButton = {
                TextButton(onClick = { folderToRename = null }) {
                    Text("Cancel", color = Color(0xFF94A3B8))
                }
            }
        )
    }

    if (folderToDelete != null) {
        val f = folderToDelete!!
        AlertDialog(
            onDismissRequest = { folderToDelete = null },
            containerColor = Color(0xFF14141C),
            title = { Text("Delete Folder", color = Color.White) },
            text = { Text("Are you sure you want to delete '${f.name}'? Files inside might be orphaned.", color = Color.White) },
            confirmButton = {
                TextButton(onClick = {
                    coroutineScope.launch {
                        apiDeleteFolder(serverUrl, deviceId, deviceKey, f.id)
                        onRefresh()
                    }
                    folderToDelete = null
                }) {
                    Text("Delete", color = Color.Red)
                }
            },
            dismissButton = {
                TextButton(onClick = { folderToDelete = null }) {
                    Text("Cancel", color = Color(0xFF94A3B8))
                }
            }
        )
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
    FullGalleryScreen(
        mediaList = mediaList,
        foldersList = emptyList(),
        pairedDevices = emptyList(),
        serverUrl = serverUrl,
        deviceId = deviceId,
        deviceKey = deviceKey,
        isRefreshing = isRefreshing,
        onRefresh = onRefresh
    )
}

// ----------------------------------------------------
// TAB 2: Activity & Transfers Screen
// ----------------------------------------------------
@Composable
fun TransfersScreen(
    uploadedFiles: List<DeviceUploadItem>,
    inboundFiles: List<InboundSyncItem>,
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    isRefreshing: Boolean,
    onOpenFile: (CloudFile) -> Unit,
    onDownloadToGallery: (InboundSyncItem) -> Unit,
    onSyncAllToGallery: () -> Unit,
    onRefresh: () -> Unit,
    onTriggerUploadGallery: (() -> Unit)? = null,
    onTriggerUploadFiles: (() -> Unit)? = null
) {
    var subTab by remember { mutableIntStateOf(0) } // 0: Uploaded by Device, 1: Synced to Gallery
    var selectedCategory by remember { mutableStateOf("All") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF0D0D11))
    ) {
        // Segmented Control Header
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 10.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(Color(0xFF181822))
                .padding(4.dp)
        ) {
            // Tab 0: Uploaded by this Device
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { subTab = 0; selectedCategory = "All" },
                color = if (subTab == 0) Color(0xFF9333EA) else Color.Transparent
            ) {
                Row(
                    modifier = Modifier.padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.CloudUpload,
                        contentDescription = null,
                        tint = if (subTab == 0) Color.White else Color(0xFF94A3B8),
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Uploaded (${uploadedFiles.size})",
                        color = if (subTab == 0) Color.White else Color(0xFF94A3B8),
                        fontSize = 12.sp,
                        fontWeight = if (subTab == 0) FontWeight.Bold else FontWeight.Medium
                    )
                }
            }

            // Tab 1: Synced & In Gallery
            Surface(
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(10.dp))
                    .clickable { subTab = 1; selectedCategory = "All" },
                color = if (subTab == 1) Color(0xFF9333EA) else Color.Transparent
            ) {
                Row(
                    modifier = Modifier.padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.CloudDownload,
                        contentDescription = null,
                        tint = if (subTab == 1) Color.White else Color(0xFF94A3B8),
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Synced (${inboundFiles.size})",
                        color = if (subTab == 1) Color.White else Color(0xFF94A3B8),
                        fontSize = 12.sp,
                        fontWeight = if (subTab == 1) FontWeight.Bold else FontWeight.Medium
                    )
                }
            }
        }

        // Category Filter Chips
        val categories = listOf("All", "Photos", "Videos", "Documents")
        LazyRow(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 2.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(categories) { cat ->
                val isSelected = selectedCategory == cat
                Surface(
                    modifier = Modifier
                        .clip(RoundedCornerShape(16.dp))
                        .clickable { selectedCategory = cat },
                    color = if (isSelected) Color(0xFF26193E) else Color(0xFF14141C),
                    border = BorderStroke(1.dp, if (isSelected) Color(0xFFA855F7) else Color(0xFF242432))
                ) {
                    Text(
                        text = cat,
                        color = if (isSelected) Color(0xFFD8B4FE) else Color(0xFF94A3B8),
                        fontSize = 11.sp,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp)
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        if (subTab == 0) {
            // ---------------- SUBVIEW 0: UPLOADED BY THIS DEVICE ----------------
            // Quick manual upload action row
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = { onTriggerUploadGallery?.invoke() },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF26193E)),
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = Color(0xFFA855F7), modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Upload Gallery", color = Color(0xFFE9D5FF), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }

                Button(
                    onClick = { onTriggerUploadFiles?.invoke() },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0F2338)),
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.Folder, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Upload Files", color = Color(0xFFBAE6FD), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                }
            }

            val filteredUploads = remember(uploadedFiles, selectedCategory) {
                when (selectedCategory) {
                    "Photos" -> uploadedFiles.filter { it.mimeType.startsWith("image/") }
                    "Videos" -> uploadedFiles.filter { it.mimeType.startsWith("video/") }
                    "Documents" -> uploadedFiles.filter { !it.mimeType.startsWith("image/") && !it.mimeType.startsWith("video/") }
                    else -> uploadedFiles
                }
            }

            if (filteredUploads.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(28.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.CloudUpload, contentDescription = null, tint = Color(0xFFA855F7), modifier = Modifier.size(48.dp))
                        Spacer(modifier = Modifier.height(12.dp))
                        Text("No uploads found yet", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Docs & media uploaded by this phone will appear here.\nTap below to manually upload existing pictures or files:",
                            color = Color(0xFF71717A),
                            fontSize = 12.sp,
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                        Spacer(modifier = Modifier.height(16.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = { onTriggerUploadGallery?.invoke() },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFA855F7)),
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Icon(Icons.Default.PhotoLibrary, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("From Gallery", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                            Button(
                                onClick = { onTriggerUploadFiles?.invoke() },
                                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF0284C7)),
                                shape = RoundedCornerShape(10.dp)
                            ) {
                                Icon(Icons.Default.Folder, contentDescription = null, modifier = Modifier.size(16.dp))
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("From Storage", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filteredUploads) { item ->
                        val isImage = item.mimeType.startsWith("image/")
                        val isVideo = item.mimeType.startsWith("video/")
                        val thumbUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"

                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onOpenFile(
                                        CloudFile(
                                            id = item.id,
                                            filename = item.filename,
                                            mimeType = item.mimeType,
                                            sizeBytes = item.sizeBytes,
                                            createdAt = item.createdAt,
                                            folderId = null
                                        )
                                    )
                                },
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                // Thumbnail / Icon
                                Box(
                                    modifier = Modifier
                                        .size(44.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(Color(0xFF1C1C28)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (isImage) {
                                        AsyncImage(
                                            model = ImageRequest.Builder(LocalContext.current)
                                                .data(thumbUrl)
                                                .addHeader("x-device-id", deviceId)
                                                .addHeader("x-device-key", deviceKey)
                                                .size(Size(120, 120))
                                                .precision(Precision.INEXACT)
                                                .memoryCacheKey("thumb_${item.id}")
                                                .diskCacheKey("thumb_${item.id}")
                                                .crossfade(false)
                                                .build(),
                                            contentDescription = item.filename,
                                            modifier = Modifier.fillMaxSize(),
                                            contentScale = ContentScale.Crop
                                        )
                                    } else if (isVideo) {
                                        Icon(Icons.Default.Movie, contentDescription = null, tint = Color(0xFFA855F7), modifier = Modifier.size(24.dp))
                                    } else {
                                        Icon(Icons.Default.Description, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(24.dp))
                                    }
                                }

                                Spacer(modifier = Modifier.width(12.dp))

                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = item.filename,
                                        color = Color.White,
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 13.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = "${formatBytes(item.sizeBytes)} • ${item.folderName?.let { "Folder: $it" } ?: "Root"}",
                                        color = Color(0xFF71717A),
                                        fontSize = 11.sp
                                    )
                                }

                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = Color(0xFF26193E)
                                ) {
                                    Text(
                                        text = "Cloud Stored",
                                        color = Color(0xFFC084FC),
                                        fontSize = 10.sp,
                                        fontWeight = FontWeight.Bold,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        } else {
            // ---------------- SUBVIEW 1: SYNCED TO DEVICE & IN GALLERY ----------------
            val filteredInbound = remember(inboundFiles, selectedCategory) {
                when (selectedCategory) {
                    "Photos" -> inboundFiles.filter { it.mimeType.startsWith("image/") }
                    "Videos" -> inboundFiles.filter { it.mimeType.startsWith("video/") }
                    "Documents" -> inboundFiles.filter { !it.mimeType.startsWith("image/") && !it.mimeType.startsWith("video/") }
                    else -> inboundFiles
                }
            }

            // Sync All to Gallery Action Header
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF161622))
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text("Paired Devices Inbound Sync", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color.White)
                        Text("Docs & media from paired devices synced to this phone", fontSize = 10.sp, color = Color(0xFF94A3B8))
                    }
                    Button(
                        onClick = onSyncAllToGallery,
                        shape = RoundedCornerShape(10.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFA855F7)),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Icon(Icons.Default.Download, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Sync to Gallery", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }

            if (filteredInbound.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.CloudDownload, contentDescription = null, tint = Color(0xFF52525B), modifier = Modifier.size(48.dp))
                        Spacer(modifier = Modifier.height(12.dp))
                        Text("No paired files to sync", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Spacer(modifier = Modifier.height(4.dp))
                        Text("Files uploaded from your other paired devices will appear here.", color = Color(0xFF71717A), fontSize = 12.sp)
                    }
                }
            } else {
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(horizontal = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(filteredInbound) { item ->
                        val isImage = item.mimeType.startsWith("image/")
                        val isVideo = item.mimeType.startsWith("video/")
                        val thumbUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"

                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable {
                                    onOpenFile(
                                        CloudFile(
                                            id = item.id,
                                            filename = item.filename,
                                            mimeType = item.mimeType,
                                            sizeBytes = item.sizeBytes,
                                            createdAt = item.createdAt,
                                            folderId = null
                                        )
                                    )
                                },
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
                        ) {
                            Row(
                                modifier = Modifier.padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                // Thumbnail / Icon
                                Box(
                                    modifier = Modifier
                                        .size(44.dp)
                                        .clip(RoundedCornerShape(10.dp))
                                        .background(Color(0xFF1C1C28)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    if (isImage) {
                                        AsyncImage(
                                            model = ImageRequest.Builder(LocalContext.current)
                                                .data(thumbUrl)
                                                .addHeader("x-device-id", deviceId)
                                                .addHeader("x-device-key", deviceKey)
                                                .size(Size(120, 120))
                                                .precision(Precision.INEXACT)
                                                .memoryCacheKey("thumb_${item.id}")
                                                .diskCacheKey("thumb_${item.id}")
                                                .crossfade(false)
                                                .build(),
                                            contentDescription = item.filename,
                                            modifier = Modifier.fillMaxSize(),
                                            contentScale = ContentScale.Crop
                                        )
                                    } else if (isVideo) {
                                        Icon(Icons.Default.Movie, contentDescription = null, tint = Color(0xFFA855F7), modifier = Modifier.size(24.dp))
                                    } else {
                                        Icon(Icons.Default.Description, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(24.dp))
                                    }
                                }

                                Spacer(modifier = Modifier.width(12.dp))

                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = item.filename,
                                        color = Color.White,
                                        fontWeight = FontWeight.SemiBold,
                                        fontSize = 13.sp,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text(
                                            text = formatBytes(item.sizeBytes),
                                            color = Color(0xFF71717A),
                                            fontSize = 11.sp
                                        )
                                        Spacer(modifier = Modifier.width(6.dp))
                                        Surface(
                                            shape = RoundedCornerShape(6.dp),
                                            color = Color(0xFF222230)
                                        ) {
                                            Text(
                                                text = "From: ${item.sourceDeviceLabel}",
                                                color = Color(0xFFC084FC),
                                                fontSize = 9.sp,
                                                fontWeight = FontWeight.Medium,
                                                modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp)
                                            )
                                        }
                                    }
                                }

                                IconButton(
                                    onClick = { onDownloadToGallery(item) }
                                ) {
                                    Icon(
                                        if (item.isDownloadedLocally) Icons.Default.CheckCircle else Icons.Default.Download,
                                        contentDescription = "Save to Gallery",
                                        tint = if (item.isDownloadedLocally) Color(0xFF34D399) else Color(0xFFA855F7),
                                        modifier = Modifier.size(22.dp)
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ----------------------------------------------------
// TAB 3: Device & Personalized Policies Screen
// ----------------------------------------------------
@Composable
fun DeviceAndPolicyScreen(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    targetFolderId: String,
    targetFolderName: String,
    wifiOnly: Boolean,
    chargingOnly: Boolean,
    syncPhotos: Boolean,
    syncVideos: Boolean,
    syncDocuments: Boolean,
    lastSyncTimestamp: Long,
    totalSyncedCount: Int,
    lastSyncStatus: String,
    pairedDevices: List<PairedDevice>,
    pairedRules: List<PairedDeviceRule>,
    isSavingPolicy: Boolean,
    onServerUrlChange: (String) -> Unit,
    onDeviceIdChange: (String) -> Unit,
    onDeviceKeyChange: (String) -> Unit,
    onWifiOnlyChange: (Boolean) -> Unit,
    onChargingOnlyChange: (Boolean) -> Unit,
    onSyncPhotosChange: (Boolean) -> Unit,
    onSyncVideosChange: (Boolean) -> Unit,
    onSyncDocumentsChange: (Boolean) -> Unit,
    onUpdatePairedRule: (String, PairedDeviceRule) -> Unit,
    onSavePolicy: () -> Unit,
    onOpenFolderDialog: () -> Unit,
    onSyncNow: () -> Unit,
    onScheduleSync: () -> Unit,
    isSyncingNow: Boolean = false,
    syncStatusText: String = "",
    syncLogLines: List<String> = emptyList()
) {
    val scrollState = rememberScrollState()
    val isPaired = deviceId.isNotBlank() && deviceKey.isNotBlank()
    var showCredentials by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        // Device Status Card
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

                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = onSyncNow,
                        modifier = Modifier.weight(1f),
                        enabled = isPaired && !isSyncingNow
                    ) {
                        if (isSyncingNow) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = Color(0xFFA855F7),
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Syncing...")
                        } else {
                            Icon(Icons.Default.Sync, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Sync Now")
                        }
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

        // ── Live Sync Progress Panel ───────────────────────────────────────
        if (isSyncingNow || syncLogLines.isNotEmpty()) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(18.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF0F1A0F))
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    // Header row
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        if (isSyncingNow) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(16.dp),
                                color = Color(0xFF34D399),
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                        } else {
                            Icon(
                                Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = Color(0xFF34D399),
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                        }
                        Text(
                            text = if (isSyncingNow) "Sync in progress" else "Last sync log",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF6EE7B7)
                        )
                    }

                    // Status / current file line
                    if (syncStatusText.isNotBlank()) {
                        Spacer(modifier = Modifier.height(10.dp))
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = Color(0xFF1A2D1A)
                        ) {
                            Text(
                                text = syncStatusText,
                                fontSize = 12.sp,
                                color = Color(0xFFD1FAE5),
                                lineHeight = 18.sp,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                            )
                        }
                    }

                    // Per-file log (newest first, max 20 lines visible)
                    if (syncLogLines.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(10.dp))
                        HorizontalDivider(color = Color(0xFF1F2E1F))
                        Spacer(modifier = Modifier.height(8.dp))
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 200.dp)
                                .verticalScroll(rememberScrollState())
                        ) {
                            syncLogLines.take(50).forEach { line ->
                                val (color, icon) = when {
                                    line.startsWith("✓") -> Pair(Color(0xFF86EFAC), "")
                                    line.startsWith("⏩") -> Pair(Color(0xFF6B7280), "")
                                    line.startsWith("✗") -> Pair(Color(0xFFFCA5A5), "")
                                    line.startsWith("❌") -> Pair(Color(0xFFEF4444), "")
                                    line.startsWith("✅") -> Pair(Color(0xFF34D399), "")
                                    line.startsWith("──") || line.startsWith("═") -> Pair(Color(0xFF4B5563), "")
                                    else -> Pair(Color(0xFF9CA3AF), "")
                                }
                                Text(
                                    text = line,
                                    fontSize = 11.sp,
                                    color = color,
                                    lineHeight = 16.sp,
                                    modifier = Modifier.padding(vertical = 1.dp)
                                )
                            }
                        }
                    }
                }
            }
        } else if (lastSyncStatus.isNotBlank() && lastSyncStatus != "Never synced") {
            // Compact status when idle and a previous sync exists
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = Color(0xFF13131A),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Default.Info, contentDescription = null, tint = Color(0xFF6B7280), modifier = Modifier.size(14.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = lastSyncStatus,
                        fontSize = 12.sp,
                        color = Color(0xFF9CA3AF),
                        lineHeight = 16.sp
                    )
                }
            }
        }

        // Auto Sync info chip
        Surface(
            shape = RoundedCornerShape(10.dp),
            color = Color(0xFF1E1830),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(Icons.Default.Schedule, contentDescription = null, tint = Color(0xFF7C3AED), modifier = Modifier.size(14.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Auto sync runs twice a day (every 12 hours) in the background to save battery.",
                    fontSize = 12.sp,
                    color = Color(0xFF9CA3AF),
                    lineHeight = 17.sp
                )
            }
        }
        // ──────────────────────────────────────────────────────────────────

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
                                .size(40.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(Color(0xFF26193E)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.Default.FolderSpecial,
                                contentDescription = null,
                                tint = Color(0xFFA855F7),
                                modifier = Modifier.size(22.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text("Upload Destination Folder", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text(
                                text = "Selected: $targetFolderName",
                                fontSize = 11.sp,
                                color = Color(0xFFC084FC),
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    Button(
                        onClick = onOpenFolderDialog,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF26193E)),
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Text("Change", color = Color(0xFFE9D5FF), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
        }

        // Personalized Outbound Policy Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text("Personalized Outbound Policy", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
                Text("Specify which file types this phone backs up to cloud storage:", fontSize = 11.sp, color = Color(0xFF71717A))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Image, contentDescription = null, tint = Color(0xFFA855F7), modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Sync Photos & Pictures", fontSize = 13.sp, color = Color(0xFFE4E4E7))
                    }
                    Switch(checked = syncPhotos, onCheckedChange = onSyncPhotosChange)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Movie, contentDescription = null, tint = Color(0xFFA855F7), modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Sync Videos", fontSize = 13.sp, color = Color(0xFFE4E4E7))
                    }
                    Switch(checked = syncVideos, onCheckedChange = onSyncVideosChange)
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Description, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Sync Documents (PDF, Docs)", fontSize = 13.sp, color = Color(0xFFE4E4E7))
                    }
                    Switch(checked = syncDocuments, onCheckedChange = onSyncDocumentsChange)
                }

                HorizontalDivider(color = Color(0xFF22222E), modifier = Modifier.padding(vertical = 4.dp))

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
            }
        }

        // Paired Devices Inbound Sync Policy Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Devices, contentDescription = null, tint = Color(0xFFA855F7), modifier = Modifier.size(20.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text("Paired Devices Inbound Policy", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text("Filter what files sync from each paired device", fontSize = 11.sp, color = Color(0xFF71717A))
                        }
                    }
                }

                if (pairedDevices.isEmpty()) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 12.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No other devices paired yet.\nPair your laptop or other phones to configure per-device policies.",
                            fontSize = 12.sp,
                            color = Color(0xFF71717A),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center
                        )
                    }
                } else {
                    pairedDevices.forEach { pDev ->
                        val rule = pairedRules.find { it.sourceDeviceId == pDev.deviceId }
                            ?: PairedDeviceRule(
                                sourceDeviceId = pDev.deviceId,
                                sourceDeviceName = pDev.deviceName,
                                syncPhotos = false,
                                syncVideos = false,
                                syncDocuments = false,
                                autoDownloadToGallery = false
                            )

                        Card(
                            modifier = Modifier.fillMaxWidth(),
                            shape = RoundedCornerShape(14.dp),
                            colors = CardDefaults.cardColors(containerColor = Color(0xFF1C1C28))
                        ) {
                            Column(
                                modifier = Modifier.padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(
                                            if (pDev.deviceType == "mobile") Icons.Default.Smartphone else Icons.Default.Laptop,
                                            contentDescription = null,
                                            tint = Color(0xFF38BDF8),
                                            modifier = Modifier.size(18.dp)
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Column {
                                            Text(pDev.deviceName, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color.White)
                                            Text("ID: ${pDev.deviceId.take(12)}...", fontSize = 10.sp, color = Color(0xFF71717A))
                                        }
                                    }

                                    Surface(
                                        shape = CircleShape,
                                        color = if (pDev.status == "online") Color(0xFF064E3B) else Color(0xFF27272A)
                                    ) {
                                        Text(
                                            text = pDev.status.uppercase(),
                                            fontSize = 9.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = if (pDev.status == "online") Color(0xFF6EE7B7) else Color(0xFF71717A),
                                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp)
                                        )
                                    }
                                }

                                HorizontalDivider(color = Color(0xFF2E2E3E), modifier = Modifier.padding(vertical = 2.dp))

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Sync Photos", fontSize = 12.sp, color = Color(0xFFE4E4E7))
                                    Switch(
                                        checked = rule.syncPhotos,
                                        onCheckedChange = { chk ->
                                            onUpdatePairedRule(pDev.deviceId, rule.copy(syncPhotos = chk))
                                        }
                                    )
                                }

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Sync Videos", fontSize = 12.sp, color = Color(0xFFE4E4E7))
                                    Switch(
                                        checked = rule.syncVideos,
                                        onCheckedChange = { chk ->
                                            onUpdatePairedRule(pDev.deviceId, rule.copy(syncVideos = chk))
                                        }
                                    )
                                }

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Sync Documents (PDF/Docs)", fontSize = 12.sp, color = Color(0xFFE4E4E7))
                                    Switch(
                                        checked = rule.syncDocuments,
                                        onCheckedChange = { chk ->
                                            onUpdatePairedRule(pDev.deviceId, rule.copy(syncDocuments = chk))
                                        }
                                    )
                                }

                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text("Auto Download to Phone Gallery", fontSize = 12.sp, color = Color(0xFFA855F7), fontWeight = FontWeight.SemiBold)
                                    Switch(
                                        checked = rule.autoDownloadToGallery,
                                        onCheckedChange = { chk ->
                                            onUpdatePairedRule(pDev.deviceId, rule.copy(autoDownloadToGallery = chk))
                                        }
                                    )
                                }
                            }
                        }
                    }
                }

                Button(
                    onClick = onSavePolicy,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = isPaired && !isSavingPolicy,
                    shape = RoundedCornerShape(12.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFA855F7))
                ) {
                    if (isSavingPolicy) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Saving Policy to Cloud...")
                    } else {
                        Icon(Icons.Default.CloudUpload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Save Personalized Policy to Cloud", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
        }

        // Connection & Device Credentials Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(18.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF14141C))
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Backend & Device Credentials", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
                    TextButton(onClick = { showCredentials = !showCredentials }) {
                        Text(if (showCredentials) "Hide" else "Show / Edit", color = Color(0xFFA855F7), fontSize = 12.sp)
                    }
                }

                if (showCredentials) {
                    OutlinedTextField(
                        value = serverUrl,
                        onValueChange = onServerUrlChange,
                        label = { Text("Server Backend URL") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFFA855F7),
                            unfocusedBorderColor = Color(0xFF2E2E3E)
                        )
                    )

                    OutlinedTextField(
                        value = deviceId,
                        onValueChange = onDeviceIdChange,
                        label = { Text("Device ID") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFFA855F7),
                            unfocusedBorderColor = Color(0xFF2E2E3E)
                        )
                    )

                    OutlinedTextField(
                        value = deviceKey,
                        onValueChange = onDeviceKeyChange,
                        label = { Text("Device Key") },
                        modifier = Modifier.fillMaxWidth(),
                        singleLine = true,
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFFA855F7),
                            unfocusedBorderColor = Color(0xFF2E2E3E)
                        )
                    )
                }
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
    val scope = rememberCoroutineScope()
    val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${file.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
    val isImage = file.mimeType.startsWith("image/")
    val isVideo = file.mimeType.startsWith("video/")
    val isPdf = file.mimeType.contains("pdf") || file.filename.endsWith(".pdf", ignoreCase = true)

    // For videos: resolve direct Google Drive CDN URL to bypass Render proxy buffering
    var resolvedVideoUrl by remember { mutableStateOf<String?>(null) }
    var isResolvingUrl by remember { mutableStateOf(false) }

    LaunchedEffect(file.id) {
        if (isVideo) {
            isResolvingUrl = true
            withContext(Dispatchers.IO) {
                try {
                    val base = serverUrl.trimEnd('/')
                    val req = Request.Builder()
                        .url("$base/api/v1/files/${file.id}/gdrive-url?deviceId=$deviceId&deviceKey=$deviceKey")
                        .addHeader("x-device-id", deviceId)
                        .addHeader("x-device-key", deviceKey)
                        .build()
                    val res = sharedHttpClient.newCall(req).execute()
                    if (res.isSuccessful) {
                        val json = org.json.JSONObject(res.body?.string() ?: "{}")
                        val direct = json.optString("directUrl", "")
                        withContext(Dispatchers.Main) {
                            resolvedVideoUrl = direct.ifBlank { streamUrl }
                        }
                    } else {
                        withContext(Dispatchers.Main) { resolvedVideoUrl = streamUrl }
                    }
                } catch (_: Exception) {
                    withContext(Dispatchers.Main) { resolvedVideoUrl = streamUrl }
                } finally {
                    withContext(Dispatchers.Main) { isResolvingUrl = false }
                }
            }
        }
    }

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
                        when {
                            isResolvingUrl -> {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    CircularProgressIndicator(color = Color(0xFFA855F7), modifier = Modifier.size(44.dp))
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Text("Connecting to Google Drive…", color = Color(0xFF94A3B8), fontSize = 13.sp)
                                }
                            }
                            resolvedVideoUrl != null -> VideoPlayer(
                                streamUrl = resolvedVideoUrl!!,
                                filename = file.filename
                            )
                        }
                    } else if (isPdf) {
                        PdfViewer(
                            file = file,
                            serverUrl = serverUrl,
                            deviceId = deviceId,
                            deviceKey = deviceKey
                        )
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
// In-App Video Player with VideoView & MediaController
// ----------------------------------------------------
@Composable
fun VideoPlayer(
    streamUrl: String,
    filename: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var isBuffering by remember { mutableStateOf(true) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var videoViewRef by remember { mutableStateOf<VideoView?>(null) }

    DisposableEffect(streamUrl) {
        onDispose {
            videoViewRef?.stopPlayback()
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black),
        contentAlignment = Alignment.Center
    ) {
        AndroidView(
            factory = { ctx ->
                VideoView(ctx).apply {
                    videoViewRef = this
                    val mc = MediaController(ctx)
                    mc.setAnchorView(this)
                    setMediaController(mc)

                    setOnPreparedListener { mp ->
                        isBuffering = false
                        playbackError = null
                        mp.isLooping = false
                        start()
                    }

                    setOnInfoListener { _, what, _ ->
                        if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) {
                            isBuffering = true
                        } else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END) {
                            isBuffering = false
                        }
                        true
                    }

                    setOnErrorListener { _, what, extra ->
                        isBuffering = false
                        playbackError = "Unable to stream video (code: $what, extra: $extra)"
                        true
                    }

                    setVideoURI(Uri.parse(streamUrl))
                }
            },
            modifier = Modifier.fillMaxSize()
        )

        if (isBuffering && playbackError == null) {
            CircularProgressIndicator(
                color = Color(0xFFA855F7),
                modifier = Modifier.size(48.dp)
            )
        }

        if (playbackError != null) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier
                    .background(Color(0xFF0F0F14).copy(alpha = 0.94f), RoundedCornerShape(16.dp))
                    .padding(24.dp)
            ) {
                Icon(
                    Icons.Default.ErrorOutline,
                    contentDescription = null,
                    tint = Color(0xFFEF4444),
                    modifier = Modifier.size(40.dp)
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    text = "Playback Error",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = playbackError ?: "Error loading stream",
                    color = Color(0xFF94A3B8),
                    fontSize = 12.sp,
                    textAlign = TextAlign.Center
                )
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
                            Toast.makeText(context, "No external video player found", Toast.LENGTH_SHORT).show()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7E22CE)),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Try External Player")
                }
            }
        }
    }
}

// ----------------------------------------------------
// In-App PDF Document Viewer with PdfRenderer
// ----------------------------------------------------
@Composable
fun PdfViewer(
    file: CloudFile,
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var isLoading by remember { mutableStateOf(true) }
    var errorMessage by remember { mutableStateOf<String?>(null) }
    var pdfPages by remember { mutableStateOf<List<Bitmap>>(emptyList()) }
    var cachedFile by remember { mutableStateOf<File?>(null) }

    LaunchedEffect(file.id) {
        withContext(Dispatchers.IO) {
            try {
                isLoading = true
                errorMessage = null
                val cacheSubdir = File(context.cacheDir, "pdf_previews")
                if (!cacheSubdir.exists()) cacheSubdir.mkdirs()

                val safeName = file.filename.replace("[^a-zA-Z0-9._-]".toRegex(), "_")
                val localFile = File(cacheSubdir, "${file.id}_$safeName")

                if (!localFile.exists() || localFile.length() == 0L) {
                    val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${file.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
                    val request = Request.Builder()
                        .url(streamUrl)
                        .addHeader("x-device-id", deviceId)
                        .addHeader("x-device-key", deviceKey)
                        .build()
                    val response = sharedHttpClient.newCall(request).execute()
                    if (!response.isSuccessful) {
                        throw Exception("Server returned HTTP ${response.code}")
                    }
                    val body = response.body ?: throw Exception("Empty PDF response from server")
                    localFile.outputStream().use { out ->
                        body.byteStream().copyTo(out)
                    }
                }

                cachedFile = localFile

                val fileDescriptor = ParcelFileDescriptor.open(localFile, ParcelFileDescriptor.MODE_READ_ONLY)
                val pdfRenderer = PdfRenderer(fileDescriptor)
                val pages = mutableListOf<Bitmap>()
                val maxPages = minOf(pdfRenderer.pageCount, 50)
                val displayMetrics = context.resources.displayMetrics
                val targetWidth = minOf(displayMetrics.widthPixels, 1200)

                for (i in 0 until maxPages) {
                    val page = pdfRenderer.openPage(i)
                    val scale = targetWidth.toFloat() / page.width.toFloat()
                    val renderWidth = (page.width * scale).toInt()
                    val renderHeight = (page.height * scale).toInt()

                    val bitmap = Bitmap.createBitmap(renderWidth, renderHeight, Bitmap.Config.ARGB_8888)
                    val canvas = Canvas(bitmap)
                    canvas.drawColor(AndroidColor.WHITE)
                    page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                    pages.add(bitmap)
                    page.close()
                }
                pdfRenderer.close()
                fileDescriptor.close()

                pdfPages = pages
                isLoading = false
            } catch (e: Exception) {
                e.printStackTrace()
                errorMessage = e.message ?: "Failed to render PDF"
                isLoading = false
            }
        }
    }

    Box(modifier = modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        if (isLoading) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center
            ) {
                CircularProgressIndicator(
                    color = Color(0xFFA855F7),
                    modifier = Modifier.size(44.dp)
                )
                Spacer(modifier = Modifier.height(14.dp))
                Text("Loading PDF...", color = Color(0xFF94A3B8), fontSize = 13.sp)
            }
        } else if (errorMessage != null) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
                modifier = Modifier.padding(24.dp)
            ) {
                Icon(
                    Icons.Default.ErrorOutline,
                    contentDescription = null,
                    tint = Color(0xFFEF4444),
                    modifier = Modifier.size(48.dp)
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text("Unable to preview PDF", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Spacer(modifier = Modifier.height(4.dp))
                Text(errorMessage ?: "", color = Color(0xFF94A3B8), fontSize = 12.sp, textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(16.dp))
                if (cachedFile != null && cachedFile!!.exists()) {
                    Button(
                        onClick = { openPdfInExternalApp(context, cachedFile!!) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7E22CE)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Open in External PDF App")
                    }
                }
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                // PDF Sub-header
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFF13131A))
                        .padding(horizontal = 16.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "${pdfPages.size} page(s)",
                        color = Color(0xFF94A3B8),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                    cachedFile?.let { cFile ->
                        Button(
                            onClick = { openPdfInExternalApp(context, cFile) },
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF2E1A47)),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(
                                Icons.Default.OpenInNew,
                                contentDescription = null,
                                tint = Color(0xFFC084FC),
                                modifier = Modifier.size(14.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Open in PDF App", color = Color(0xFFC084FC), fontSize = 12.sp)
                        }
                    }
                }

                // Scrollable pages
                LazyColumn(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color(0xFF16161E)),
                    contentPadding = PaddingValues(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    items(pdfPages.size) { index ->
                        val pageBitmap = pdfPages[index]
                        Card(
                            shape = RoundedCornerShape(4.dp),
                            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Image(
                                bitmap = pageBitmap.asImageBitmap(),
                                contentDescription = "Page ${index + 1}",
                                modifier = Modifier.fillMaxWidth(),
                                contentScale = ContentScale.FillWidth
                            )
                        }
                    }
                }
            }
        }
    }
}

fun openPdfInExternalApp(context: Context, pdfFile: File) {
    try {
        val uri = androidx.core.content.FileProvider.getUriForFile(
            context,
            "${context.packageName}.fileprovider",
            pdfFile
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/pdf")
            flags = Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK
        }
        context.startActivity(Intent.createChooser(intent, "Open PDF with"))
    } catch (e: Exception) {
        Toast.makeText(context, "No PDF viewer app found: ${e.message}", Toast.LENGTH_SHORT).show()
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

// ----------------------------------------------------
// Manual Upload Options Dialog (Gallery & Storage)
// ----------------------------------------------------
@Composable
fun ManualUploadDialog(
    targetFolderName: String,
    onOpenFolderSelector: () -> Unit,
    onPickGallery: () -> Unit,
    onPickStorage: () -> Unit,
    onDismiss: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF14141C),
        title = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Default.CloudUpload, contentDescription = null, tint = Color(0xFFA855F7), modifier = Modifier.size(24.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Upload to Cloud",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp
                )
            }
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Destination Folder Indicator
                Surface(
                    shape = RoundedCornerShape(12.dp),
                    color = Color(0xFF1C1C28),
                    border = BorderStroke(1.dp, Color(0xFF2E2E3E))
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(modifier = Modifier.weight(1f)) {
                            Text("Destination Folder", fontSize = 11.sp, color = Color(0xFF71717A))
                            Text(targetFolderName, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color(0xFFC084FC))
                        }
                        TextButton(onClick = onOpenFolderSelector) {
                            Text("Change", color = Color(0xFFA855F7), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }

                Text("Choose upload source:", fontSize = 12.sp, color = Color(0xFF94A3B8))

                // Option 1: Gallery (Photos & Videos)
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPickGallery() },
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF26193E)),
                    border = BorderStroke(1.dp, Color(0xFF581C87))
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF6B21A8)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text("Photos & Videos", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text("Select multiple media from Gallery", fontSize = 11.sp, color = Color(0xFFD8B4FE))
                        }
                    }
                }

                // Option 2: Storage / Files (Documents & Any file)
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onPickStorage() },
                    shape = RoundedCornerShape(14.dp),
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF0F2338)),
                    border = BorderStroke(1.dp, Color(0xFF0369A1))
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF0284C7)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.Folder, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text("Files & Documents", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text("Select PDFs, docs, or files from folders", fontSize = 11.sp, color = Color(0xFF7DD3FC))
                        }
                    }
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

fun downloadFileToDevice(
    context: Context,
    url: String,
    filename: String,
    deviceId: String,
    deviceKey: String,
    saveToGallery: Boolean = false,
    onSuccess: (() -> Unit)? = null
) {
    try {
        val dm = context.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val uri = Uri.parse(url)
        val dir = if (saveToGallery) Environment.DIRECTORY_PICTURES else Environment.DIRECTORY_DOWNLOADS
        val request = DownloadManager.Request(uri).apply {
            setTitle(filename)
            setDescription(if (saveToGallery) "Saving to Gallery" else "Downloading from myDrive")
            setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            setDestinationInExternalPublicDir(dir, filename)
            addRequestHeader("x-device-id", deviceId)
            addRequestHeader("x-device-key", deviceKey)
        }
        dm.enqueue(request)
        onSuccess?.invoke()
        val dest = if (saveToGallery) "Gallery / Pictures" else "Downloads"
        Toast.makeText(context, "Saving $filename to $dest...", Toast.LENGTH_SHORT).show()
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
