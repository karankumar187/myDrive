package com.drive.sync

import android.content.ContentValues
import android.provider.MediaStore
import android.media.MediaScannerConnection
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
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.Observer
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.graphics.vector.ImageVector
import com.drive.sync.network.AppPermissions
import com.drive.sync.network.SyncNotificationHelper
import com.drive.sync.network.SyncLogManager
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
import androidx.compose.foundation.border
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
import androidx.compose.ui.graphics.graphicsLayer
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
import androidx.compose.animation.*
import androidx.compose.animation.core.*
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
import androidx.compose.runtime.saveable.rememberSaveable
import com.drive.sync.network.DriveDataCache
import com.drive.sync.network.DriveSocketManager
import com.drive.sync.workers.SyncWorker
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okio.BufferedSink
import okio.source
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

// ══════════════════════════════════════════════════════════════════
// Data Classes & Models
// ══════════════════════════════════════════════════════════════════

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
    val folderId: String? = null,
    val takenAt: String? = null
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
    val thumbnail: String? = null,
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
    val path: String = "",
    val parentFolderId: String? = null
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
    val sourceDeviceId: String? = null,
    var isDownloadedLocally: Boolean = false,
    val isForceDownload: Boolean = false,
    val autoDownloadToGallery: Boolean = false
)

class MainActivity : ComponentActivity() {

    private val httpClient = sharedHttpClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SyncLogManager.init(this)
        DriveDataCache.init(this)

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
                    .maxSizeBytes(500L * 1024 * 1024)
                    .build()
            }
            .components {
                add(SvgDecoder.Factory())
            }
            .crossfade(true)
            .respectCacheHeaders(false)
            .build()
        Coil.setImageLoader(imageLoader)

        val prefs = getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFF38BDF8),
                    secondary = Color(0xFF10B981),
                    tertiary = Color(0xFF94A3B8),
                    background = Color(0xFF000000),
                    surface = Color(0xFF0A0A0E),
                    surfaceVariant = Color(0xFF14141B),
                    onBackground = Color(0xFFF8FAFC),
                    onSurface = Color(0xFFF8FAFC)
                )
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    RootAppScreen(
                        prefs = prefs,
                        onScheduleSync = { serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments ->
                            scheduleBackupWork(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments, forceUpdate = true)
                            com.drive.sync.network.SyncAlarmScheduler.scheduleNextAlarm(this)
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
        val targetFolderId = prefs.getString("target_folder_id", "") ?: ""
        val rawServerUrl = prefs.getString("server_url", "https://drive-edge-cache.karan9302451907.workers.dev") ?: "https://drive-edge-cache.karan9302451907.workers.dev"
        val serverUrl = if (rawServerUrl.contains("onrender.com") || rawServerUrl.isBlank()) {
            prefs.edit().putString("server_url", "https://drive-edge-cache.karan9302451907.workers.dev").apply()
            "https://drive-edge-cache.karan9302451907.workers.dev"
        } else rawServerUrl.trimEnd('/')
        val wifiOnly = prefs.getBoolean("wifi_only", false)
        val chargingOnly = prefs.getBoolean("charging_only", false)
        val syncPhotos = prefs.getBoolean("sync_photos", true)
        val syncVideos = prefs.getBoolean("sync_videos", true)
        val syncDocuments = prefs.getBoolean("sync_documents", true)

        if (deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            scheduleBackupWork(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments, forceUpdate = true)
            com.drive.sync.network.SyncAlarmScheduler.scheduleNextAlarm(this)
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
        syncDocuments: Boolean,
        forceUpdate: Boolean = false
    ) {
        val prefs = getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)
        val intervalHours = prefs.getInt("sync_interval_hours", 2).toLong().coerceAtLeast(1L)
        val staggerMinutes = prefs.getInt("stagger_offset_minutes", 0).toLong().coerceAtLeast(0L)

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

        val syncRequestBuilder = PeriodicWorkRequestBuilder<SyncWorker>(
            intervalHours, TimeUnit.HOURS,
            15, TimeUnit.MINUTES // 15-min flex window
        )
            .setConstraints(constraints)
            .addTag("UnifiedDriveSyncTag")
            .setInputData(
                workDataOf(
                    "server_url" to serverUrl,
                    "device_id" to deviceId,
                    "device_key" to deviceKey,
                    "target_folder_id" to (targetFolderId ?: ""),
                    "sync_photos" to syncPhotos,
                    "sync_videos" to syncVideos,
                    "sync_documents" to syncDocuments,
                    "is_manual" to false
                )
            )

        if (staggerMinutes > 0) {
            syncRequestBuilder.setInitialDelay(staggerMinutes, TimeUnit.MINUTES)
        }

        val syncRequest = syncRequestBuilder.build()
        val policy = if (forceUpdate) ExistingPeriodicWorkPolicy.UPDATE else ExistingPeriodicWorkPolicy.KEEP

        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            "UnifiedDrivePeriodicSync",
            policy,
            syncRequest
        )

        val nextSync = if (staggerMinutes > 0) {
            System.currentTimeMillis() + (staggerMinutes * 60 * 1000L)
        } else {
            System.currentTimeMillis() + (intervalHours * 3600 * 1000L)
        }

        prefs.edit().apply {
            putLong("next_sync_timestamp", nextSync)
            putLong("last_work_scheduled_timestamp", System.currentTimeMillis())
            apply()
        }

        // Also schedule exact RTC_WAKEUP alarm for reliable Doze-mode wakeup
        com.drive.sync.network.SyncAlarmScheduler.scheduleNextAlarm(applicationContext)
    }

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
        SyncNotificationHelper.resetCancel()
        SyncLogManager.log("── Manual sync initiated ──")
        SyncLogManager.status("Starting manual sync…")

        val inputData = Data.Builder()
            .putString("server_url", serverUrl)
            .putString("device_id", deviceId)
            .putString("device_key", deviceKey)
            .putString("target_folder_id", targetFolderId)
            .putBoolean("sync_photos", syncPhotos)
            .putBoolean("sync_videos", syncVideos)
            .putBoolean("sync_documents", syncDocuments)
            .putBoolean("is_manual", true)
            .build()

        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints)
            .setInputData(inputData)
            .addTag("UnifiedDriveSyncTag")
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniqueWork(
            "UnifiedDriveImmediateSync",
            ExistingWorkPolicy.REPLACE,
            syncRequest
        )
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

    var serverUrl by remember { mutableStateOf("https://drive-edge-cache.karan9302451907.workers.dev") }
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
                    withStyle(style = SpanStyle(color = Color(0xFF38BDF8))) { append("Drive") }
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
                        leadingIcon = { Icon(Icons.Default.Cloud, contentDescription = null, tint = Color(0xFF38BDF8)) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFF38BDF8),
                            unfocusedBorderColor = Color(0xFF27272A),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color(0xFFD4D4D8),
                            cursorColor = Color(0xFF38BDF8),
                            focusedContainerColor = Color(0xFF14141B),
                            unfocusedContainerColor = Color(0xFF0E0E14)
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
                        leadingIcon = { Icon(Icons.Default.PhoneAndroid, contentDescription = null, tint = Color(0xFF38BDF8)) },
                        colors = OutlinedTextFieldDefaults.colors(
                            focusedBorderColor = Color(0xFF38BDF8),
                            unfocusedBorderColor = Color(0xFF27272A),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color(0xFFD4D4D8),
                            cursorColor = Color(0xFF38BDF8),
                            focusedContainerColor = Color(0xFF14141B),
                            unfocusedContainerColor = Color(0xFF0E0E14)
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
                        leadingIcon = { Icon(Icons.Default.VpnKey, contentDescription = null, tint = Color(0xFF38BDF8)) },
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
                            focusedBorderColor = Color(0xFF38BDF8),
                            unfocusedBorderColor = Color(0xFF27272A),
                            focusedTextColor = Color.White,
                            unfocusedTextColor = Color(0xFFD4D4D8),
                            cursorColor = Color(0xFF38BDF8),
                            focusedContainerColor = Color(0xFF14141B),
                            unfocusedContainerColor = Color(0xFF0E0E14)
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
                            containerColor = Color(0xFF38BDF8),
                            disabledContainerColor = Color(0xFF1E293B)
                        )
                    ) {
                        if (isConnecting) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = Color.Black,
                                strokeWidth = 2.dp
                            )
                            Spacer(modifier = Modifier.width(10.dp))
                            Text("Connecting...", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.Black)
                        } else {
                            Icon(Icons.Default.Link, contentDescription = null, tint = Color.Black, modifier = Modifier.size(18.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Connect & Save", fontSize = 15.sp, fontWeight = FontWeight.Bold, color = Color.Black)
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
// Connecting to myDrive Screen (Mirrors Web App 1-to-1)
// ══════════════════════════════════════════════════════════════════
@Composable
fun ConnectingToDriveScreen() {
    val infiniteTransition = rememberInfiniteTransition(label = "pulseTransition")
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseAlpha"
    )
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 0.95f,
        targetValue = 1.02f,
        animationSpec = infiniteRepeatable(
            animation = tween(1200, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )
    val dotAlpha by infiniteTransition.animateFloat(
        initialValue = 0.3f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(800, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "dotAlpha"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFF08080A)),
        contentAlignment = Alignment.Center
    ) {
        // Ambient soft sky blue radial glow in background
        Box(
            modifier = Modifier
                .size(360.dp)
                .background(
                    brush = Brush.radialGradient(
                        colors = listOf(
                            Color(0xFF38BDF8).copy(alpha = 0.14f),
                            Color(0xFF38BDF8).copy(alpha = 0.04f),
                            Color.Transparent
                        )
                    ),
                    shape = CircleShape
                )
        )

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.padding(24.dp)
        ) {
            // App Logo with glowing sky blue border and gentle breathing pulse
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = Color(0xFF101014),
                border = BorderStroke(1.5.dp, Color(0xFF38BDF8).copy(alpha = pulseAlpha)),
                shadowElevation = 18.dp,
                modifier = Modifier
                    .size(76.dp)
                    .graphicsLayer(
                        scaleX = pulseScale,
                        scaleY = pulseScale,
                        alpha = pulseAlpha
                    )
            ) {
                Image(
                    painter = painterResource(R.drawable.ic_mydrive_logo),
                    contentDescription = "myDrive",
                    modifier = Modifier
                        .fillMaxSize()
                        .clip(RoundedCornerShape(20.dp)),
                    contentScale = ContentScale.Crop
                )
            }

            Spacer(modifier = Modifier.height(22.dp))

            // "Connecting to myDrive..." with pulsing sky blue status dot
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .graphicsLayer(alpha = dotAlpha)
                        .background(Color(0xFF38BDF8), shape = CircleShape)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Connecting to myDrive...",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = Color(0xFFA1A1AA),
                    letterSpacing = 0.3.sp
                )
            }
        }
    }
}

// ══════════════════════════════════════════════════════════════════
// Permissions Required Screen & Root App Gate
// ══════════════════════════════════════════════════════════════════
@Composable
fun PermissionsRequiredScreen(
    onGrantClicked: () -> Unit,
    onOpenSettingsClicked: () -> Unit
) {
    val context = LocalContext.current
    val hasStorage = AppPermissions.hasStoragePermission(context)
    val hasNotification = AppPermissions.hasNotificationPermission(context)

    val infiniteTransition = rememberInfiniteTransition(label = "perm_pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 0.96f,
        targetValue = 1.04f,
        animationSpec = infiniteRepeatable(
            animation = tween(1600, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "perm_scale"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .padding(horizontal = 24.dp, vertical = 40.dp),
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .size(340.dp)
                .background(
                    brush = Brush.radialGradient(
                        colors = listOf(Color(0xFF38BDF8).copy(alpha = 0.14f), Color.Transparent)
                    ),
                    shape = CircleShape
                )
        )

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
        ) {
            Surface(
                shape = RoundedCornerShape(20.dp),
                color = Color(0xFF101014),
                border = BorderStroke(1.5.dp, Color(0xFF38BDF8)),
                shadowElevation = 18.dp,
                modifier = Modifier
                    .size(76.dp)
                    .graphicsLayer(scaleX = pulseScale, scaleY = pulseScale)
            ) {
                Image(
                    painter = painterResource(R.drawable.ic_mydrive_logo),
                    contentDescription = "myDrive",
                    modifier = Modifier
                        .fillMaxSize()
                        .clip(RoundedCornerShape(20.dp)),
                    contentScale = ContentScale.Crop
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = "Permissions Required",
                fontSize = 22.sp,
                fontWeight = FontWeight.ExtraBold,
                color = Color.White
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "myDrive requires access to your device to back up photos, videos, and show live progress.",
                fontSize = 13.sp,
                color = Color(0xFF94A3B8),
                textAlign = TextAlign.Center,
                lineHeight = 18.sp
            )

            Spacer(modifier = Modifier.height(24.dp))

            PermissionChecklistCard(
                icon = Icons.Default.PhotoLibrary,
                title = "Gallery & Photos",
                description = "Required to scan and sync local media to your private cloud storage.",
                isGranted = hasStorage
            )

            Spacer(modifier = Modifier.height(12.dp))

            PermissionChecklistCard(
                icon = Icons.Default.Notifications,
                title = "Live Notifications",
                description = "Required to display live backup status, progress percentage, and summaries.",
                isGranted = hasNotification
            )

            Spacer(modifier = Modifier.height(32.dp))

            Button(
                onClick = onGrantClicked,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF38BDF8)),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp)
            ) {
                Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color.Black, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Grant Required Permissions",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.Black
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedButton(
                onClick = onOpenSettingsClicked,
                colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFF38BDF8)),
                border = BorderStroke(1.dp, Color(0xFF27272A)),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(46.dp)
            ) {
                Icon(Icons.Default.Settings, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(16.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "Open App Settings",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium,
                    color = Color(0xFF38BDF8)
                )
            }
        }
    }
}

@Composable
private fun PermissionChecklistCard(
    icon: ImageVector,
    title: String,
    description: String,
    isGranted: Boolean
) {
    Surface(
        shape = RoundedCornerShape(14.dp),
        color = Color(0xFF101014),
        border = BorderStroke(1.dp, if (isGranted) Color(0xFF10B981).copy(alpha = 0.4f) else Color(0xFF27272A)),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .padding(14.dp)
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                modifier = Modifier
                    .size(40.dp)
                    .background(
                        if (isGranted) Color(0xFF10B981).copy(alpha = 0.15f) else Color(0xFF38BDF8).copy(alpha = 0.15f),
                        CircleShape
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = if (isGranted) Color(0xFF10B981) else Color(0xFF38BDF8),
                    modifier = Modifier.size(20.dp)
                )
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = title,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    if (isGranted) {
                        Text(
                            text = "✓ Granted",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF4ADE80)
                        )
                    } else {
                        Text(
                            text = "Required",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFFBBF24)
                        )
                    }
                }
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = description,
                    fontSize = 12.sp,
                    color = Color(0xFF71717A),
                    lineHeight = 16.sp
                )
            }
        }
    }
}

@Composable
fun RootAppScreen(
    prefs: android.content.SharedPreferences,
    onScheduleSync: (String, String, String, String?, Boolean, Boolean, Boolean, Boolean, Boolean) -> Unit,
    onSyncNow: (String, String, String, String?, Boolean, Boolean, Boolean, (() -> Unit)?) -> Unit,
    httpClient: OkHttpClient
) {
    val context = LocalContext.current
    var hasAllPermissions by remember {
        mutableStateOf(AppPermissions.hasAllRequiredPermissions(context))
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        hasAllPermissions = AppPermissions.hasAllRequiredPermissions(context)
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) {
                val granted = AppPermissions.hasAllRequiredPermissions(context)
                hasAllPermissions = granted
                if (!granted) {
                    permissionLauncher.launch(AppPermissions.getRequiredPermissions())
                }
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
        }
    }

    LaunchedEffect(Unit) {
        if (!hasAllPermissions) {
            permissionLauncher.launch(AppPermissions.getRequiredPermissions())
        }
    }

    if (!hasAllPermissions) {
        PermissionsRequiredScreen(
            onGrantClicked = {
                permissionLauncher.launch(AppPermissions.getRequiredPermissions())
            },
            onOpenSettingsClicked = {
                AppPermissions.openAppSettings(context)
            }
        )
        return
    }

    MainAppScreen(
        prefs = prefs,
        onScheduleSync = onScheduleSync,
        onSyncNow = onSyncNow,
        httpClient = httpClient
    )
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

    val requiredPermissions = remember { AppPermissions.getRequiredPermissions() }
    var hasMediaPermissions by remember {
        mutableStateOf(AppPermissions.hasStoragePermission(context))
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        hasMediaPermissions = AppPermissions.hasStoragePermission(context)
    }

    var selectedTab by rememberSaveable { mutableIntStateOf(prefs.getInt("selected_tab", 0)) }
    var isFilesSelectionMode by remember { mutableStateOf(false) }
    var isInitialLoading by remember { mutableStateOf(!DriveDataCache.hasData()) }

    val initialServerUrl = remember {
        val raw = prefs.getString("server_url", "https://drive-edge-cache.karan9302451907.workers.dev") ?: "https://drive-edge-cache.karan9302451907.workers.dev"
        if (raw.contains("onrender.com") || raw.isBlank()) {
            prefs.edit().putString("server_url", "https://drive-edge-cache.karan9302451907.workers.dev").apply()
            "https://drive-edge-cache.karan9302451907.workers.dev"
        } else raw.trimEnd('/')
    }
    var serverUrl by remember { mutableStateOf(initialServerUrl) }
    var deviceId by remember { mutableStateOf(prefs.getString("device_id", "") ?: "") }
    var deviceKey by remember { mutableStateOf(prefs.getString("device_key", "") ?: "") }
    var targetFolderId by remember { mutableStateOf(prefs.getString("target_folder_id", "") ?: "") }
    var targetFolderName by remember { mutableStateOf(prefs.getString("target_folder_name", "Root (My Drive)") ?: "Root (My Drive)") }
    var wifiOnly by remember { mutableStateOf(prefs.getBoolean("wifi_only", false)) }
    var chargingOnly by remember { mutableStateOf(prefs.getBoolean("charging_only", false)) }
    var syncPhotos by remember { mutableStateOf(prefs.getBoolean("sync_photos", true)) }
    var syncVideos by remember { mutableStateOf(prefs.getBoolean("sync_videos", true)) }
    var syncDocuments by remember { mutableStateOf(prefs.getBoolean("sync_documents", true)) }

    // Live sync stats & collision-free schedule
    var lastSyncTimestamp by remember { mutableLongStateOf(prefs.getLong("last_sync_timestamp", 0L)) }
    var nextSyncTimestamp by remember { mutableLongStateOf(prefs.getLong("next_sync_timestamp", 0L)) }
    var syncIntervalHours by remember { mutableIntStateOf(prefs.getInt("sync_interval_hours", 2)) }
    var staggerOffsetMinutes by remember { mutableIntStateOf(prefs.getInt("stagger_offset_minutes", 0)) }
    var staggerTotalDevices by remember { mutableIntStateOf(prefs.getInt("stagger_total_devices", 1)) }
    var staggerDeviceSlot by remember { mutableIntStateOf(prefs.getInt("stagger_device_slot", 1)) }
    var totalSyncedCount by remember { mutableIntStateOf(prefs.getInt("total_synced_count", 0)) }
    var lastSyncStatus by remember { mutableStateOf(prefs.getString("last_sync_status", "Never synced") ?: "Never synced") }

    // Cloud Data States
    var storageSummary by remember { mutableStateOf(DriveDataCache.storageSummary) }
    var filesList by remember { mutableStateOf(DriveDataCache.filesList) }
    var galleryList by remember { mutableStateOf(DriveDataCache.galleryList) }
    var foldersList by remember { mutableStateOf(DriveDataCache.foldersList) }
    var selectedFilterFolderId by remember { mutableStateOf<String?>(null) }
    var userAvatarUrl by remember { mutableStateOf(prefs.getString("user_avatar_url", "") ?: "") }
    var userName by remember { mutableStateOf(prefs.getString("user_name", "") ?: "") }
    var userEmail by remember { mutableStateOf(prefs.getString("user_email", "") ?: "") }

    // Activity & Paired Devices States
    var uploadedFilesList by remember { mutableStateOf(DriveDataCache.uploadedFilesList) }
    var inboundSyncList by remember { mutableStateOf(DriveDataCache.inboundSyncList) }
    var pairedDevicesList by remember { mutableStateOf(DriveDataCache.pairedDevicesList) }
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
    var syncStatusText by remember { mutableStateOf("") }
    val syncLogLines by SyncLogManager.logsFlow.collectAsState()
    val liveSyncStatusText by SyncLogManager.currentStatusFlow.collectAsState()

    var isRefreshing by remember { mutableStateOf(false) }
    var isCrudOperating by remember { mutableStateOf(false) }
    var fetchError by remember { mutableStateOf<String?>(null) }

    // Dialog States
    var showFolderDialog by remember { mutableStateOf(false) }
    var previewItem by remember { mutableStateOf<CloudFile?>(null) }

    val scope = rememberCoroutineScope()

    val workManager = remember { WorkManager.getInstance(context) }
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val liveData = workManager.getWorkInfosByTagLiveData("UnifiedDriveSyncTag")
        val observer = Observer<List<WorkInfo>> { list ->
            val isRunning = list?.any { it.state == WorkInfo.State.RUNNING } == true
            isSyncingNow = isRunning
            if (!isRunning) {
                val lastFinished = list?.firstOrNull { it.state == WorkInfo.State.SUCCEEDED }
                if (lastFinished != null) {
                    syncStatusText = "All items backed up securely ✓"
                }
            }
        }
        liveData.observe(lifecycleOwner, observer)
        onDispose {
            liveData.removeObserver(observer)
        }
    }

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

    // ── Unified Sync Now ───────────────────────────────────────────────────
    val performInProcessSync: () -> Unit = {
        saveCredentials()
        onSyncNow(serverUrl, deviceId, deviceKey, targetFolderId, syncPhotos, syncVideos, syncDocuments) {
            isSyncingNow = true
            syncStatusText = "Starting background sync…"
            Toast.makeText(context, "Background sync running quietly!", Toast.LENGTH_SHORT).show()
        }
    }

    val downloadInboundItem: (InboundSyncItem) -> Unit = { item ->
        scope.launch {
            val isMedia = item.mimeType.startsWith("image/") || item.mimeType.startsWith("video/") ||
                    item.filename.endsWith(".jpg", true) || item.filename.endsWith(".jpeg", true) ||
                    item.filename.endsWith(".png", true) || item.filename.endsWith(".webp", true) ||
                    item.filename.endsWith(".mp4", true) || item.filename.endsWith(".mov", true) ||
                    item.filename.endsWith(".mkv", true)
            val targetName = if (isMedia) "Phone Gallery" else "phone storage"
            Toast.makeText(context, "Saving ${item.filename} to $targetName...", Toast.LENGTH_SHORT).show()
            val ok = downloadInboundFileLocally(
                context = context,
                httpClient = httpClient,
                serverUrl = serverUrl,
                deviceId = deviceId,
                deviceKey = deviceKey,
                fileId = item.id,
                filename = item.filename,
                mimeType = item.mimeType
            )
            if (ok) {
                item.isDownloadedLocally = true
                Toast.makeText(context, "Saved ${item.filename} to $targetName ✓", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(context, "Failed to download ${item.filename}", Toast.LENGTH_SHORT).show()
            }
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
                        coroutineScope {
                            // 1. Fetch Storage Pool Summary in parallel
                            val dSummary = async {
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

                                        StoragePoolSummary(
                                            totalCapacityBytes = totalCap,
                                            totalUsedBytes = usedCap,
                                            connectedAccountsCount = totalAcc,
                                            usagePercentage = pctUsed
                                        )
                                    } else null
                                } catch (e: Exception) {
                                    null
                                }
                            }

                            // 2. Fetch Files in parallel (handle null folderId properly)
                            val dFiles = async {
                                try {
                                    val req = Request.Builder()
                                        .url("$baseUrl/api/v1/files?all=true&limit=300")
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
                                                val meta = item.optJSONObject("metadata")
                                                val fId = when {
                                                    item.isNull("folderId") -> ""
                                                    item.optJSONObject("folderId") != null -> item.optJSONObject("folderId")?.optString("_id", "") ?: ""
                                                    else -> {
                                                        val s = item.optString("folderId", "")
                                                        if (s == "null") "" else s
                                                    }
                                                }
                                                list.add(
                                                    CloudFile(
                                                        id = item.optString("_id"),
                                                        filename = item.optString("filename"),
                                                        mimeType = item.optString("mimeType"),
                                                        sizeBytes = item.optLong("sizeBytes"),
                                                        createdAt = item.optString("createdAt"),
                                                        folderId = fId,
                                                        takenAt = meta?.optString("takenAt")?.ifBlank { null }
                                                    )
                                                )
                                            }
                                        }
                                        list
                                    } else null
                                } catch (e: Exception) {
                                    null
                                }
                            }

                            // 3. Fetch Gallery Media in parallel
                            val dGallery = async {
                                try {
                                    val req = Request.Builder()
                                        .url("$baseUrl/api/v1/files/gallery?limit=300")
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
                                                        thumbnail = meta?.optString("thumbnail")?.ifBlank { null },
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
                                        list
                                    } else null
                                } catch (e: Exception) {
                                    null
                                }
                            }

                            // 4. Fetch Folders in parallel (handle null parentFolderId properly)
                            val dFolders = async {
                                try {
                                    val req = Request.Builder()
                                        .url("$baseUrl/api/v1/files/folders/list?all=true")
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
                                                val parentId = when {
                                                    item.isNull("parentFolderId") -> null
                                                    item.optJSONObject("parentFolderId") != null -> item.optJSONObject("parentFolderId")?.optString("_id")?.ifBlank { null }
                                                    else -> {
                                                        val s = item.optString("parentFolderId", "")
                                                        if (s.isBlank() || s == "null") null else s
                                                    }
                                                }
                                                list.add(
                                                    CloudFolder(
                                                        id = item.optString("_id"),
                                                        name = item.optString("name"),
                                                        path = item.optString("path", ""),
                                                        parentFolderId = parentId
                                                    )
                                                )
                                            }
                                        }
                                        list
                                    } else null
                                } catch (e: Exception) {
                                    null
                                }
                            }

                            // 5. Fetch Uploaded Files by This Device in parallel
                            val dUploads = async {
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
                                        list
                                    } else null
                                } catch (e: Exception) {
                                    null
                                }
                            }

                            // 6. Fetch Inbound Synced Files in parallel
                            val dInbound = async {
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
                                                        sourceDeviceId = item.optString("sourceDeviceId").ifBlank { null },
                                                        isDownloadedLocally = item.optBoolean("isDownloadedLocally", false),
                                                        isForceDownload = item.optBoolean("isForceDownload", false),
                                                        autoDownloadToGallery = item.optBoolean("autoDownloadToGallery", false)
                                                    )
                                                )
                                            }
                                        }
                                        list
                                    } else null
                                } catch (e: Exception) {
                                    null
                                }
                            }

                            // Await all parallel requests simultaneously
                            val sRes = dSummary.await()
                            val fRes = dFiles.await()
                            val gRes = dGallery.await()
                            val foRes = dFolders.await()
                            val upRes = dUploads.await()
                            val inRes = dInbound.await()

                            withContext(Dispatchers.Main) {
                                if (sRes != null) storageSummary = sRes
                                if (fRes != null && (fRes.isNotEmpty() || filesList.isEmpty())) filesList = fRes
                                if (gRes != null && (gRes.isNotEmpty() || galleryList.isEmpty())) galleryList = gRes
                                if (foRes != null && (foRes.isNotEmpty() || foldersList.isEmpty())) foldersList = foRes
                                if (upRes != null) uploadedFilesList = upRes
                                if (inRes != null) {
                                    inboundSyncList = inRes
                                    val autoPending = inRes.filter {
                                        !it.isDownloadedLocally && (it.isForceDownload || it.autoDownloadToGallery || (it.sourceDeviceId != null && pairedRulesMap[it.sourceDeviceId]?.autoDownloadToGallery == true))
                                    }
                                    if (autoPending.isNotEmpty()) {
                                        autoPending.forEach { fItem ->
                                            downloadInboundItem(fItem)
                                        }
                                    }
                                }

                                DriveDataCache.updateCache(
                                    context = context,
                                    summary = sRes,
                                    files = fRes,
                                    gallery = gRes,
                                    folders = foRes,
                                    uploads = upRes,
                                    inbound = inRes
                                )
                            }
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
                                val schObj = json.optJSONObject("schedule")
                                if (schObj != null) {
                                    val intervalHours = schObj.optInt("intervalHours", 2)
                                    val staggerOffset = schObj.optInt("staggerOffsetMinutes", 0)
                                    val totalDevs = schObj.optInt("totalDevices", 1)
                                    val devSlot = schObj.optInt("deviceSlot", 1)
                                    prefs.edit()
                                        .putInt("sync_interval_hours", intervalHours)
                                        .putInt("stagger_offset_minutes", staggerOffset)
                                        .putInt("stagger_total_devices", totalDevs)
                                        .putInt("stagger_device_slot", devSlot)
                                        .apply()
                                    withContext(Dispatchers.Main) {
                                        syncIntervalHours = intervalHours
                                        staggerOffsetMinutes = staggerOffset
                                        staggerTotalDevices = totalDevs
                                        staggerDeviceSlot = devSlot
                                    }
                                }
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
                                DriveDataCache.updateCache(context = context, pairedDevices = pList)
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

                        // 8. Fetch User Profile & Google Avatar
                        try {
                            val req = Request.Builder()
                                .url("$baseUrl/api/v1/auth/me")
                                .addHeader("x-device-id", deviceId)
                                .addHeader("x-device-key", deviceKey)
                                .build()
                            val res = httpClient.newCall(req).execute()
                            if (res.isSuccessful) {
                                val json = JSONObject(res.body?.string() ?: "{}")
                                val userObj = json.optJSONObject("user")
                                if (userObj != null) {
                                    val aUrl = userObj.optString("avatarUrl", "")
                                    val uName = userObj.optString("name", "")
                                    val uEmail = userObj.optString("email", "")
                                    withContext(Dispatchers.Main) {
                                        userAvatarUrl = aUrl
                                        userName = uName
                                        userEmail = uEmail
                                    }
                                    prefs.edit()
                                        .putString("user_avatar_url", aUrl)
                                        .putString("user_name", uName)
                                        .putString("user_email", uEmail)
                                        .apply()
                                }
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }

                    // Reload sync preferences
                    lastSyncTimestamp = prefs.getLong("last_sync_timestamp", 0L)
                    nextSyncTimestamp = prefs.getLong("next_sync_timestamp", 0L)
                    syncIntervalHours = prefs.getInt("sync_interval_hours", 2)
                    staggerOffsetMinutes = prefs.getInt("stagger_offset_minutes", 0)
                    staggerTotalDevices = prefs.getInt("stagger_total_devices", 1)
                    staggerDeviceSlot = prefs.getInt("stagger_device_slot", 1)
                    totalSyncedCount = prefs.getInt("total_synced_count", 0)
                    lastSyncStatus = prefs.getString("last_sync_status", "Up to date") ?: "Up to date"
                } catch (e: Exception) {
                    fetchError = e.localizedMessage ?: "Failed to connect to backend"
                } finally {
                    isRefreshing = false
                    isInitialLoading = false
                }
            }
        } else {
            isInitialLoading = false
        }
    }

    val createFolderAction: (String, String?) -> Unit = { folderName, parentId ->
        if (folderName.isNotBlank() && serverUrl.isNotBlank() && deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            scope.launch(Dispatchers.IO) {
                try {
                    val baseUrl = serverUrl.trimEnd('/')
                    val body = JSONObject().apply {
                        put("name", folderName.trim())
                        if (!parentId.isNullOrBlank()) {
                            put("parentFolderId", parentId)
                        }
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
                        put("syncIntervalHours", syncIntervalHours)
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

    // Real-time Socket.IO live sync across devices (instant file:uploaded, file:trashed, etc.)
    DisposableEffect(serverUrl, deviceId, deviceKey) {
        if (serverUrl.isNotBlank() && deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            DriveSocketManager.connect(serverUrl, deviceId, deviceKey) { eventName ->
                android.util.Log.d("MainActivity", "⚡ Socket.IO event received: $eventName -> refreshing data")
                refreshData()
            }
        }
        onDispose {
            DriveSocketManager.disconnect()
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

                        val contentHash = try {
                            context.contentResolver.openInputStream(uri)?.use { stream ->
                                VaultCrypto.calculateSha256(stream)
                            }
                        } catch (e: Exception) {
                            null
                        } ?: return@forEachIndexed

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

                                val streamingBody = object : RequestBody() {
                                    override fun contentType() = mimeType.toMediaType()
                                    override fun contentLength() = sizeBytes
                                    override fun writeTo(sink: BufferedSink) {
                                        context.contentResolver.openInputStream(uri)?.use { stream ->
                                            sink.writeAll(stream.source())
                                        }
                                    }
                                }

                                val putReq = Request.Builder()
                                    .url(uploadUrl)
                                    .put(streamingBody)
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

                                    // Extract video frame thumbnail locally if video
                                    var videoThumbBase64: String? = null
                                    val isVideo = mimeType.startsWith("video/") ||
                                        filename.lowercase().matches(Regex(".*\\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|3gp|ts)$"))
                                    if (isVideo) {
                                        try {
                                            val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                                                context.contentResolver.loadThumbnail(uri, android.util.Size(320, 320), null)
                                            } else {
                                                val retriever = android.media.MediaMetadataRetriever()
                                                retriever.setDataSource(context, uri)
                                                val frame = retriever.getFrameAtTime(1000000)
                                                retriever.release()
                                                frame
                                            }
                                            if (bitmap != null) {
                                                val out = ByteArrayOutputStream()
                                                bitmap.compress(Bitmap.CompressFormat.JPEG, 75, out)
                                                val b64 = android.util.Base64.encodeToString(out.toByteArray(), android.util.Base64.NO_WRAP)
                                                videoThumbBase64 = "data:image/jpeg;base64,$b64"
                                            }
                                        } catch (_: Exception) {}
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
                                        if (!videoThumbBase64.isNullOrBlank()) {
                                            put("thumbnail", videoThumbBase64)
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

    val isGlobalLoading = isRefreshing || isManualUploading || isSyncingNow || isSavingPolicy || isCrudOperating

    if (isInitialLoading) {
        ConnectingToDriveScreen()
        return
    }

    Scaffold(
        topBar = {
            if (selectedTab != 1) {
                Column {
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
                                    withStyle(style = SpanStyle(color = Color(0xFF38BDF8))) {
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
                                    .background(Color(0xFF38BDF8))
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
                                color = Color(0xFF38BDF8),
                                strokeWidth = 2.dp
                            )
                        } else {
                            Icon(
                                Icons.Default.Refresh,
                                contentDescription = "Refresh Data",
                                tint = Color(0xFFE2E8F0)
                            )
                        }
                    }
                    if (userAvatarUrl.isNotBlank()) {
                        AsyncImage(
                            model = userAvatarUrl,
                            contentDescription = userName.ifBlank { "User Profile" },
                            modifier = Modifier
                                .padding(end = 8.dp)
                                .size(34.dp)
                                .clip(CircleShape)
                                .border(1.5.dp, Color(0xFF38BDF8), CircleShape),
                            contentScale = ContentScale.Crop
                        )
                    } else if (userName.isNotBlank()) {
                        Box(
                            modifier = Modifier
                                .padding(end = 8.dp)
                                .size(34.dp)
                                .clip(CircleShape)
                                .background(Color(0xFF1E293B))
                                .border(1.5.dp, Color(0xFF38BDF8), CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = userName.take(1).uppercase(),
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color(0xFF0A0A0E))
            )
                    val globalColorType = when {
                        isManualUploading -> ProgressColorType.UPLOAD
                        isSyncingNow -> ProgressColorType.SYNC
                        isCrudOperating -> ProgressColorType.TRASH
                        else -> ProgressColorType.DEFAULT
                    }
                    SingleRunningProgressBar(
                        isLoading = isGlobalLoading,
                        colorType = globalColorType
                    )
                }
        }
    },
    bottomBar = {
            NavigationBar(
                containerColor = Color(0xFF0A0A0E),
                contentColor = Color.White
            ) {
                NavigationBarItem(
                    selected = selectedTab == 0,
                    onClick = { selectedTab = 0; prefs.edit().putInt("selected_tab", 0).apply() },
                    icon = { Icon(Icons.Default.Folder, contentDescription = "Files") },
                    label = { Text("Files", fontSize = 11.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF38BDF8),
                        selectedTextColor = Color(0xFF38BDF8),
                        indicatorColor = Color(0xFF1E293B),
                        unselectedIconColor = Color(0xFF71717A),
                        unselectedTextColor = Color(0xFF71717A)
                    )
                )
                NavigationBarItem(
                    selected = selectedTab == 1,
                    onClick = { selectedTab = 1; prefs.edit().putInt("selected_tab", 1).apply() },
                    icon = { Icon(Icons.Default.PhotoLibrary, contentDescription = "Gallery") },
                    label = { Text("Gallery", fontSize = 11.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF38BDF8),
                        selectedTextColor = Color(0xFF38BDF8),
                        indicatorColor = Color(0xFF1E293B),
                        unselectedIconColor = Color(0xFF71717A),
                        unselectedTextColor = Color(0xFF71717A)
                    )
                )
                NavigationBarItem(
                    selected = selectedTab == 2,
                    onClick = { selectedTab = 2; prefs.edit().putInt("selected_tab", 2).apply() },
                    icon = { Icon(Icons.Default.SyncAlt, contentDescription = "Transfers") },
                    label = { Text("Transfers", fontSize = 11.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF38BDF8),
                        selectedTextColor = Color(0xFF38BDF8),
                        indicatorColor = Color(0xFF1E293B),
                        unselectedIconColor = Color(0xFF71717A),
                        unselectedTextColor = Color(0xFF71717A)
                    )
                )
                NavigationBarItem(
                    selected = selectedTab == 3,
                    onClick = { selectedTab = 3; prefs.edit().putInt("selected_tab", 3).apply() },
                    icon = { Icon(Icons.Default.Tune, contentDescription = "Policies") },
                    label = { Text("Policies", fontSize = 11.sp) },
                    colors = NavigationBarItemDefaults.colors(
                        selectedIconColor = Color(0xFF38BDF8),
                        selectedTextColor = Color(0xFF38BDF8),
                        indicatorColor = Color(0xFF1E293B),
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
                    containerColor = Color(0xFF38BDF8),
                    contentColor = Color.Black,
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
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF38BDF8)),
                            shape = RoundedCornerShape(8.dp),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Text("Allow", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.Black)
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
                        onActionLoadingChange = { isCrudOperating = it },
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
                        onRefresh = refreshData,
                        onDeleteMedia = { deletedId ->
                            galleryList = galleryList.filter { it.id != deletedId }
                            filesList = filesList.filter { it.id != deletedId }
                            DriveDataCache.updateCache(context = context, files = filesList, gallery = galleryList)
                        },
                        onBulkDeleteMedia = { deletedIds ->
                            galleryList = galleryList.filter { !deletedIds.contains(it.id) }
                            filesList = filesList.filter { !deletedIds.contains(it.id) }
                            DriveDataCache.updateCache(context = context, files = filesList, gallery = galleryList)
                        }
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
                        onWifiOnlyChange = {
                            wifiOnly = it
                            saveCredentials()
                            onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, it, chargingOnly, syncPhotos, syncVideos, syncDocuments)
                        },
                        onChargingOnlyChange = {
                            chargingOnly = it
                            saveCredentials()
                            onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, it, syncPhotos, syncVideos, syncDocuments)
                        },
                        onSyncPhotosChange = {
                            syncPhotos = it
                            saveCredentials()
                            onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, it, syncVideos, syncDocuments)
                        },
                        onSyncVideosChange = {
                            syncVideos = it
                            saveCredentials()
                            onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, it, syncDocuments)
                        },
                        onSyncDocumentsChange = {
                            syncDocuments = it
                            saveCredentials()
                            onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, it)
                        },
                        onUpdatePairedRule = { sId, updatedRule ->
                            pairedRulesMap[sId] = updatedRule
                            savePairedRulesToPrefs()
                        },
                        onSavePolicy = savePolicyAction,
                        onOpenFolderDialog = { showFolderDialog = true },
                        onSyncNow = {
                            saveCredentials()
                            onSyncNow(serverUrl, deviceId, deviceKey, targetFolderId, syncPhotos, syncVideos, syncDocuments) {
                                isSyncingNow = true
                                syncStatusText = "Sync running in background…"
                                Toast.makeText(context, "Background sync running quietly!", Toast.LENGTH_SHORT).show()
                            }
                        },
                        onScheduleSync = {
                            saveCredentials()
                            onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments)
                        },
                        isSyncingNow = isSyncingNow,
                        syncStatusText = liveSyncStatusText.ifBlank { syncStatusText },
                        syncLogLines = syncLogLines,
                        nextSyncTimestamp = nextSyncTimestamp,
                        syncIntervalHours = syncIntervalHours,
                        staggerOffsetMinutes = staggerOffsetMinutes,
                        staggerTotalDevices = staggerTotalDevices,
                        staggerDeviceSlot = staggerDeviceSlot,
                        onSyncIntervalChange = { newHrs ->
                            syncIntervalHours = newHrs
                            prefs.edit().putInt("sync_interval_hours", newHrs).apply()
                            onScheduleSync(serverUrl, deviceId, deviceKey, targetFolderId, wifiOnly, chargingOnly, syncPhotos, syncVideos, syncDocuments)
                            savePolicyAction()
                        }
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
    onActionLoadingChange: (Boolean) -> Unit = {},
    onRefresh: () -> Unit
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    var isActionLoading by remember { mutableStateOf(false) }
    val setActionLoading: (Boolean) -> Unit = { loading ->
        isActionLoading = loading
        onActionLoadingChange(loading)
    }

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

    val folderBreadcrumbs = remember(folders, selectedFolderId) {
        if (selectedFolderId == null) emptyList()
        else {
            val chain = mutableListOf<CloudFolder>()
            var curr: CloudFolder? = folders.find { it.id == selectedFolderId }
            val visited = mutableSetOf<String>()
            while (curr != null && !visited.contains(curr.id)) {
                visited.add(curr.id)
                chain.add(0, curr)
                curr = if (!curr.parentFolderId.isNullOrBlank()) folders.find { it.id == curr?.parentFolderId } else null
            }
            chain
        }
    }

    val visibleSubfolders = remember(folders, selectedFolderId) {
        if (selectedFolderId == null) {
            folders.filter { it.parentFolderId.isNullOrBlank() }
        } else {
            folders.filter { it.parentFolderId == selectedFolderId }
        }
    }
    val chunkedFolders = remember(visibleSubfolders) {
        visibleSubfolders.chunked(2)
    }

    Box(modifier = Modifier.fillMaxSize()) {
        SingleRunningProgressBar(
            isLoading = isRefreshing || isActionLoading,
            colorType = if (isActionLoading) ProgressColorType.TRASH else ProgressColorType.DEFAULT,
            modifier = Modifier.align(Alignment.TopCenter)
        )

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
                                color = Color(0xFF0F172A)
                            ) {
                                Text(
                                    text = "${storageSummary?.connectedAccountsCount ?: 0} Drives",
                                    fontSize = 11.sp,
                                    color = Color(0xFF38BDF8),
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
                            color = Color(0xFF38BDF8),
                            trackColor = Color(0xFF27272A)
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
                                color = Color(0xFF38BDF8)
                            )
                        }
                    }
                }
            }

            // Breadcrumbs and Folders Navigation Section
            // Breadcrumb bar if inside a folder
            if (folderBreadcrumbs.isNotEmpty()) {
                item {
                    LazyRow(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 2.dp)
                    ) {
                        item {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = Color(0xFF181824),
                                modifier = Modifier.clickable { onSelectFilterFolder(null) }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.CloudQueue,
                                        contentDescription = null,
                                        tint = Color(0xFF94A3B8),
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("All Files", color = Color(0xFF94A3B8), fontSize = 11.sp)
                                }
                            }
                        }

                        items(folderBreadcrumbs) { crumb ->
                            val isLast = crumb.id == selectedFolderId
                            Icon(
                                Icons.Default.ChevronRight,
                                contentDescription = null,
                                tint = Color(0xFF52525B),
                                modifier = Modifier.size(14.dp)
                            )
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = if (isLast) Color(0xFF1E293B) else Color(0xFF14141B),
                                modifier = Modifier.clickable { onSelectFilterFolder(crumb.id) }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.Folder,
                                        contentDescription = null,
                                        tint = if (isLast) Color(0xFF38BDF8) else Color(0xFFFBBF24),
                                        modifier = Modifier.size(14.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = crumb.name,
                                        color = if (isLast) Color.White else Color(0xFF94A3B8),
                                        fontSize = 11.sp,
                                        fontWeight = if (isLast) FontWeight.Bold else FontWeight.Normal
                                    )
                                }
                            }
                        }
                    }
                }
            }

            // Visible Subfolders / Root Folders
            if (visibleSubfolders.isNotEmpty()) {
                item {
                    Text(
                        text = if (selectedFolderId == null) "Folders (${visibleSubfolders.size})" else "Subfolders (${visibleSubfolders.size})",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color(0xFF94A3B8),
                        modifier = Modifier.padding(top = 4.dp, bottom = 4.dp)
                    )
                }

                items(chunkedFolders) { pair ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        pair.forEach { folder ->
                            val subCount = folders.count { it.parentFolderId == folder.id }
                            val folderFileCount = files.count { it.folderId == folder.id }
                            Card(
                                modifier = Modifier
                                    .weight(1f)
                                    .combinedClickable(
                                        onClick = { onSelectFilterFolder(folder.id) },
                                        onLongClick = { selectedFolderForMenu = folder }
                                    ),
                                shape = RoundedCornerShape(14.dp),
                                colors = CardDefaults.cardColors(containerColor = Color(0xFF181824)),
                                border = BorderStroke(1.dp, Color(0xFF27273A))
                            ) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .padding(12.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Box(
                                        modifier = Modifier
                                            .size(38.dp)
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(Color(0xFF261D12)),
                                        contentAlignment = Alignment.Center
                                    ) {
                                        Icon(
                                            Icons.Default.Folder,
                                            contentDescription = null,
                                            tint = Color(0xFFFBBF24),
                                            modifier = Modifier.size(20.dp)
                                        )
                                    }
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(
                                            text = folder.name,
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.SemiBold,
                                            color = Color.White,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Spacer(modifier = Modifier.height(2.dp))
                                        val subDesc = if (subCount > 0) "$subCount subs • $folderFileCount files" else "$folderFileCount files"
                                        Text(
                                            text = subDesc,
                                            fontSize = 11.sp,
                                            color = Color(0xFF71717A),
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                }
                            }
                        }
                        if (pair.size == 1) {
                            Spacer(modifier = Modifier.weight(1f))
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
                    colors = CardDefaults.cardColors(containerColor = if (isSelected) Color(0xFF1E293B) else Color(0xFF14141C)),
                    border = if (isSelected) BorderStroke(1.dp, Color(0xFF38BDF8)) else BorderStroke(1.dp, Color(0xFF27272A))
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
                            file.mimeType.startsWith("video/") -> Color(0xFF38BDF8)
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
                                        checkedColor = Color(0xFF38BDF8),
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
                    color = Color(0xFF111116),
                    border = BorderStroke(1.dp, Color(0xFF27272A)),
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
                            Icon(Icons.Default.SelectAll, contentDescription = "Select All", tint = Color(0xFF38BDF8))
                        }
                        IconButton(onClick = {
                            val itemsToDownload = filteredFiles.filter { it.id in selectedFileIds }
                            itemsToDownload.forEach { f ->
                                val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${f.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
                                downloadFileToDevice(context, streamUrl, f.filename, deviceId, deviceKey, f.mimeType)
                            }
                            onSelectionModeChange(false)
                            selectedFileIds.clear()
                        }) {
                            Icon(Icons.Default.Download, contentDescription = "Download", tint = Color(0xFF38BDF8))
                        }
                        IconButton(onClick = {
                            coroutineScope.launch {
                                setActionLoading(true)
                                try {
                                    apiBulkAction(serverUrl, deviceId, deviceKey, "favorite", selectedFileIds.toList())
                                    onRefresh()
                                    onSelectionModeChange(false)
                                    selectedFileIds.clear()
                                } finally {
                                    setActionLoading(false)
                                }
                            }
                        }) {
                            Icon(Icons.Default.Star, contentDescription = "Favorite", tint = Color.White)
                        }
                        IconButton(onClick = { showMoveDialog = true }) {
                            Icon(Icons.Default.DriveFileMove, contentDescription = "Move", tint = Color.White)
                        }
                        IconButton(onClick = {
                            coroutineScope.launch {
                                setActionLoading(true)
                                try {
                                    apiBulkAction(serverUrl, deviceId, deviceKey, "trash", selectedFileIds.toList())
                                    onRefresh()
                                    onSelectionModeChange(false)
                                    selectedFileIds.clear()
                                } finally {
                                    setActionLoading(false)
                                }
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
                        leadingIcon = { Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF38BDF8)) },
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
                            downloadFileToDevice(context, streamUrl, file.filename, deviceId, deviceKey, file.mimeType)
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
                                setActionLoading(true)
                                try {
                                    apiToggleFavorite(serverUrl, deviceId, deviceKey, file.id, true)
                                    onRefresh()
                                } finally {
                                    setActionLoading(false)
                                }
                            }
                            selectedFileForMenu = null
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Move to Trash", color = Color.White) },
                        leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = Color.White) },
                        onClick = {
                            coroutineScope.launch {
                                setActionLoading(true)
                                try {
                                    apiTrashFile(serverUrl, deviceId, deviceKey, file.id)
                                    onRefresh()
                                } finally {
                                    setActionLoading(false)
                                }
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
                    Text("Close", color = Color(0xFF38BDF8))
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
                        focusedBorderColor = Color(0xFF38BDF8),
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
                        setActionLoading(true)
                        try {
                            apiRenameFile(serverUrl, deviceId, deviceKey, f.id, newFileName)
                            onRefresh()
                        } finally {
                            setActionLoading(false)
                        }
                    }
                    fileToRename = null
                }) {
                    Text("Rename", color = Color(0xFF38BDF8))
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
        val dateFormatted = formatDetailsDate(f.takenAt ?: f.createdAt)
        AlertDialog(
            onDismissRequest = { fileToShowDetails = null },
            containerColor = Color(0xFF14141C),
            title = { Text("File Details", color = Color.White) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Name: ${f.filename}", color = Color.White)
                    Text("Type: ${f.mimeType}", color = Color.White)
                    Text("Size: ${formatBytes(f.sizeBytes)}", color = Color.White)
                    if (!f.takenAt.isNullOrBlank()) {
                        Text("Taken Date & Time: $dateFormatted", color = Color(0xFF38BDF8), fontWeight = FontWeight.SemiBold)
                    } else {
                        Text("Created: $dateFormatted", color = Color.White)
                    }
                    Text("Folder ID: ${f.folderId ?: "None"}", color = Color.White)
                }
            },
            confirmButton = {
                TextButton(onClick = { fileToShowDetails = null }) {
                    Text("Close", color = Color(0xFF38BDF8))
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
                    setActionLoading(true)
                    try {
                        if (selectedFileIds.isNotEmpty()) {
                            apiBulkAction(serverUrl, deviceId, deviceKey, "move", selectedFileIds.toList(), folderId)
                        }
                        onRefresh()
                        onSelectionModeChange(false)
                        selectedFileIds.clear()
                    } finally {
                        setActionLoading(false)
                    }
                }
                showMoveDialog = false
            },
            onCreateFolder = { folderName, parentId ->
                coroutineScope.launch {
                    setActionLoading(true)
                    try {
                        val baseUrl = serverUrl.trimEnd('/')
                        val body = JSONObject().apply {
                            put("name", folderName.trim())
                            if (!parentId.isNullOrBlank()) {
                                put("parentFolderId", parentId)
                            }
                        }
                        val req = Request.Builder()
                            .url("$baseUrl/api/v1/files/folders/create")
                            .addHeader("x-device-id", deviceId)
                            .addHeader("x-device-key", deviceKey)
                            .post(body.toString().toRequestBody("application/json".toMediaType()))
                            .build()
                        sharedHttpClient.newCall(req).execute().close()
                        onRefresh()
                    } catch (e: Exception) {
                        e.printStackTrace()
                    } finally {
                        setActionLoading(false)
                    }
                }
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
                    Text("Close", color = Color(0xFF38BDF8))
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
                        focusedBorderColor = Color(0xFF38BDF8),
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
                                setActionLoading(true)
                                try {
                                    apiRenameFolder(serverUrl, deviceId, deviceKey, f.id, newName)
                                    onRefresh()
                                } finally {
                                    setActionLoading(false)
                                }
                            }
                        }
                        folderToRename = null
                    },
                    enabled = renameFolderNameInput.isNotBlank() && renameFolderNameInput.trim() != f.name
                ) {
                    Text("Rename", color = Color(0xFF38BDF8))
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
                        setActionLoading(true)
                        try {
                            apiDeleteFolder(serverUrl, deviceId, deviceKey, f.id)
                            onRefresh()
                        } finally {
                            setActionLoading(false)
                        }
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
                color = if (subTab == 0) Color(0xFF38BDF8) else Color.Transparent
            ) {
                Row(
                    modifier = Modifier.padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.CloudUpload,
                        contentDescription = null,
                        tint = if (subTab == 0) Color.Black else Color(0xFF94A3B8),
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Uploaded (${uploadedFiles.size})",
                        color = if (subTab == 0) Color.Black else Color(0xFF94A3B8),
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
                color = if (subTab == 1) Color(0xFF38BDF8) else Color.Transparent
            ) {
                Row(
                    modifier = Modifier.padding(vertical = 10.dp),
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.CloudDownload,
                        contentDescription = null,
                        tint = if (subTab == 1) Color.Black else Color(0xFF94A3B8),
                        modifier = Modifier.size(16.dp)
                    )
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(
                        text = "Synced (${inboundFiles.size})",
                        color = if (subTab == 1) Color.Black else Color(0xFF94A3B8),
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
                    color = if (isSelected) Color(0xFF1E293B) else Color(0xFF14141C),
                    border = BorderStroke(1.dp, if (isSelected) Color(0xFF38BDF8) else Color(0xFF242432))
                ) {
                    Text(
                        text = cat,
                        color = if (isSelected) Color(0xFF38BDF8) else Color(0xFF94A3B8),
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
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                    shape = RoundedCornerShape(10.dp),
                    contentPadding = PaddingValues(horizontal = 8.dp, vertical = 6.dp)
                ) {
                    Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Upload Gallery", color = Color(0xFFF8FAFC), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
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
                        Icon(Icons.Default.CloudUpload, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(48.dp))
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
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF38BDF8),
                                    contentColor = Color.Black
                                ),
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
                                    if (isImage || isVideo) {
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
                                        if (isVideo) {
                                            Box(
                                                modifier = Modifier
                                                    .fillMaxSize()
                                                    .background(Color.Black.copy(alpha = 0.25f)),
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                                            }
                                        }
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
                                    color = Color(0xFF1E293B)
                                ) {
                                    Text(
                                        text = "Cloud Stored",
                                        color = Color(0xFF38BDF8),
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
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF38BDF8),
                            contentColor = Color.Black
                        ),
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
                                    if (isImage || isVideo) {
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
                                        if (isVideo) {
                                            Box(
                                                modifier = Modifier
                                                    .fillMaxSize()
                                                    .background(Color.Black.copy(alpha = 0.25f)),
                                                contentAlignment = Alignment.Center
                                            ) {
                                                Icon(Icons.Default.PlayArrow, contentDescription = null, tint = Color.White, modifier = Modifier.size(16.dp))
                                            }
                                        }
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
                                            color = Color(0xFF1E293B)
                                        ) {
                                            Text(
                                                text = "From: ${item.sourceDeviceLabel}",
                                                color = Color(0xFF38BDF8),
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
                                        tint = if (item.isDownloadedLocally) Color(0xFF10B981) else Color(0xFF38BDF8),
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
    syncLogLines: List<String> = emptyList(),
    nextSyncTimestamp: Long = 0L,
    syncIntervalHours: Int = 2,
    staggerOffsetMinutes: Int = 0,
    staggerTotalDevices: Int = 1,
    staggerDeviceSlot: Int = 1,
    onSyncIntervalChange: (Int) -> Unit = {}
) {
    val scrollState = rememberScrollState()
    val context = LocalContext.current
    val powerManager = remember { context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager }
    var isIgnoringBatteryOptimizations by remember {
        mutableStateOf(powerManager?.isIgnoringBatteryOptimizations(context.packageName) ?: false)
    }
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
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.Top
                ) {
                    Column(modifier = Modifier.weight(0.9f)) {
                        Text("Total Uploaded", fontSize = 10.sp, color = Color(0xFF71717A))
                        Text("$totalSyncedCount files", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    }
                    Column(modifier = Modifier.weight(1.1f), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Last Sync", fontSize = 10.sp, color = Color(0xFF71717A))
                        val formattedTime = if (lastSyncTimestamp > 0) {
                            SimpleDateFormat("h:mm a, MMM d", Locale.getDefault()).format(Date(lastSyncTimestamp))
                        } else "Never"
                        Text(formattedTime, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF38BDF8), textAlign = TextAlign.Center)
                    }
                    Column(modifier = Modifier.weight(1.1f), horizontalAlignment = Alignment.End) {
                        Text("Next Sync", fontSize = 10.sp, color = Color(0xFF71717A))
                        val nextFormatted = if (nextSyncTimestamp > 0) {
                            val diffMs = nextSyncTimestamp - System.currentTimeMillis()
                            val relative = when {
                                diffMs <= 0 -> "Due soon"
                                diffMs < 3600 * 1000L -> "in ${diffMs / (60 * 1000L)}m"
                                else -> "in ${diffMs / (3600 * 1000L)}h ${(diffMs % (3600 * 1000L)) / (60 * 1000L)}m"
                            }
                            "${SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(nextSyncTimestamp))}\n($relative)"
                        } else "In ~$syncIntervalHours hrs"
                        Text(nextFormatted, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = Color(0xFF34D399), textAlign = TextAlign.End)
                    }
                }

                if (staggerTotalDevices > 1) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Color(0xFF1B1B2A)
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(Icons.Default.Bolt, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(14.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Collision Protection: Slot $staggerDeviceSlot of $staggerTotalDevices (+${staggerOffsetMinutes}m offset)",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                color = Color(0xFF7DD3FC)
                            )
                        }
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
                                color = Color(0xFF38BDF8),
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
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF38BDF8),
                            contentColor = Color.Black
                        )
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
                            text = if (isSyncingNow) "Live sync running" else "Sync history & logs",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFF6EE7B7),
                            modifier = Modifier.weight(1f)
                        )
                        if (syncLogLines.isNotEmpty() && !isSyncingNow) {
                            Text(
                                text = "Clear",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Medium,
                                color = Color(0xFF9CA3AF),
                                modifier = Modifier
                                    .clickable {
                                        SyncLogManager.clear()
                                    }
                                    .padding(horizontal = 4.dp, vertical = 2.dp)
                            )
                        }
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

                    // Per-file log (newest first, max 100 lines visible)
                    if (syncLogLines.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(10.dp))
                        HorizontalDivider(color = Color(0xFF1F2E1F))
                        Spacer(modifier = Modifier.height(8.dp))
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(max = 240.dp)
                                .verticalScroll(rememberScrollState())
                        ) {
                            syncLogLines.take(100).forEach { line ->
                                val color = when {
                                    line.contains("✓") -> Color(0xFF86EFAC)
                                    line.contains("⏩") -> Color(0xFF9CA3AF)
                                    line.contains("✗") -> Color(0xFFFCA5A5)
                                    line.contains("❌") -> Color(0xFFEF4444)
                                    line.contains("✅") -> Color(0xFF34D399)
                                    line.contains("⚠") -> Color(0xFFFBBF24)
                                    line.contains("──") || line.contains("═") -> Color(0xFF6B7280)
                                    else -> Color(0xFFD1D5DB)
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

        // Auto Sync Schedule & Interval Setting
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = Color(0xFF14141B),
            border = BorderStroke(1.dp, Color(0xFF27272A)),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Schedule, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Auto-Sync Interval: Every $syncIntervalHours hours",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = Color.White
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = if (staggerTotalDevices > 1) {
                        "Scheduled across $staggerTotalDevices connected devices with staggered time offsets (+${staggerOffsetMinutes}m) so they never collide or sync simultaneously."
                    } else {
                        "Background auto sync periodically backs up photos, videos, and documents to your cloud storage pool without draining battery."
                    },
                    fontSize = 11.sp,
                    color = Color(0xFF9CA3AF),
                    lineHeight = 16.sp
                )
                Spacer(modifier = Modifier.height(10.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    listOf(1, 2, 4, 6, 12).forEach { hrs ->
                        val isSelected = syncIntervalHours == hrs
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (isSelected) Color(0xFF1E293B) else Color(0xFF14141C),
                            border = BorderStroke(1.dp, if (isSelected) Color(0xFF38BDF8) else Color(0xFF2E2E3A)),
                            modifier = Modifier
                                .weight(1f)
                                .clickable { onSyncIntervalChange(hrs) }
                        ) {
                            Text(
                                text = "${hrs}h",
                                color = if (isSelected) Color(0xFF38BDF8) else Color(0xFF94A3B8),
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                textAlign = TextAlign.Center,
                                modifier = Modifier.padding(vertical = 8.dp)
                            )
                        }
                    }
                }
            }
        }

        // Battery Optimization Card (Crucial for Realme / Oppo / Xiaomi devices)
        if (!isIgnoringBatteryOptimizations) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(14.dp),
                colors = CardDefaults.cardColors(containerColor = Color(0xFF261D12)),
                border = BorderStroke(1.dp, Color(0xFFF59E0B).copy(alpha = 0.45f))
            ) {
                Column(modifier = Modifier.padding(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Warning, contentDescription = null, tint = Color(0xFFFBBF24), modifier = Modifier.size(18.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Background Auto-Sync Optimization",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color(0xFFFDE68A)
                        )
                    }
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Realme / ColorOS freezes background apps to save power. Tap below to allow unrestricted background activity so scheduled auto-sync triggers reliably.",
                        fontSize = 11.sp,
                        color = Color(0xFFD1D5DB),
                        lineHeight = 16.sp
                    )
                    Spacer(modifier = Modifier.height(10.dp))
                    Button(
                        onClick = {
                            try {
                                val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                                    data = Uri.parse("package:${context.packageName}")
                                }
                                context.startActivity(intent)
                            } catch (_: Exception) {
                                val fallback = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                                    data = Uri.parse("package:${context.packageName}")
                                }
                                context.startActivity(fallback)
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFD97706)),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 6.dp),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Allow Unrestricted Background Sync", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = Color.White)
                    }
                }
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
                                .background(Color(0xFF1E293B)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                Icons.Default.FolderSpecial,
                                contentDescription = null,
                                tint = Color(0xFF38BDF8),
                                modifier = Modifier.size(22.dp)
                            )
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text("Upload Destination Folder", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text(
                                text = "Selected: $targetFolderName",
                                fontSize = 11.sp,
                                color = Color(0xFF38BDF8),
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    Button(
                        onClick = onOpenFolderDialog,
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                        shape = RoundedCornerShape(10.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                    ) {
                        Text("Change", color = Color(0xFF38BDF8), fontSize = 11.sp, fontWeight = FontWeight.SemiBold)
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
                        Icon(Icons.Default.Image, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(18.dp))
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
                        Icon(Icons.Default.Movie, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(18.dp))
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
                        Icon(Icons.Default.Devices, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(20.dp))
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
                                    Text("Auto Download to Phone Gallery", fontSize = 12.sp, color = Color(0xFF38BDF8), fontWeight = FontWeight.SemiBold)
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
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF38BDF8),
                        contentColor = Color.Black
                    )
                ) {
                    if (isSavingPolicy) {
                        CircularProgressIndicator(modifier = Modifier.size(16.dp), color = Color.Black, strokeWidth = 2.dp)
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
                        Text(if (showCredentials) "Hide" else "Show / Edit", color = Color(0xFF38BDF8), fontSize = 12.sp)
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
                            focusedBorderColor = Color(0xFF38BDF8),
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
                            focusedBorderColor = Color(0xFF38BDF8),
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
                            focusedBorderColor = Color(0xFF38BDF8),
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

    // Direct video streaming via streamUrl for instant playback
    val resolvedVideoUrl = streamUrl
    var isMediaLoading by remember { mutableStateOf(isImage) }
    var rotation by remember { mutableFloatStateOf(0f) }

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

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (isImage) {
                            IconButton(onClick = { rotation = (rotation + 90f) % 360f }) {
                                Icon(Icons.Default.RotateRight, contentDescription = "Rotate", tint = Color.White)
                            }
                        }

                        IconButton(
                            onClick = {
                                downloadFileToDevice(context, streamUrl, file.filename, deviceId, deviceKey, file.mimeType)
                            }
                        ) {
                            Icon(Icons.Default.Download, contentDescription = "Download", tint = Color(0xFF38BDF8))
                        }
                    }
                }

                SingleRunningProgressBar(
                    isLoading = isMediaLoading,
                    colorType = ProgressColorType.DECRYPT
                )

                // Media Preview Body
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .weight(1f),
                    contentAlignment = Alignment.Center
                ) {
                    if (isImage) {
                        var isLoading by remember { mutableStateOf(true) }
                        val thumbUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${file.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"

                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            if (isLoading) {
                                AsyncImage(
                                    model = ImageRequest.Builder(context)
                                        .data(thumbUrl)
                                        .addHeader("x-device-id", deviceId)
                                        .addHeader("x-device-key", deviceKey)
                                        .placeholderMemoryCacheKey("thumb_${file.id}")
                                        .memoryCacheKey("thumb_${file.id}")
                                        .diskCacheKey("thumb_${file.id}")
                                        .crossfade(false)
                                        .build(),
                                    contentDescription = null,
                                    modifier = Modifier
                                        .fillMaxSize()
                                        .padding(12.dp)
                                        .graphicsLayer(rotationZ = rotation),
                                    contentScale = ContentScale.Fit
                                )
                            }

                            AsyncImage(
                                model = ImageRequest.Builder(context)
                                    .data(streamUrl)
                                    .addHeader("x-device-id", deviceId)
                                    .addHeader("x-device-key", deviceKey)
                                    .crossfade(true)
                                    .listener(
                                        onSuccess = { _, _ ->
                                            isLoading = false
                                            isMediaLoading = false
                                        },
                                        onError = { _, _ ->
                                            isLoading = false
                                            isMediaLoading = false
                                        }
                                    )
                                    .build(),
                                contentDescription = file.filename,
                                modifier = Modifier
                                    .fillMaxSize()
                                    .padding(12.dp)
                                    .graphicsLayer(rotationZ = rotation),
                                contentScale = ContentScale.Fit
                            )
                        }
                    } else if (isVideo) {
                        val thumbUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${file.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"
                        VideoPlayer(
                            streamUrl = resolvedVideoUrl,
                            filename = file.filename,
                            thumbnailUrl = thumbUrl,
                            fileId = file.id,
                            deviceId = deviceId,
                            deviceKey = deviceKey
                        )
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
                                tint = Color(0xFF38BDF8),
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
                        border = BorderStroke(1.dp, Color(0xFF27272A)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Close")
                    }

                    Button(
                        onClick = {
                            downloadFileToDevice(context, streamUrl, file.filename, deviceId, deviceKey, file.mimeType)
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF38BDF8)),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Icon(Icons.Default.Download, contentDescription = null, tint = Color.Black, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Save to Phone", color = Color.Black, fontWeight = FontWeight.Bold)
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
    thumbnailUrl: String = "",
    fileId: String = "",
    deviceId: String = "",
    deviceKey: String = "",
    modifier: Modifier = Modifier
) {
    ModernExoPlayerView(
        streamUrl = streamUrl,
        filename = filename,
        thumbnailUrl = thumbnailUrl,
        fileId = fileId,
        deviceId = deviceId,
        deviceKey = deviceKey,
        showTopBar = true,
        modifier = modifier
    )
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
            Text("Rendering document…", color = Color(0xFF94A3B8), fontSize = 13.sp)
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
                        colors = ButtonDefaults.buttonColors(
                            containerColor = Color(0xFF38BDF8),
                            contentColor = Color.Black
                        ),
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
                            colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1E293B)),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(
                                Icons.Default.OpenInNew,
                                contentDescription = null,
                                tint = Color(0xFF38BDF8),
                                modifier = Modifier.size(14.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Open in PDF App", color = Color(0xFF38BDF8), fontSize = 12.sp)
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
// Folder Selection & Creation Dialog (with Nested Browsing)
// ----------------------------------------------------
@Composable
fun FolderPickerDialog(
    folders: List<CloudFolder>,
    currentFolderId: String,
    onSelectFolder: (String, String) -> Unit,
    onCreateFolder: (String, String?) -> Unit,
    onDismiss: () -> Unit
) {
    var browsingFolderId by remember { mutableStateOf<String?>(null) }
    var newFolderName by remember { mutableStateOf("") }

    val currentBrowsingFolder = remember(folders, browsingFolderId) {
        folders.find { it.id == browsingFolderId }
    }

    val breadcrumbChain = remember(folders, browsingFolderId) {
        if (browsingFolderId == null) emptyList()
        else {
            val chain = mutableListOf<CloudFolder>()
            var curr: CloudFolder? = folders.find { it.id == browsingFolderId }
            val visited = mutableSetOf<String>()
            while (curr != null && !visited.contains(curr.id)) {
                visited.add(curr.id)
                chain.add(0, curr)
                curr = if (!curr.parentFolderId.isNullOrBlank()) folders.find { it.id == curr?.parentFolderId } else null
            }
            chain
        }
    }

    val currentLevelFolders = remember(folders, browsingFolderId) {
        if (browsingFolderId == null) {
            folders.filter { it.parentFolderId.isNullOrBlank() }
        } else {
            folders.filter { it.parentFolderId == browsingFolderId }
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF14141C),
        title = {
            Column {
                Text(
                    text = "Select Upload Folder",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 17.sp
                )
                Spacer(modifier = Modifier.height(8.dp))
                // Breadcrumb Navigation
                LazyRow(
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    item {
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = if (browsingFolderId == null) Color(0xFF1E293B) else Color(0xFF1F1F2C),
                            modifier = Modifier.clickable { browsingFolderId = null }
                        ) {
                            Text(
                                text = "Root",
                                color = if (browsingFolderId == null) Color(0xFF38BDF8) else Color(0xFF94A3B8),
                                fontSize = 11.sp,
                                fontWeight = if (browsingFolderId == null) FontWeight.Bold else FontWeight.Normal,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp)
                            )
                        }
                    }
                    items(breadcrumbChain) { item ->
                        Icon(
                            Icons.Default.ChevronRight,
                            contentDescription = null,
                            tint = Color(0xFF52525B),
                            modifier = Modifier.size(12.dp)
                        )
                        val isCurrent = item.id == browsingFolderId
                        Surface(
                            shape = RoundedCornerShape(6.dp),
                            color = if (isCurrent) Color(0xFF1E293B) else Color(0xFF1F1F2C),
                            modifier = Modifier.clickable { browsingFolderId = item.id }
                        ) {
                            Text(
                                text = item.name,
                                color = if (isCurrent) Color(0xFF38BDF8) else Color(0xFF94A3B8),
                                fontSize = 11.sp,
                                fontWeight = if (isCurrent) FontWeight.Bold else FontWeight.Normal,
                                modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }
                }
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                // Button to select the currently browsed folder as destination
                val isCurrentBrowsingSelected = if (browsingFolderId == null) {
                    currentFolderId.isBlank()
                } else {
                    currentFolderId == browsingFolderId
                }

                Surface(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .clickable {
                            if (browsingFolderId == null) {
                                onSelectFolder("", "Root (My Drive)")
                            } else {
                                onSelectFolder(browsingFolderId!!, currentBrowsingFolder?.name ?: "Folder")
                            }
                        },
                    color = if (isCurrentBrowsingSelected) Color(0xFF1E293B) else Color(0xFF1C1C28)
                ) {
                    Row(
                        modifier = Modifier.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            if (browsingFolderId == null) Icons.Default.CloudQueue else Icons.Default.FolderOpen,
                            contentDescription = null,
                            tint = if (isCurrentBrowsingSelected) Color(0xFF38BDF8) else Color(0xFF64748B),
                            modifier = Modifier.size(20.dp)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = if (browsingFolderId == null) "Use 'Root (My Drive)'" else "Use '${currentBrowsingFolder?.name}'",
                                color = Color.White,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = if (isCurrentBrowsingSelected) "Currently selected destination" else "Tap to select this folder",
                                color = if (isCurrentBrowsingSelected) Color(0xFF38BDF8) else Color(0xFF71717A),
                                fontSize = 10.sp
                            )
                        }
                        if (isCurrentBrowsingSelected) {
                            Icon(
                                Icons.Default.Check,
                                contentDescription = "Selected",
                                tint = Color(0xFF38BDF8),
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }
                }

                if (currentLevelFolders.isNotEmpty()) {
                    Text(
                        text = if (browsingFolderId == null) "Folders in Root:" else "Subfolders in ${currentBrowsingFolder?.name}:",
                        color = Color(0xFF94A3B8),
                        fontSize = 11.sp,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.padding(top = 4.dp)
                    )

                    currentLevelFolders.forEach { folder ->
                        val subCount = folders.count { it.parentFolderId == folder.id }
                        val isThisFolderSelected = currentFolderId == folder.id
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(10.dp)),
                            color = if (isThisFolderSelected) Color(0xFF1E293B) else Color(0xFF1C1C28)
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 10.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Row(
                                    modifier = Modifier
                                        .weight(1f)
                                        .clickable { browsingFolderId = folder.id },
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.Folder,
                                        contentDescription = null,
                                        tint = if (isThisFolderSelected) Color(0xFF38BDF8) else Color(0xFFFBBF24),
                                        modifier = Modifier.size(20.dp)
                                    )
                                    Spacer(modifier = Modifier.width(10.dp))
                                    Column {
                                        Text(
                                            text = folder.name,
                                            color = Color.White,
                                            fontSize = 13.sp,
                                            fontWeight = if (isThisFolderSelected) FontWeight.Bold else FontWeight.Normal
                                        )
                                        if (subCount > 0) {
                                            Text(
                                                text = "$subCount subfolder(s) • Tap to enter",
                                                color = Color(0xFF71717A),
                                                fontSize = 10.sp
                                            )
                                        } else {
                                            Text(
                                                text = "Tap to enter",
                                                color = Color(0xFF52525B),
                                                fontSize = 10.sp
                                            )
                                        }
                                    }
                                }

                                IconButton(
                                    onClick = { onSelectFolder(folder.id, folder.name) },
                                    modifier = Modifier.size(32.dp)
                                ) {
                                    Icon(
                                        Icons.Default.CheckCircleOutline,
                                        contentDescription = "Select this folder",
                                        tint = if (isThisFolderSelected) Color(0xFF38BDF8) else Color(0xFF71717A),
                                        modifier = Modifier.size(20.dp)
                                    )
                                }
                            }
                        }
                    }
                }

                HorizontalDivider(color = Color(0xFF27273A), modifier = Modifier.padding(vertical = 4.dp))

                // Create New Folder section
                Text(
                    text = if (browsingFolderId == null) "Create Folder in Root:" else "Create Subfolder in ${currentBrowsingFolder?.name}:",
                    color = Color.White,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 12.sp
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
                        focusedBorderColor = Color(0xFF38BDF8),
                        unfocusedBorderColor = Color(0xFF27273A)
                    )
                )

                Button(
                    onClick = {
                        if (newFolderName.isNotBlank()) {
                            onCreateFolder(newFolderName, browsingFolderId)
                        }
                    },
                    enabled = newFolderName.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFF38BDF8),
                        disabledContainerColor = Color(0xFF1E293B),
                        contentColor = Color.Black
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
                Icon(Icons.Default.CloudUpload, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(24.dp))
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
                            Text(targetFolderName, fontSize = 13.sp, fontWeight = FontWeight.Bold, color = Color(0xFF38BDF8))
                        }
                        TextButton(onClick = onOpenFolderSelector) {
                            Text("Change", color = Color(0xFF38BDF8), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
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
                    colors = CardDefaults.cardColors(containerColor = Color(0xFF14141B)),
                    border = BorderStroke(1.dp, Color(0xFF27272A))
                ) {
                    Row(
                        modifier = Modifier.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(10.dp))
                                .background(Color(0xFF1E293B)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(Icons.Default.PhotoLibrary, contentDescription = null, tint = Color(0xFF38BDF8), modifier = Modifier.size(22.dp))
                        }
                        Spacer(modifier = Modifier.width(12.dp))
                        Column {
                            Text("Photos & Videos", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = Color.White)
                            Text("Select multiple media from Gallery", fontSize = 11.sp, color = Color(0xFF94A3B8))
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

fun reportSyncStatusToServer(
    httpClient: OkHttpClient,
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
            put("deviceId", deviceId)
            put("status", status)
            put("currentSyncActivity", activity)
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
        httpClient.newCall(req).execute().close()
    } catch (_: Exception) {}
}

suspend fun downloadInboundFileLocally(
    context: Context,
    httpClient: OkHttpClient,
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    fileId: String,
    filename: String,
    mimeType: String
): Boolean {
    return withContext(Dispatchers.IO) {
        try {
            val base = serverUrl.trimEnd('/')
            val streamUrl = "$base/api/v1/files/$fileId/stream?deviceId=$deviceId&deviceKey=$deviceKey"
            val req = Request.Builder()
                .url(streamUrl)
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .build()
            val res = httpClient.newCall(req).execute()
            if (!res.isSuccessful) {
                res.close()
                return@withContext false
            }
            val body = res.body ?: return@withContext false

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

            val contentResolver = context.contentResolver
            var insertedUri: Uri? = null
            var localFilePath: String? = null

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val collection = when {
                    isVideo -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    isImage -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                }
                val relPath = when {
                    isVideo -> Environment.DIRECTORY_MOVIES + "/myDrive"
                    isImage -> Environment.DIRECTORY_PICTURES + "/myDrive"
                    else -> Environment.DIRECTORY_DOWNLOADS + "/myDrive"
                }

                val contentValues = ContentValues().apply {
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
                    val updateValues = ContentValues().apply {
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
                    isVideo -> Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
                    isImage -> Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                    else -> Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                }
                val targetDir = File(baseDir, "myDrive")
                targetDir.mkdirs()
                var targetFile = File(targetDir, filename)
                if (targetFile.exists()) {
                    val dot = filename.lastIndexOf('.')
                    val safeName = if (dot != -1) {
                        "${filename.substring(0, dot)}_${System.currentTimeMillis()}${filename.substring(dot)}"
                    } else {
                        "${filename}_${System.currentTimeMillis()}"
                    }
                    targetFile = File(targetDir, safeName)
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
                    context.applicationContext,
                    arrayOf(localFilePath),
                    arrayOf(effectiveMime),
                    null
                )
            }
            if (insertedUri != null) {
                try {
                    val scanIntent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, insertedUri)
                    context.sendBroadcast(scanIntent)
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
                val historyFile = File(context.filesDir, "synced_$category.txt")
                historyFile.appendText("$localId\n")
            }

            // Post download completion notification
            SyncNotificationHelper.showDownloadCompleteNotification(
                context = context,
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
                .url("$base/api/v1/files/device/$deviceId/mark-synced")
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .post(markJson.toString().toRequestBody("application/json".toMediaType()))
                .build()
            val markRes = httpClient.newCall(markReq).execute()
            markRes.close()

            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }
}

fun downloadFileToDevice(
    context: Context,
    url: String,
    filename: String,
    deviceId: String,
    deviceKey: String,
    mimeType: String = "",
    saveToGallery: Boolean = false,
    onSuccess: (() -> Unit)? = null
) {
    val isImage = mimeType.startsWith("image/") ||
            filename.endsWith(".jpg", true) ||
            filename.endsWith(".jpeg", true) ||
            filename.endsWith(".png", true) ||
            filename.endsWith(".webp", true) ||
            filename.endsWith(".heic", true) ||
            filename.endsWith(".gif", true) ||
            filename.endsWith(".bmp", true) ||
            filename.endsWith(".svg", true)

    val isVideo = mimeType.startsWith("video/") ||
            filename.endsWith(".mp4", true) ||
            filename.endsWith(".mkv", true) ||
            filename.endsWith(".mov", true) ||
            filename.endsWith(".webm", true) ||
            filename.endsWith(".3gp", true) ||
            filename.endsWith(".avi", true)

    val isMedia = saveToGallery || isImage || isVideo
    val destName = if (isMedia) "Phone Gallery" else "Downloads/myDrive"
    Toast.makeText(context, "Saving $filename to $destName...", Toast.LENGTH_SHORT).show()

    CoroutineScope(Dispatchers.IO).launch {
        try {
            val req = Request.Builder()
                .url(url)
                .addHeader("x-device-id", deviceId)
                .addHeader("x-device-key", deviceKey)
                .build()
            val res = sharedHttpClient.newCall(req).execute()
            if (!res.isSuccessful) {
                res.close()
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Download failed (HTTP ${res.code})", Toast.LENGTH_SHORT).show()
                }
                return@launch
            }
            val body = res.body ?: run {
                withContext(Dispatchers.Main) {
                    Toast.makeText(context, "Download failed: Empty server response", Toast.LENGTH_SHORT).show()
                }
                return@launch
            }

            val effectiveMime = when {
                mimeType.isNotBlank() && mimeType != "application/octet-stream" -> mimeType
                isVideo -> "video/mp4"
                isImage -> if (filename.endsWith(".png", true)) "image/png" else "image/jpeg"
                filename.endsWith(".pdf", true) -> "application/pdf"
                filename.endsWith(".zip", true) -> "application/zip"
                filename.endsWith(".txt", true) -> "text/plain"
                else -> "application/octet-stream"
            }

            var insertedUri: Uri? = null
            var localFilePath: String? = null

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val collection = when {
                    isVideo -> MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    isImage -> MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                    else -> MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                }
                val relPath = when {
                    isVideo -> Environment.DIRECTORY_MOVIES + "/myDrive"
                    isImage -> Environment.DIRECTORY_PICTURES + "/myDrive"
                    else -> Environment.DIRECTORY_DOWNLOADS + "/myDrive"
                }

                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
                    put(MediaStore.MediaColumns.MIME_TYPE, effectiveMime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, relPath)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }

                insertedUri = context.contentResolver.insert(collection, values)
                if (insertedUri == null) {
                    val dot = filename.lastIndexOf('.')
                    val safeName = if (dot != -1) {
                        "${filename.substring(0, dot)}_${System.currentTimeMillis()}${filename.substring(dot)}"
                    } else {
                        "${filename}_${System.currentTimeMillis()}"
                    }
                    values.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                    insertedUri = context.contentResolver.insert(collection, values)
                }

                if (insertedUri != null) {
                    context.contentResolver.openOutputStream(insertedUri)?.use { out ->
                        body.byteStream().use { input ->
                            input.copyTo(out)
                        }
                    }
                    values.clear()
                    values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                    context.contentResolver.update(insertedUri, values, null, null)

                    try {
                        context.contentResolver.query(insertedUri, arrayOf(MediaStore.MediaColumns.DATA), null, null, null)?.use { cursor ->
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
                    isVideo -> Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES)
                    isImage -> Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES)
                    else -> Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                }
                val targetDir = File(baseDir, "myDrive")
                targetDir.mkdirs()
                var targetFile = File(targetDir, filename)
                if (targetFile.exists()) {
                    val dot = filename.lastIndexOf('.')
                    val safeName = if (dot != -1) {
                        "${filename.substring(0, dot)}_${System.currentTimeMillis()}${filename.substring(dot)}"
                    } else {
                        "${filename}_${System.currentTimeMillis()}"
                    }
                    targetFile = File(targetDir, safeName)
                }
                targetFile.outputStream().use { out ->
                    body.byteStream().use { input ->
                        input.copyTo(out)
                    }
                }
                localFilePath = targetFile.absolutePath
                insertedUri = Uri.fromFile(targetFile)
            }

            if (!localFilePath.isNullOrBlank()) {
                MediaScannerConnection.scanFile(
                    context.applicationContext,
                    arrayOf(localFilePath),
                    arrayOf(effectiveMime),
                    null
                )
            }
            if (insertedUri != null) {
                try {
                    val scanIntent = Intent(Intent.ACTION_MEDIA_SCANNER_SCAN_FILE, insertedUri)
                    context.sendBroadcast(scanIntent)
                } catch (_: Exception) {}
            }

            SyncNotificationHelper.showDownloadCompleteNotification(
                context = context,
                filename = filename,
                isMedia = isMedia,
                fileUri = insertedUri
            )

            withContext(Dispatchers.Main) {
                val destSuccess = if (isMedia) "Phone Gallery ✓" else "Downloads/myDrive ✓"
                Toast.makeText(context, "Saved $filename to $destSuccess", Toast.LENGTH_SHORT).show()
                onSuccess?.invoke()
            }
        } catch (e: Exception) {
            e.printStackTrace()
            withContext(Dispatchers.Main) {
                Toast.makeText(context, "Download failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }
    }
}

fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return "0 B"
    val units = arrayOf("B", "KB", "MB", "GB", "TB")
    val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt()
    val value = bytes / Math.pow(1024.0, digitGroups.toDouble())
    return String.format(Locale.US, "%.1f %s", value, units[digitGroups])
}
