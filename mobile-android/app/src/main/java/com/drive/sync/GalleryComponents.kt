package com.drive.sync

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.media.MediaPlayer
import android.media.MediaScannerConnection
import com.drive.sync.network.SyncNotificationHelper
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import androidx.annotation.OptIn as AndroidXOptIn
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import kotlinx.coroutines.delay
import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil.compose.AsyncImage
import coil.imageLoader
import coil.request.ImageRequest
import coil.size.Precision
import coil.size.Size
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*
import kotlin.math.abs

// ----------------------------------------------------
// Helper Functions: Date Parsing, Formatting & Grouping
// ----------------------------------------------------
fun groupMediaByMonthYear(mediaList: List<CloudMedia>): Map<String, List<CloudMedia>> {
    val map = linkedMapOf<String, MutableList<CloudMedia>>()
    val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }
    val targetFormat = SimpleDateFormat("MMMM yyyy", Locale.US)

    for (item in mediaList) {
        var groupKey = "September 2026"
        val rawDate = item.takenAt
        if (!rawDate.isNullOrBlank()) {
            try {
                val clean = if (rawDate.length >= 19) rawDate.substring(0, 19) else rawDate
                val parsed = isoFormat.parse(clean)
                if (parsed != null) {
                    groupKey = targetFormat.format(parsed)
                }
            } catch (_: Exception) {
                groupKey = "Recent Photos"
            }
        }
        map.getOrPut(groupKey) { mutableListOf() }.add(item)
    }
    return map
}

fun formatDetailsDate(rawDate: String?): String {
    if (rawDate.isNullOrBlank()) return "31 Aug 2026, 6:42 PM"
    return try {
        val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }
        val outFormat = SimpleDateFormat("d MMM yyyy, h:mm a", Locale.US)
        val clean = if (rawDate.length >= 19) rawDate.substring(0, 19) else rawDate
        val parsed = isoFormat.parse(clean)
        if (parsed != null) outFormat.format(parsed) else rawDate
    } catch (_: Exception) {
        rawDate
    }
}

// ----------------------------------------------------
// Gallery Operations: Download, Share & Backend APIs
// ----------------------------------------------------
// Shared HTTP client singleton for efficient connection and thread pooling
val sharedHttpClient: OkHttpClient by lazy {
    val dispatcher = Dispatcher().apply {
        maxRequests = 64
        maxRequestsPerHost = 20
    }
    OkHttpClient.Builder()
        .dispatcher(dispatcher)
        .connectionPool(ConnectionPool(16, 5, java.util.concurrent.TimeUnit.MINUTES))
        .connectTimeout(15, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .build()
}

suspend fun downloadMediaToGallery(
    context: Context,
    item: CloudMedia,
    serverUrl: String,
    deviceId: String,
    deviceKey: String
): Boolean = withContext(Dispatchers.IO) {
    try {
        val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
        val req = Request.Builder()
            .url(streamUrl)
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .build()
        val res = sharedHttpClient.newCall(req).execute()
        if (!res.isSuccessful) {
            res.close()
            return@withContext false
        }
        val body = res.body ?: return@withContext false

        val isVideo = item.mimeType.startsWith("video/") ||
                item.filename.endsWith(".mp4", true) ||
                item.filename.endsWith(".mkv", true) ||
                item.filename.endsWith(".mov", true) ||
                item.filename.endsWith(".webm", true)

        val effectiveMime = when {
            item.mimeType.isNotBlank() && item.mimeType != "application/octet-stream" -> item.mimeType
            isVideo -> "video/mp4"
            item.filename.endsWith(".png", true) -> "image/png"
            item.filename.endsWith(".webp", true) -> "image/webp"
            else -> "image/jpeg"
        }

        var insertedUri: Uri? = null
        var localFilePath: String? = null

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val contentValues = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, item.filename)
                put(MediaStore.MediaColumns.MIME_TYPE, effectiveMime)
                put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    if (isVideo) Environment.DIRECTORY_MOVIES + "/myDrive" else Environment.DIRECTORY_PICTURES + "/myDrive"
                )
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }

            val collection = if (isVideo) {
                MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            } else {
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            }

            insertedUri = context.contentResolver.insert(collection, contentValues)
            if (insertedUri == null) {
                val dot = item.filename.lastIndexOf('.')
                val safeName = if (dot != -1) {
                    "${item.filename.substring(0, dot)}_${System.currentTimeMillis()}${item.filename.substring(dot)}"
                } else {
                    "${item.filename}_${System.currentTimeMillis()}"
                }
                contentValues.put(MediaStore.MediaColumns.DISPLAY_NAME, safeName)
                insertedUri = context.contentResolver.insert(collection, contentValues)
            }

            if (insertedUri != null) {
                context.contentResolver.openOutputStream(insertedUri)?.use { out ->
                    body.byteStream().use { input ->
                        input.copyTo(out)
                    }
                }
                contentValues.clear()
                contentValues.put(MediaStore.MediaColumns.IS_PENDING, 0)
                context.contentResolver.update(insertedUri, contentValues, null, null)

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
            val dir = if (isVideo) {
                java.io.File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MOVIES), "myDrive")
            } else {
                java.io.File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), "myDrive")
            }
            dir.mkdirs()
            var targetFile = java.io.File(dir, item.filename)
            if (targetFile.exists()) {
                val dot = item.filename.lastIndexOf('.')
                val safeName = if (dot != -1) {
                    "${item.filename.substring(0, dot)}_${System.currentTimeMillis()}${item.filename.substring(dot)}"
                } else {
                    "${item.filename}_${System.currentTimeMillis()}"
                }
                targetFile = java.io.File(dir, safeName)
            }
            targetFile.outputStream().use { out ->
                body.byteStream().use { input ->
                    input.copyTo(out)
                }
            }
            localFilePath = targetFile.absolutePath
            insertedUri = Uri.fromFile(targetFile)
        }

        // Force immediate Gallery indexing via MediaScannerConnection and broadcast
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

        // Display download notification
        SyncNotificationHelper.showDownloadCompleteNotification(
            context = context,
            filename = item.filename,
            isMedia = true,
            fileUri = insertedUri
        )

        true
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

fun shareMedia(context: Context, item: CloudMedia, serverUrl: String, deviceId: String, deviceKey: String) {
    val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
    val shareIntent = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_SUBJECT, item.filename)
        putExtra(Intent.EXTRA_TEXT, "Shared from myDrive: ${item.filename}\n$streamUrl")
    }
    context.startActivity(Intent.createChooser(shareIntent, "Share ${item.filename}"))
}

suspend fun apiToggleFavorite(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    fileId: String,
    isFavorite: Boolean
): Boolean = withContext(Dispatchers.IO) {
    try {
        val json = JSONObject().apply { put("isFavorite", isFavorite) }
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/v1/files/$fileId/favorite")
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .patch(body)
            .build()
        sharedHttpClient.newCall(req).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

suspend fun apiRenameFile(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    fileId: String,
    newFilename: String
): Boolean = withContext(Dispatchers.IO) {
    try {
        val json = JSONObject().apply { put("filename", newFilename) }
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/v1/files/$fileId/rename")
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .patch(body)
            .build()
        sharedHttpClient.newCall(req).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

suspend fun apiMoveFile(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    fileId: String,
    folderId: String?
): Boolean = withContext(Dispatchers.IO) {
    try {
        val json = JSONObject().apply { put("folderId", folderId ?: JSONObject.NULL) }
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/v1/files/$fileId/move")
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .patch(body)
            .build()
        sharedHttpClient.newCall(req).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

suspend fun apiTrashFile(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    fileId: String
): Boolean = withContext(Dispatchers.IO) {
    try {
        val body = "{}".toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/v1/files/$fileId/trash")
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .post(body)
            .build()
        sharedHttpClient.newCall(req).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

suspend fun apiEmptyTrash(
    serverUrl: String,
    deviceId: String,
    deviceKey: String
): Boolean = withContext(Dispatchers.IO) {
    try {
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/v1/files/trash")
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .delete()
            .build()
        sharedHttpClient.newCall(req).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

suspend fun apiBulkAction(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    action: String,
    fileIds: List<String>,
    folderId: String? = null
): Boolean = withContext(Dispatchers.IO) {
    try {
        val json = JSONObject().apply {
            put("action", action)
            put("fileIds", JSONArray(fileIds))
            if (folderId != null) put("folderId", folderId)
        }
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/v1/files/bulk")
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .post(body)
            .build()
        sharedHttpClient.newCall(req).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

suspend fun apiRenameFolder(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    folderId: String,
    newName: String
): Boolean = withContext(Dispatchers.IO) {
    try {
        val json = JSONObject().apply { put("name", newName) }
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/v1/files/folders/$folderId/rename")
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .patch(body)
            .build()
        sharedHttpClient.newCall(req).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

suspend fun apiDeleteFolder(
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    folderId: String
): Boolean = withContext(Dispatchers.IO) {
    try {
        val req = Request.Builder()
            .url("${serverUrl.trimEnd('/')}/api/v1/files/folders/$folderId")
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .delete()
            .build()
        sharedHttpClient.newCall(req).execute().use { it.isSuccessful }
    } catch (e: Exception) {
        e.printStackTrace()
        false
    }
}

// ----------------------------------------------------
// Single Running Progress Line with Color Shades
// ----------------------------------------------------
enum class ProgressColorType {
    DEFAULT,  // Purple
    UPLOAD,   // Sky Blue / Cyan
    SYNC,     // Emerald Green
    TRASH,    // Rose Red
    DECRYPT   // Violet
}

fun getProgressColor(type: ProgressColorType): Color = when (type) {
    ProgressColorType.DEFAULT -> Color(0xFF38BDF8)
    ProgressColorType.UPLOAD -> Color(0xFF38BDF8)
    ProgressColorType.SYNC -> Color(0xFF10B981)
    ProgressColorType.TRASH -> Color(0xFFEF4444)
    ProgressColorType.DECRYPT -> Color(0xFF0EA5E9)
}

fun getProgressTrackColor(type: ProgressColorType): Color = when (type) {
    ProgressColorType.DEFAULT -> Color(0x2238BDF8)
    ProgressColorType.UPLOAD -> Color(0x2238BDF8)
    ProgressColorType.SYNC -> Color(0x2210B981)
    ProgressColorType.TRASH -> Color(0x22EF4444)
    ProgressColorType.DECRYPT -> Color(0x220EA5E9)
}

@Composable
fun SingleRunningProgressBar(
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    colorType: ProgressColorType = ProgressColorType.DEFAULT,
    height: androidx.compose.ui.unit.Dp = 2.5.dp,
    color: Color = getProgressColor(colorType),
    trackColor: Color = getProgressTrackColor(colorType)
) {
    var isVisible by remember { mutableStateOf(false) }
    var isFading by remember { mutableStateOf(false) }
    var targetProgress by remember { mutableFloatStateOf(0f) }

    val animatedProgress by animateFloatAsState(
        targetValue = targetProgress,
        animationSpec = tween(
            durationMillis = if (targetProgress == 1f) 240 else if (targetProgress == 0f) 0 else 320,
            easing = FastOutSlowInEasing
        ),
        label = "singleProgressBarAnim"
    )

    val animatedAlpha by animateFloatAsState(
        targetValue = if (isFading) 0f else if (isVisible) 1f else 0f,
        animationSpec = tween(durationMillis = 240),
        label = "singleProgressBarAlpha"
    )

    LaunchedEffect(isLoading) {
        if (isLoading) {
            isFading = false
            isVisible = true
            targetProgress = 0.15f
            delay(120)
            if (targetProgress < 0.40f) targetProgress = 0.40f
            delay(280)
            if (targetProgress < 0.70f) targetProgress = 0.70f
            delay(500)
            if (targetProgress < 0.88f) targetProgress = 0.88f
            delay(1000)
            if (targetProgress < 0.94f) targetProgress = 0.94f
        } else if (isVisible) {
            targetProgress = 1.0f
            delay(300)
            isFading = true
            delay(240)
            isVisible = false
            isFading = false
            targetProgress = 0f
        }
    }

    if (isVisible || animatedAlpha > 0f) {
        LinearProgressIndicator(
            progress = { animatedProgress.coerceIn(0f, 1f) },
            modifier = modifier
                .fillMaxWidth()
                .height(height)
                .graphicsLayer(alpha = animatedAlpha),
            color = color,
            trackColor = trackColor
        )
    }
}

// ----------------------------------------------------
// Gallery Item Tile (Fast, skippable Compose component)
// ----------------------------------------------------
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun GalleryMediaTile(
    item: CloudMedia,
    isSelected: Boolean,
    isSelectionMode: Boolean,
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    onClick: () -> Unit,
    onLongClick: () -> Unit
) {
    val context = LocalContext.current
    val isVideo = item.mimeType.startsWith("video/")
    val thumbUrl = remember(item.id, item.thumbnail) {
        item.thumbnail?.takeIf { it.isNotBlank() }
            ?: "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"
    }

    val imageRequest = remember(item.id, thumbUrl) {
        ImageRequest.Builder(context)
            .data(thumbUrl)
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .size(Size(480, 480))
            .precision(Precision.EXACT)
            .memoryCacheKey("thumb_${item.id}")
            .diskCacheKey("thumb_${item.id}")
            .crossfade(false)
            .build()
    }

    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(6.dp))
            .background(Color(0xFF101014))
            .combinedClickable(
                onClick = onClick,
                onLongClick = onLongClick
            )
    ) {
        if (isVideo) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(
                        Brush.verticalGradient(
                            listOf(Color(0xFF1E2028), Color(0xFF0C0C10))
                        )
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.8f),
                    modifier = Modifier.size(32.dp)
                )
            }
        }

        // Thumbnail image
        AsyncImage(
            model = imageRequest,
            contentDescription = item.filename,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )

        // Video Indicator Badge
        if (isVideo) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .padding(5.dp)
                    .background(Color.Black.copy(alpha = 0.65f), RoundedCornerShape(6.dp))
                    .padding(horizontal = 6.dp, vertical = 3.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(11.dp)
                    )
                    if (item.duration != null && item.duration > 0) {
                        Spacer(modifier = Modifier.width(3.dp))
                        Text(
                            text = formatVideoTime((item.duration * 1000).toLong()),
                            color = Color.White,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        }

        // Cloud-Only Indicator
        if (item.isCloudOnly) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(4.dp)
                    .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                    .padding(3.dp)
            ) {
                Icon(
                    Icons.Default.Cloud,
                    contentDescription = "Cloud only",
                    tint = Color(0xFF94A3B8),
                    modifier = Modifier.size(11.dp)
                )
            }
        }

        // Favorite Indicator
        if (item.isFavorite) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(4.dp)
                    .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                    .padding(3.dp)
            ) {
                Icon(
                    Icons.Default.Favorite,
                    contentDescription = "Favorite",
                    tint = Color(0xFFEF4444),
                    modifier = Modifier.size(11.dp)
                )
            }
        }

        // Selection Checkbox
        if (isSelectionMode) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(4.dp)
                    .background(
                        if (isSelected) Color(0xFF38BDF8) else Color.Black.copy(alpha = 0.55f),
                        CircleShape
                    )
                    .padding(3.dp)
            ) {
                Icon(
                    if (isSelected) Icons.Default.Check else Icons.Default.RadioButtonUnchecked,
                    contentDescription = null,
                    tint = if (isSelected) Color.Black else Color.White,
                    modifier = Modifier.size(13.dp)
                )
            }
        }
    }
}

// ----------------------------------------------------
// 1. Gallery Grid — Main Screen Composable
// ----------------------------------------------------
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun FullGalleryScreen(
    mediaList: List<CloudMedia>,
    foldersList: List<CloudFolder>,
    pairedDevices: List<PairedDevice> = emptyList(),
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onDeleteMedia: ((String) -> Unit)? = null,
    onBulkDeleteMedia: ((List<String>) -> Unit)? = null
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()

    // Local state
    var localList by remember { mutableStateOf(mediaList) }

    LaunchedEffect(mediaList) {
        localList = mediaList
    }

    LaunchedEffect(Unit) {
        if (mediaList.isEmpty()) {
            onRefresh()
        }
    }

    var filterType by remember { mutableStateOf("All Photos") } // "All Photos", "Favorites", "Videos", "Photos"
    var isFilterMenuOpen by remember { mutableStateOf(false) }
    var isDeviceFilterMenuOpen by remember { mutableStateOf(false) }
    val selectedDeviceFilters = remember { mutableStateListOf<String>() } // device IDs, or "web"
    var isSearchActive by remember { mutableStateOf(false) }
    var searchQuery by remember { mutableStateOf("") }
    var isMoreMenuOpen by remember { mutableStateOf(false) }

    // Selection mode
    var isSelectionMode by remember { mutableStateOf(false) }
    val selectedIds = remember { mutableStateListOf<String>() }

    // Full-screen viewer state
    var viewerIndex by remember { mutableStateOf<Int?>(null) }

    // Dialogs
    var detailsItem by remember { mutableStateOf<CloudMedia?>(null) }
    var renameItem by remember { mutableStateOf<CloudMedia?>(null) }
    var isMoveDialogOpen by remember { mutableStateOf(false) }
    var isActionLoading by remember { mutableStateOf(false) }
    var showEmptyTrashDialog by remember { mutableStateOf(false) }

    // Filter media
    val filteredList = remember(localList, filterType, searchQuery, selectedDeviceFilters.toList()) {
        localList.filter { item ->
            val isVideo = item.mimeType.startsWith("video/")
            val isPhoto = item.mimeType.startsWith("image/")

            if (filterType == "Favorites" && !item.isFavorite) return@filter false
            if (filterType == "Videos" && !isVideo) return@filter false
            if (filterType == "Photos" && !isPhoto) return@filter false

            // Multi-select device filter
            if (selectedDeviceFilters.isNotEmpty()) {
                val hasMatch = selectedDeviceFilters.any { devId ->
                    if (devId == "web") {
                        item.sourceDeviceId == null || item.isCloudOnly
                    } else {
                        item.sourceDeviceId == devId || (item.sourceDeviceName != null && pairedDevices.any { it.deviceId == devId && it.deviceName == item.sourceDeviceName })
                    }
                }
                if (!hasMatch) return@filter false
            }

            if (searchQuery.isNotBlank()) {
                val q = searchQuery.trim().lowercase()
                val matchName = item.filename.lowercase().contains(q)
                val matchDevice = (item.sourceDeviceName ?: "").lowercase().contains(q)
                if (!matchName && !matchDevice) return@filter false
            }
            true
        }
    }

    val groupedMedia = remember(filteredList) {
        groupMediaByMonthYear(filteredList)
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
    ) {
        // Top Header Bar
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = Color(0xFF0A0A0E),
            shadowElevation = 4.dp
        ) {
            Column(modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (isSearchActive) {
                        // Expandable Search Bar
                        OutlinedTextField(
                            value = searchQuery,
                            onValueChange = { searchQuery = it },
                            placeholder = { Text("Search photos, videos, devices...", fontSize = 12.sp, color = Color.Gray) },
                            singleLine = true,
                            textStyle = androidx.compose.ui.text.TextStyle(color = Color.White, fontSize = 13.sp),
                            trailingIcon = {
                                IconButton(onClick = {
                                    if (searchQuery.isNotEmpty()) {
                                        searchQuery = ""
                                    } else {
                                        isSearchActive = false
                                    }
                                }) {
                                    Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.LightGray)
                                }
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(50.dp),
                            shape = RoundedCornerShape(25.dp),
                            colors = OutlinedTextFieldDefaults.colors(
                                focusedBorderColor = Color(0xFF38BDF8),
                                unfocusedBorderColor = Color(0xFF27272A),
                                focusedContainerColor = Color(0xFF14141B),
                                unfocusedContainerColor = Color(0xFF14141B)
                            )
                        )
                    } else {
                        // Title: myDrive (matches web app logo badge and typography)
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
                                    color = Color.White,
                                    fontSize = 20.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = (-0.5).sp
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

                        // Right icons: Search & More Options
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            IconButton(onClick = { isSearchActive = true }) {
                                Icon(Icons.Default.Search, contentDescription = "Search", tint = Color(0xFFE2E8F0))
                            }

                            Box {
                                IconButton(onClick = { isMoreMenuOpen = true }) {
                                    Icon(Icons.Default.MoreVert, contentDescription = "More", tint = Color(0xFFE2E8F0))
                                }

                                DropdownMenu(
                                    expanded = isMoreMenuOpen,
                                    onDismissRequest = { isMoreMenuOpen = false },
                                    modifier = Modifier.background(Color(0xFF111116))
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("Select Mode", color = Color.White) },
                                        leadingIcon = { Icon(Icons.Default.CheckCircleOutline, contentDescription = null, tint = Color(0xFF38BDF8)) },
                                        onClick = {
                                            isSelectionMode = true
                                            isMoreMenuOpen = false
                                        }
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Select All", color = Color.White) },
                                        leadingIcon = { Icon(Icons.Default.SelectAll, contentDescription = null, tint = Color.White) },
                                        onClick = {
                                            selectedIds.clear()
                                            selectedIds.addAll(filteredList.map { it.id })
                                            isSelectionMode = true
                                            isMoreMenuOpen = false
                                        }
                                    )
                                    DropdownMenuItem(
                                        text = { Text("Refresh Gallery", color = Color.White) },
                                        leadingIcon = { Icon(Icons.Default.Refresh, contentDescription = null, tint = Color.White) },
                                        onClick = {
                                            onRefresh()
                                            isMoreMenuOpen = false
                                        }
                                    )
                                    HorizontalDivider(color = Color(0xFF27272A))
                                    DropdownMenuItem(
                                        text = { Text("Empty Cloud Trash", color = Color(0xFFEF4444)) },
                                        leadingIcon = { Icon(Icons.Default.DeleteSweep, contentDescription = null, tint = Color(0xFFEF4444)) },
                                        onClick = {
                                            isMoreMenuOpen = false
                                            showEmptyTrashDialog = true
                                        }
                                    )
                                }
                            }
                        }
                    }
                }

                // Filter Pills: All Photos ▼ and Devices ▼
                if (!isSearchActive) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // 1. Media Type Filter Pill
                        Box {
                            Surface(
                                shape = RoundedCornerShape(20.dp),
                                color = Color(0xFF14141B),
                                border = BorderStroke(1.dp, Color(0xFF27272A)),
                                modifier = Modifier.clickable { isFilterMenuOpen = true }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Text(
                                        text = filterType,
                                        color = Color(0xFFF1F5F9),
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Icon(
                                        Icons.Default.ArrowDropDown,
                                        contentDescription = null,
                                        tint = Color(0xFF94A3B8),
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }

                            DropdownMenu(
                                expanded = isFilterMenuOpen,
                                onDismissRequest = { isFilterMenuOpen = false },
                                modifier = Modifier.background(Color(0xFF111116))
                            ) {
                                listOf("All Photos", "Favorites", "Videos", "Photos").forEach { opt ->
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                text = opt,
                                                color = if (filterType == opt) Color(0xFF38BDF8) else Color.White,
                                                fontWeight = if (filterType == opt) FontWeight.Bold else FontWeight.Normal
                                            )
                                        },
                                        onClick = {
                                            filterType = opt
                                            isFilterMenuOpen = false
                                        }
                                    )
                                }
                            }
                        }

                        // 2. Uploaded Devices Multi-Select Filter Pill
                        Box {
                            Surface(
                                shape = RoundedCornerShape(20.dp),
                                color = if (selectedDeviceFilters.isNotEmpty()) Color(0xFF1E293B) else Color(0xFF14141B),
                                border = BorderStroke(1.dp, if (selectedDeviceFilters.isNotEmpty()) Color(0xFF38BDF8) else Color(0xFF27272A)),
                                modifier = Modifier.clickable { isDeviceFilterMenuOpen = true }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.PhoneAndroid,
                                        contentDescription = null,
                                        tint = if (selectedDeviceFilters.isNotEmpty()) Color(0xFF38BDF8) else Color(0xFF94A3B8),
                                        modifier = Modifier.size(13.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text(
                                        text = if (selectedDeviceFilters.isEmpty()) "All Devices" else "Devices (${selectedDeviceFilters.size})",
                                        color = Color(0xFFF1F5F9),
                                        fontSize = 12.sp,
                                        fontWeight = FontWeight.SemiBold
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Icon(
                                        Icons.Default.ArrowDropDown,
                                        contentDescription = null,
                                        tint = Color(0xFF94A3B8),
                                        modifier = Modifier.size(16.dp)
                                    )
                                }
                            }

                            DropdownMenu(
                                expanded = isDeviceFilterMenuOpen,
                                onDismissRequest = { isDeviceFilterMenuOpen = false },
                                modifier = Modifier
                                    .background(Color(0xFF111116))
                                    .width(250.dp)
                            ) {
                                // "All Devices" checkbox
                                val isAllDevices = selectedDeviceFilters.isEmpty()
                                DropdownMenuItem(
                                    text = {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Checkbox(
                                                checked = isAllDevices,
                                                onCheckedChange = { selectedDeviceFilters.clear() },
                                                colors = CheckboxDefaults.colors(
                                                    checkedColor = Color(0xFF38BDF8),
                                                    uncheckedColor = Color.Gray
                                                )
                                            )
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(
                                                "All Devices",
                                                color = Color.White,
                                                fontWeight = if (isAllDevices) FontWeight.Bold else FontWeight.Normal,
                                                fontSize = 13.sp
                                            )
                                        }
                                    },
                                    onClick = { selectedDeviceFilters.clear() }
                                )

                                HorizontalDivider(color = Color(0xFF27272A))

                                // Paired Devices
                                pairedDevices.forEach { dev ->
                                    val isChecked = selectedDeviceFilters.contains(dev.deviceId)
                                    DropdownMenuItem(
                                        text = {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                modifier = Modifier.fillMaxWidth()
                                            ) {
                                                Checkbox(
                                                    checked = isChecked,
                                                    onCheckedChange = { chk ->
                                                        if (chk) selectedDeviceFilters.add(dev.deviceId)
                                                        else selectedDeviceFilters.remove(dev.deviceId)
                                                    },
                                                    colors = CheckboxDefaults.colors(
                                                        checkedColor = Color(0xFF38BDF8),
                                                        uncheckedColor = Color.Gray
                                                    )
                                                )
                                                Spacer(modifier = Modifier.width(6.dp))
                                                Column(modifier = Modifier.weight(1f)) {
                                                    Text(
                                                        dev.deviceName,
                                                        color = Color.White,
                                                        fontSize = 12.sp,
                                                        fontWeight = FontWeight.Medium,
                                                        maxLines = 1
                                                    )
                                                    Text(
                                                        dev.deviceType.uppercase(),
                                                        color = Color(0xFF94A3B8),
                                                        fontSize = 10.sp
                                                    )
                                                }
                                            }
                                        },
                                        onClick = {
                                            if (isChecked) selectedDeviceFilters.remove(dev.deviceId)
                                            else selectedDeviceFilters.add(dev.deviceId)
                                        }
                                    )
                                }

                                // Web / Cloud only
                                val isWebChecked = selectedDeviceFilters.contains("web")
                                DropdownMenuItem(
                                    text = {
                                        Row(
                                            verticalAlignment = Alignment.CenterVertically,
                                            modifier = Modifier.fillMaxWidth()
                                        ) {
                                            Checkbox(
                                                checked = isWebChecked,
                                                onCheckedChange = { chk ->
                                                    if (chk) selectedDeviceFilters.add("web")
                                                    else selectedDeviceFilters.remove("web")
                                                },
                                                colors = CheckboxDefaults.colors(
                                                    checkedColor = Color(0xFF38BDF8),
                                                    uncheckedColor = Color.Gray
                                                )
                                            )
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Column(modifier = Modifier.weight(1f)) {
                                                Text(
                                                    "Unified Drive (Web)",
                                                    color = Color.White,
                                                    fontSize = 12.sp,
                                                    fontWeight = FontWeight.Medium
                                                )
                                                Text(
                                                    "Cloud only",
                                                    color = Color(0xFF94A3B8),
                                                    fontSize = 10.sp
                                                )
                                            }
                                        }
                                    },
                                    onClick = {
                                        if (isWebChecked) selectedDeviceFilters.remove("web")
                                        else selectedDeviceFilters.add("web")
                                    }
                                )
                            }
                        }
                    }
                }
            }
        }

        SingleRunningProgressBar(
            isLoading = isRefreshing || isActionLoading
        )

        // Floating Selection Action Bar
        AnimatedVisibility(visible = (isSelectionMode || selectedIds.isNotEmpty())) {
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                shape = RoundedCornerShape(16.dp),
                color = Color(0xFF111116),
                border = BorderStroke(1.dp, Color(0xFF27272A)),
                shadowElevation = 10.dp
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "${selectedIds.size} selected",
                            color = Color.White,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = if (selectedIds.size == filteredList.size) "Deselect All" else "Select All",
                            color = Color(0xFF38BDF8),
                            fontSize = 11.sp,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.clickable {
                                if (selectedIds.size == filteredList.size) {
                                    selectedIds.clear()
                                } else {
                                    selectedIds.clear()
                                    selectedIds.addAll(filteredList.map { it.id })
                                }
                            }
                        )
                    }

                    Row(
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Bulk Download to Phone Gallery
                        IconButton(
                            onClick = {
                                val ids = selectedIds.toList()
                                val itemsToDownload = localList.filter { ids.contains(it.id) }
                                coroutineScope.launch {
                                    Toast.makeText(context, "Saving ${itemsToDownload.size} item(s) to Gallery...", Toast.LENGTH_SHORT).show()
                                    var count = 0
                                    for (m in itemsToDownload) {
                                        val ok = downloadMediaToGallery(context, m, serverUrl, deviceId, deviceKey)
                                        if (ok) count++
                                    }
                                    Toast.makeText(context, "Saved $count/${itemsToDownload.size} items to Phone Gallery!", Toast.LENGTH_SHORT).show()
                                    selectedIds.clear()
                                    isSelectionMode = false
                                }
                            },
                            enabled = selectedIds.isNotEmpty()
                        ) {
                            Icon(Icons.Default.Download, contentDescription = "Download to Gallery", tint = Color(0xFF38BDF8))
                        }

                        // Bulk Favorite
                        IconButton(
                            onClick = {
                                val ids = selectedIds.toList()
                                coroutineScope.launch {
                                    isActionLoading = true
                                    try {
                                        apiBulkAction(serverUrl, deviceId, deviceKey, "favorite", ids)
                                        localList = localList.map { if (ids.contains(it.id)) it.copy(isFavorite = true) else it }
                                        selectedIds.clear()
                                        isSelectionMode = false
                                        Toast.makeText(context, "Marked as favorites", Toast.LENGTH_SHORT).show()
                                    } finally {
                                        isActionLoading = false
                                    }
                                }
                            },
                            enabled = selectedIds.isNotEmpty()
                        ) {
                            Icon(Icons.Default.Favorite, contentDescription = "Favorite", tint = Color(0xFFEF4444))
                        }

                        // Bulk Share
                        IconButton(
                            onClick = {
                                val ids = selectedIds.toList()
                                val firstItem = localList.firstOrNull { ids.contains(it.id) }
                                if (firstItem != null) {
                                    shareMedia(context, firstItem, serverUrl, deviceId, deviceKey)
                                }
                            },
                            enabled = selectedIds.isNotEmpty()
                        ) {
                            Icon(Icons.Default.Share, contentDescription = "Share", tint = Color.White)
                        }

                        // Bulk Move
                        IconButton(
                            onClick = { isMoveDialogOpen = true },
                            enabled = selectedIds.isNotEmpty()
                        ) {
                            Icon(Icons.Default.DriveFileMove, contentDescription = "Move", tint = Color(0xFF38BDF8))
                        }

                        // Bulk Trash
                        IconButton(
                            onClick = {
                                val ids = selectedIds.toList()
                                localList = localList.filter { !ids.contains(it.id) }
                                onBulkDeleteMedia?.invoke(ids)
                                selectedIds.clear()
                                isSelectionMode = false
                                Toast.makeText(context, "Moved to Trash", Toast.LENGTH_SHORT).show()

                                coroutineScope.launch {
                                    isActionLoading = true
                                    try {
                                        apiBulkAction(serverUrl, deviceId, deviceKey, "trash", ids)
                                        onRefresh()
                                    } finally {
                                        isActionLoading = false
                                    }
                                }
                            },
                            enabled = selectedIds.isNotEmpty()
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Trash", tint = Color(0xFFEF4444))
                        }

                        // Close selection
                        IconButton(onClick = {
                            selectedIds.clear()
                            isSelectionMode = false
                        }) {
                            Icon(Icons.Default.Close, contentDescription = "Cancel", tint = Color.LightGray)
                        }
                    }
                }
            }
        }

        // Empty state
        if (filteredList.isEmpty()) {
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
                    Text(
                        text = if (searchQuery.isNotBlank()) "No matching media found" else "No photos or videos yet",
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                        fontSize = 15.sp
                    )
                    Text(
                        text = "Photos & videos backed up from devices will appear here",
                        color = Color(0xFF71717A),
                        fontSize = 12.sp
                    )
                }
            }
        } else {
            // Main 3-Column Grid with Date Grouping (Commercial photography app density)
            LazyVerticalGrid(
                columns = GridCells.Fixed(3),
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black),
                contentPadding = PaddingValues(bottom = 80.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                groupedMedia.forEach { (monthYear, itemsInGroup) ->
                    // Date Group Header
                    item(
                        key = "header_$monthYear",
                        span = { GridItemSpan(3) },
                        contentType = "header"
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color.Black)
                                .padding(horizontal = 14.dp, vertical = 12.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = monthYear,
                                color = Color(0xFFF8FAFC),
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.2.sp
                            )
                            Text(
                                text = "${itemsInGroup.size} items",
                                color = Color(0xFF64748B),
                                fontSize = 11.sp
                            )
                        }
                    }

                    // Grid Items
                    items(
                        itemsInGroup,
                        key = { it.id },
                        contentType = { "media_tile" }
                    ) { item ->
                        val isSelected = selectedIds.contains(item.id)
                        GalleryMediaTile(
                            item = item,
                            isSelected = isSelected,
                            isSelectionMode = isSelectionMode,
                            serverUrl = serverUrl,
                            deviceId = deviceId,
                            deviceKey = deviceKey,
                            onClick = {
                                if (isSelectionMode) {
                                    if (isSelected) selectedIds.remove(item.id) else selectedIds.add(item.id)
                                } else {
                                    val idx = filteredList.indexOfFirst { it.id == item.id }
                                    if (idx != -1) viewerIndex = idx
                                }
                            },
                            onLongClick = {
                                isSelectionMode = true
                                if (isSelected) selectedIds.remove(item.id) else selectedIds.add(item.id)
                            }
                        )
                    }
                }
            }
        }
    }

    // 2. Full-Screen Photo Viewer Dialog
    if (viewerIndex != null && viewerIndex in filteredList.indices) {
        val current = filteredList[viewerIndex!!]
        FullScreenPhotoViewer(
            mediaList = filteredList,
            initialIndex = viewerIndex!!,
            serverUrl = serverUrl,
            deviceId = deviceId,
            deviceKey = deviceKey,
            onClose = { viewerIndex = null },
            onToggleFavorite = {
                val nextFav = !current.isFavorite
                current.isFavorite = nextFav
                localList = localList.map { if (it.id == current.id) it.copy(isFavorite = nextFav) else it }
                coroutineScope.launch {
                    isActionLoading = true
                    try {
                        apiToggleFavorite(serverUrl, deviceId, deviceKey, current.id, nextFav)
                    } finally {
                        isActionLoading = false
                    }
                }
            },
            onDelete = {
                val currentId = current.id
                localList = localList.filter { it.id != currentId }
                onDeleteMedia?.invoke(currentId)
                if (viewerIndex != null && viewerIndex!! >= localList.size) {
                    viewerIndex = if (localList.isNotEmpty()) localList.size - 1 else null
                }
                Toast.makeText(context, "Moved to Trash", Toast.LENGTH_SHORT).show()

                coroutineScope.launch {
                    isActionLoading = true
                    try {
                        apiTrashFile(serverUrl, deviceId, deviceKey, currentId)
                        onRefresh()
                    } finally {
                        isActionLoading = false
                    }
                }
            },
            onOpenDetails = { detailsItem = current },
            onOpenRename = { renameItem = current },
            onOpenMove = { isMoveDialogOpen = true }
        )
    }

    // 3. Photo Details Bottom Sheet / Dialog
    if (detailsItem != null) {
        PhotoDetailsDialog(
            item = detailsItem!!,
            onDismiss = { detailsItem = null }
        )
    }

    // 4. Rename Dialog
    if (renameItem != null) {
        var newName by remember { mutableStateOf(renameItem!!.filename) }
        AlertDialog(
            onDismissRequest = { renameItem = null },
            containerColor = Color(0xFF181824),
            title = { Text("Rename File", color = Color.White, fontWeight = FontWeight.Bold) },
            text = {
                OutlinedTextField(
                    value = newName,
                    onValueChange = { newName = it },
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedBorderColor = Color(0xFF38BDF8),
                        unfocusedBorderColor = Color(0xFF27272A)
                    )
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        val target = renameItem!!
                        coroutineScope.launch {
                            isActionLoading = true
                            try {
                                apiRenameFile(serverUrl, deviceId, deviceKey, target.id, newName.trim())
                                localList = localList.map { if (it.id == target.id) it.copy(filename = newName.trim()) else it }
                                renameItem = null
                            } finally {
                                isActionLoading = false
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF38BDF8))
                ) {
                    Text("Save", color = Color.Black, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { renameItem = null }) {
                    Text("Cancel", color = Color.LightGray)
                }
            }
        )
    }

    // 5. Move to Folder Dialog
    if (isMoveDialogOpen) {
        AlertDialog(
            onDismissRequest = { isMoveDialogOpen = false },
            containerColor = Color(0xFF181824),
            title = { Text("Move to Folder", color = Color.White, fontWeight = FontWeight.Bold) },
            text = {
                Column(modifier = Modifier.fillMaxWidth().heightIn(max = 240.dp).verticalScroll(rememberScrollState())) {
                    Text("Select target destination folder:", color = Color.LightGray, fontSize = 12.sp)
                    Spacer(modifier = Modifier.height(8.dp))

                    // Root option
                    Surface(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 4.dp)
                            .clickable {
                                coroutineScope.launch {
                                    isActionLoading = true
                                    try {
                                        val ids = if (isSelectionMode) selectedIds.toList() else if (viewerIndex != null) listOf(filteredList[viewerIndex!!].id) else emptyList()
                                        apiBulkAction(serverUrl, deviceId, deviceKey, "move", ids, null)
                                        isMoveDialogOpen = false
                                        selectedIds.clear()
                                        isSelectionMode = false
                                        Toast.makeText(context, "Moved to Root", Toast.LENGTH_SHORT).show()
                                    } finally {
                                        isActionLoading = false
                                    }
                                }
                            },
                        color = Color(0xFF1F1F2F),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text("Root / All Files", color = Color.White, modifier = Modifier.padding(12.dp), fontSize = 13.sp)
                    }

                    foldersList.forEach { folder ->
                        Surface(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(vertical = 4.dp)
                                .clickable {
                                    coroutineScope.launch {
                                        isActionLoading = true
                                        try {
                                            val ids = if (isSelectionMode) selectedIds.toList() else if (viewerIndex != null) listOf(filteredList[viewerIndex!!].id) else emptyList()
                                            apiBulkAction(serverUrl, deviceId, deviceKey, "move", ids, folder.id)
                                            isMoveDialogOpen = false
                                            selectedIds.clear()
                                            isSelectionMode = false
                                            Toast.makeText(context, "Moved to ${folder.name}", Toast.LENGTH_SHORT).show()
                                        } finally {
                                            isActionLoading = false
                                        }
                                    }
                                },
                            color = Color(0xFF1F1F2F),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Text(folder.name, color = Color.White, modifier = Modifier.padding(12.dp), fontSize = 13.sp)
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { isMoveDialogOpen = false }) {
                    Text("Cancel", color = Color.LightGray)
                }
            }
        )
    }

    // 6. Empty Cloud Trash Confirmation Dialog
    if (showEmptyTrashDialog) {
        AlertDialog(
            onDismissRequest = { showEmptyTrashDialog = false },
            containerColor = Color(0xFF181824),
            title = { Text("Empty Cloud Trash?", color = Color.White, fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    "Are you sure you want to permanently delete all items in Trash from Google Drive cloud storage? This action cannot be undone.",
                    color = Color(0xFF94A3B8),
                    fontSize = 13.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        showEmptyTrashDialog = false
                        coroutineScope.launch {
                            isActionLoading = true
                            try {
                                val ok = apiEmptyTrash(serverUrl, deviceId, deviceKey)
                                if (ok) {
                                    Toast.makeText(context, "Cloud Trash emptied successfully", Toast.LENGTH_SHORT).show()
                                    onRefresh()
                                } else {
                                    Toast.makeText(context, "Failed to empty trash", Toast.LENGTH_SHORT).show()
                                }
                            } finally {
                                isActionLoading = false
                            }
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDC2626))
                ) {
                    Text("Empty Trash", color = Color.White, fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = {
                TextButton(onClick = { showEmptyTrashDialog = false }) {
                    Text("Cancel", color = Color.LightGray)
                }
            }
        )
    }
}

// ----------------------------------------------------
// Video Time Formatter Helper
// ----------------------------------------------------
fun formatVideoTime(millis: Long): String {
    val totalSeconds = (millis / 1000).coerceAtLeast(0)
    val minutes = totalSeconds / 60
    val seconds = totalSeconds % 60
    val hours = minutes / 60
    return if (hours > 0) {
        String.format(Locale.US, "%d:%02d:%02d", hours, minutes % 60, seconds)
    } else {
        String.format(Locale.US, "%02d:%02d", minutes, seconds)
    }
}

// ----------------------------------------------------
// Real Video Player with Media3 ExoPlayer & Frosted Overlay Controls
// ----------------------------------------------------
@AndroidXOptIn(UnstableApi::class)
@Composable
fun ModernExoPlayerView(
    streamUrl: String,
    filename: String,
    thumbnailUrl: String = "",
    fileId: String = "",
    deviceId: String = "",
    deviceKey: String = "",
    onClose: (() -> Unit)? = null,
    showTopBar: Boolean = true,
    controlsVisible: Boolean? = null,
    onToggleControls: (() -> Unit)? = null,
    bottomPadding: androidx.compose.ui.unit.Dp = 0.dp,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    var isPlaying by remember { mutableStateOf(true) }
    var isBuffering by remember { mutableStateOf(true) }
    var playbackError by remember { mutableStateOf<String?>(null) }
    var currentPosition by remember { mutableLongStateOf(0L) }
    var duration by remember { mutableLongStateOf(0L) }
    var isMuted by remember { mutableStateOf(false) }
    var internalShowControls by remember { mutableStateOf(true) }
    var isDraggingSlider by remember { mutableStateOf(false) }
    var sliderPosition by remember { mutableFloatStateOf(0f) }
    var resizeMode by remember { mutableIntStateOf(AspectRatioFrameLayout.RESIZE_MODE_FIT) }

    val actualShowControls = controlsVisible ?: internalShowControls
    val toggleControls = onToggleControls ?: { internalShowControls = !internalShowControls }

    val exoPlayer = remember(streamUrl) {
        val httpDataSourceFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(30000)

        if (deviceId.isNotBlank() && deviceKey.isNotBlank()) {
            httpDataSourceFactory.setDefaultRequestProperties(
                mapOf(
                    "x-device-id" to deviceId,
                    "x-device-key" to deviceKey
                )
            )
        }

        val mediaSource = ProgressiveMediaSource.Factory(httpDataSourceFactory)
            .createMediaSource(MediaItem.fromUri(Uri.parse(streamUrl)))

        ExoPlayer.Builder(context).build().apply {
            setMediaSource(mediaSource)
            prepare()
            playWhenReady = true
        }
    }

    DisposableEffect(exoPlayer) {
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(playbackState: Int) {
                when (playbackState) {
                    Player.STATE_BUFFERING -> isBuffering = true
                    Player.STATE_READY -> {
                        isBuffering = false
                        duration = exoPlayer.duration.coerceAtLeast(0L)
                        playbackError = null
                    }
                    Player.STATE_ENDED -> {
                        isPlaying = false
                    }
                    Player.STATE_IDLE -> {}
                }
            }

            override fun onIsPlayingChanged(playing: Boolean) {
                isPlaying = playing
            }

            override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                isBuffering = false
                playbackError = error.localizedMessage ?: "Playback error (${error.errorCodeName})"
            }
        }
        exoPlayer.addListener(listener)

        onDispose {
            exoPlayer.removeListener(listener)
            exoPlayer.release()
        }
    }

    // Live position tracking loop
    LaunchedEffect(exoPlayer, isPlaying, isDraggingSlider) {
        while (isPlaying && !isDraggingSlider) {
            currentPosition = exoPlayer.currentPosition.coerceAtLeast(0L)
            if (exoPlayer.duration > 0) {
                duration = exoPlayer.duration
            }
            delay(250)
        }
    }

    // Auto-hide controls after 3.5s of playback with no user interaction
    LaunchedEffect(actualShowControls, isPlaying, isDraggingSlider) {
        if (actualShowControls && isPlaying && !isDraggingSlider) {
            delay(3500)
            if (controlsVisible == null) {
                internalShowControls = false
            } else {
                onToggleControls?.invoke()
            }
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { toggleControls() }
                )
            },
        contentAlignment = Alignment.Center
    ) {
        // 1. Hardware-accelerated ExoPlayer native surface
        AndroidView(
            factory = { ctx ->
                PlayerView(ctx).apply {
                    player = exoPlayer
                    useController = false
                    this.resizeMode = resizeMode
                    setBackgroundColor(android.graphics.Color.BLACK)
                }
            },
            update = { playerView ->
                playerView.player = exoPlayer
                playerView.resizeMode = resizeMode
            },
            modifier = Modifier.fillMaxSize()
        )

        // 2. Poster preview while buffering at initial start (no blank flicker)
        if (isBuffering && playbackError == null && thumbnailUrl.isNotBlank() && currentPosition < 500L) {
            AsyncImage(
                model = ImageRequest.Builder(context)
                    .data(thumbnailUrl)
                    .addHeader("x-device-id", deviceId)
                    .addHeader("x-device-key", deviceKey)
                    .placeholderMemoryCacheKey(if (fileId.isNotBlank()) "thumb_$fileId" else null)
                    .memoryCacheKey(if (fileId.isNotBlank()) "thumb_$fileId" else null)
                    .diskCacheKey(if (fileId.isNotBlank()) "thumb_$fileId" else null)
                    .crossfade(false)
                    .build(),
                contentDescription = filename,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit
            )
        }

        // 3. Sleek buffering spinner in frosted dark circle
        if (isBuffering && playbackError == null) {
            Box(
                modifier = Modifier
                    .size(56.dp)
                    .background(Color.Black.copy(alpha = 0.6f), CircleShape),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator(
                    color = Color(0xFF38BDF8),
                    strokeWidth = 3.dp,
                    modifier = Modifier.size(32.dp)
                )
            }
        }

        // 4. Playback Error Banner
        if (playbackError != null) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .background(Color(0xFF111116).copy(alpha = 0.95f), RoundedCornerShape(16.dp))
                    .border(1.dp, Color(0xFF27272A), RoundedCornerShape(16.dp))
                    .padding(24.dp)
            ) {
                Icon(
                    Icons.Default.ErrorOutline,
                    contentDescription = null,
                    tint = Color(0xFFEF4444),
                    modifier = Modifier.size(36.dp)
                )
                Spacer(modifier = Modifier.height(10.dp))
                Text("Playback Error", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Spacer(modifier = Modifier.height(4.dp))
                Text(playbackError ?: "", color = Color(0xFF94A3B8), fontSize = 12.sp, textAlign = TextAlign.Center)
                Spacer(modifier = Modifier.height(14.dp))
                Button(
                    onClick = {
                        try {
                            val intent = Intent(Intent.ACTION_VIEW).apply {
                                setDataAndType(Uri.parse(streamUrl), "video/*")
                                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                            }
                            context.startActivity(intent)
                        } catch (_: Exception) {
                            Toast.makeText(context, "No external video player found", Toast.LENGTH_SHORT).show()
                        }
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF38BDF8))
                ) {
                    Text("Open in External Player", color = Color.Black, fontWeight = FontWeight.Bold)
                }
            }
        }

        // 5. Frosted Glass Overlay Controls
        AnimatedVisibility(
            visible = actualShowControls,
            enter = fadeIn(),
            exit = fadeOut(),
            modifier = Modifier.fillMaxSize()
        ) {
            Box(modifier = Modifier.fillMaxSize()) {
                // Top bar (shown only if showTopBar is true)
                if (showTopBar) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .align(Alignment.TopCenter)
                            .background(
                                Brush.verticalGradient(
                                    listOf(Color.Black.copy(alpha = 0.85f), Color.Transparent)
                                )
                            )
                            .padding(top = 36.dp, bottom = 16.dp, start = 12.dp, end = 12.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.weight(1f)
                        ) {
                            if (onClose != null) {
                                IconButton(onClick = onClose) {
                                    Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = Color.White)
                                }
                                Spacer(modifier = Modifier.width(4.dp))
                            }
                            Text(
                                text = filename,
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.SemiBold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }

                        Row(verticalAlignment = Alignment.CenterVertically) {
                            // Aspect Ratio Toggle
                            IconButton(
                                onClick = {
                                    resizeMode = if (resizeMode == AspectRatioFrameLayout.RESIZE_MODE_FIT) {
                                        AspectRatioFrameLayout.RESIZE_MODE_ZOOM
                                    } else {
                                        AspectRatioFrameLayout.RESIZE_MODE_FIT
                                    }
                                }
                            ) {
                                Icon(
                                    if (resizeMode == AspectRatioFrameLayout.RESIZE_MODE_FIT) Icons.Default.AspectRatio else Icons.Default.FitScreen,
                                    contentDescription = "Aspect Ratio",
                                    tint = Color.White
                                )
                            }

                            // Mute / Unmute
                            IconButton(
                                onClick = {
                                    isMuted = !isMuted
                                    exoPlayer.volume = if (isMuted) 0f else 1f
                                }
                            ) {
                                Icon(
                                    if (isMuted) Icons.Default.VolumeOff else Icons.Default.VolumeUp,
                                    contentDescription = if (isMuted) "Unmute" else "Mute",
                                    tint = if (isMuted) Color(0xFFEF4444) else Color.White
                                )
                            }

                            // External Player
                            IconButton(
                                onClick = {
                                    try {
                                        val intent = Intent(Intent.ACTION_VIEW).apply {
                                            setDataAndType(Uri.parse(streamUrl), "video/*")
                                            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                                        }
                                        context.startActivity(intent)
                                    } catch (_: Exception) {
                                        Toast.makeText(context, "No external player available", Toast.LENGTH_SHORT).show()
                                    }
                                }
                            ) {
                                Icon(
                                    Icons.AutoMirrored.Filled.OpenInNew,
                                    contentDescription = "Open External",
                                    tint = Color.White
                                )
                            }
                        }
                    }
                }

                // Center Controls: Rewind -10s, Play/Pause, Forward +10s
                Row(
                    modifier = Modifier
                        .align(Alignment.Center)
                        .padding(horizontal = 24.dp),
                    horizontalArrangement = Arrangement.spacedBy(28.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = {
                            val target = (exoPlayer.currentPosition - 10000L).coerceAtLeast(0L)
                            exoPlayer.seekTo(target)
                            currentPosition = target
                        },
                        modifier = Modifier
                            .size(50.dp)
                            .background(Color.Black.copy(alpha = 0.55f), CircleShape)
                    ) {
                        Icon(
                            Icons.Default.Replay10,
                            contentDescription = "Rewind 10s",
                            tint = Color.White,
                            modifier = Modifier.size(28.dp)
                        )
                    }

                    IconButton(
                        onClick = {
                            if (isPlaying) {
                                exoPlayer.pause()
                            } else {
                                if (exoPlayer.playbackState == Player.STATE_ENDED) {
                                    exoPlayer.seekTo(0)
                                }
                                exoPlayer.play()
                            }
                        },
                        modifier = Modifier
                            .size(68.dp)
                            .background(Color.Black.copy(alpha = 0.65f), CircleShape)
                            .border(1.5.dp, Color(0xFF38BDF8).copy(alpha = 0.7f), CircleShape)
                    ) {
                        Icon(
                            if (isPlaying) Icons.Default.Pause else Icons.Default.PlayArrow,
                            contentDescription = if (isPlaying) "Pause" else "Play",
                            tint = Color.White,
                            modifier = Modifier.size(40.dp)
                        )
                    }

                    IconButton(
                        onClick = {
                            val max = exoPlayer.duration.coerceAtLeast(0L)
                            val target = if (max > 0) (exoPlayer.currentPosition + 10000L).coerceAtMost(max) else exoPlayer.currentPosition + 10000L
                            exoPlayer.seekTo(target)
                            currentPosition = target
                        },
                        modifier = Modifier
                            .size(50.dp)
                            .background(Color.Black.copy(alpha = 0.55f), CircleShape)
                    ) {
                        Icon(
                            Icons.Default.Forward10,
                            contentDescription = "Forward 10s",
                            tint = Color.White,
                            modifier = Modifier.size(28.dp)
                        )
                    }
                }

                // Bottom Scrubber Slider & Timestamp
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.BottomCenter)
                        .padding(bottom = bottomPadding)
                        .background(
                            Brush.verticalGradient(
                                listOf(Color.Transparent, Color.Black.copy(alpha = 0.88f))
                            )
                        )
                        .padding(start = 16.dp, end = 16.dp, bottom = if (bottomPadding > 0.dp) 8.dp else 28.dp, top = 16.dp)
                ) {
                    val displayedPosition = if (isDraggingSlider) (sliderPosition * duration).toLong() else currentPosition

                    Slider(
                        value = if (duration > 0) {
                            if (isDraggingSlider) sliderPosition else (currentPosition.toFloat() / duration.toFloat()).coerceIn(0f, 1f)
                        } else 0f,
                        onValueChange = { value ->
                            isDraggingSlider = true
                            sliderPosition = value
                        },
                        onValueChangeFinished = {
                            if (duration > 0) {
                                val target = (sliderPosition * duration).toLong()
                                exoPlayer.seekTo(target)
                                currentPosition = target
                            }
                            isDraggingSlider = false
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(24.dp),
                        colors = SliderDefaults.colors(
                            thumbColor = Color(0xFF38BDF8),
                            activeTrackColor = Color(0xFF38BDF8),
                            inactiveTrackColor = Color(0xFF334155)
                        )
                    )

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = formatVideoTime(displayedPosition),
                            color = Color(0xFFE2E8F0),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = formatVideoTime(duration),
                            color = Color(0xFF94A3B8),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

// ----------------------------------------------------
// 2. Full-Screen Photo Viewer with Gestures & Actions
// ----------------------------------------------------
@Composable
fun FullScreenPhotoViewer(
    mediaList: List<CloudMedia>,
    initialIndex: Int,
    serverUrl: String,
    deviceId: String,
    deviceKey: String,
    onClose: () -> Unit,
    onToggleFavorite: () -> Unit,
    onDelete: () -> Unit,
    onOpenDetails: () -> Unit,
    onOpenRename: () -> Unit,
    onOpenMove: () -> Unit
) {
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    var currentIndex by remember { mutableIntStateOf(initialIndex) }
    val currentItem = mediaList.getOrNull(currentIndex) ?: return

    var showControls by remember { mutableStateOf(true) }
    var scale by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }
    var rotation by remember(currentItem.id) { mutableFloatStateOf(0f) }
    var isMoreMenuOpen by remember { mutableStateOf(false) }
    var isViewerMediaLoading by remember { mutableStateOf(true) }
    // Persist last successfully loaded image URL — shown blurred while next image loads (no spinner/blank screen)
    var prevImageUrl by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(currentItem.id) {
        isViewerMediaLoading = true
    }

    val isVideo = currentItem.mimeType.startsWith("video/")
    val streamUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${currentItem.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"

    // Preload adjacent images (next 2 and previous 1) into Coil cache for instant transitions
    LaunchedEffect(currentIndex, mediaList) {
        val toPreload = mutableListOf<String>()
        if (currentIndex < mediaList.size - 1) toPreload.add(mediaList[currentIndex + 1].id)
        if (currentIndex < mediaList.size - 2) toPreload.add(mediaList[currentIndex + 2].id)
        if (currentIndex > 0) toPreload.add(mediaList[currentIndex - 1].id)

        toPreload.forEach { fileId ->
            val item = mediaList.find { it.id == fileId }
            if (item != null && !item.mimeType.startsWith("video/")) {
                val preUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/stream?deviceId=$deviceId&deviceKey=$deviceKey"
                val req = ImageRequest.Builder(context)
                    .data(preUrl)
                    .addHeader("x-device-id", deviceId)
                    .addHeader("x-device-key", deviceKey)
                    .build()
                context.imageLoader.enqueue(req)
            }
        }
    }

    Dialog(
        onDismissRequest = onClose,
        properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black)
                .pointerInput(currentIndex) {
                    var totalDragX = 0f
                    var totalDragY = 0f
                    detectDragGestures(
                        onDragEnd = {
                            if (scale <= 1.05f) {
                                if (totalDragY > 120 && abs(totalDragX) < 80) {
                                    // Swipe down → close viewer
                                    onClose()
                                } else if (totalDragX < -80 && abs(totalDragY) < 80) {
                                    // Swipe left → next photo
                                    if (currentIndex < mediaList.size - 1) {
                                        currentIndex++
                                        scale = 1f
                                        offset = Offset.Zero
                                    }
                                } else if (totalDragX > 80 && abs(totalDragY) < 80) {
                                    // Swipe right → previous photo
                                    if (currentIndex > 0) {
                                        currentIndex--
                                        scale = 1f
                                        offset = Offset.Zero
                                    }
                                }
                            }
                            totalDragX = 0f
                            totalDragY = 0f
                        },
                        onDrag = { change, dragAmount ->
                            change.consume()
                            if (scale > 1f) {
                                offset += dragAmount
                            } else {
                                totalDragX += dragAmount.x
                                totalDragY += dragAmount.y
                            }
                        }
                    )
                }
        ) {
            // Media View (Image or Video)
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .pointerInput(currentIndex) {
                        detectTapGestures(
                            onTap = { showControls = !showControls },
                            onDoubleTap = {
                                scale = if (scale > 1.2f) 1f else 2.5f
                                offset = Offset.Zero
                            }
                        )
                    },
                contentAlignment = Alignment.Center
            ) {
                if (isVideo) {
                    key(currentItem.id) {
                        val thumbData = currentItem.thumbnail?.takeIf { it.isNotBlank() }
                            ?: "${serverUrl.trimEnd('/')}/api/v1/files/${currentItem.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"
                        ModernExoPlayerView(
                            streamUrl = streamUrl,
                            filename = currentItem.filename,
                            thumbnailUrl = thumbData,
                            fileId = currentItem.id,
                            deviceId = deviceId,
                            deviceKey = deviceKey,
                            onClose = onClose,
                            showTopBar = false,
                            controlsVisible = showControls,
                            onToggleControls = { showControls = !showControls },
                            bottomPadding = 88.dp
                        )
                    }
                } else {
                    key(currentItem.id) {
                        var isImageLoading by remember(currentItem.id) { mutableStateOf(true) }
                        var isImageError by remember(currentItem.id) { mutableStateOf(false) }
                        val thumbData = currentItem.thumbnail?.takeIf { it.isNotBlank() }
                            ?: "${serverUrl.trimEnd('/')}/api/v1/files/${currentItem.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"

                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            // While high-res loads: show matching thumbnail of the CURRENT image — no distorted mismatch from previous photos!
                            if (isImageLoading && !isImageError) {
                                AsyncImage(
                                    model = ImageRequest.Builder(context)
                                        .data(thumbData)
                                        .addHeader("x-device-id", deviceId)
                                        .addHeader("x-device-key", deviceKey)
                                        .placeholderMemoryCacheKey("thumb_${currentItem.id}")
                                        .memoryCacheKey("thumb_${currentItem.id}")
                                        .diskCacheKey("thumb_${currentItem.id}")
                                        .crossfade(false)
                                        .build(),
                                    contentDescription = null,
                                    modifier = Modifier
                                        .fillMaxSize()
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
                                    .build(),
                                contentDescription = currentItem.filename,
                                onSuccess = {
                                    isImageLoading = false
                                    isViewerMediaLoading = false
                                },
                                onError = {
                                    isImageLoading = false
                                    isImageError = true
                                    isViewerMediaLoading = false
                                },
                                modifier = Modifier
                                    .fillMaxSize()
                                    .graphicsLayer(
                                        scaleX = scale,
                                        scaleY = scale,
                                        rotationZ = rotation,
                                        translationX = offset.x,
                                        translationY = offset.y
                                    ),
                                contentScale = ContentScale.Fit
                            )

                            if (isImageError) {
                                Column(
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    modifier = Modifier
                                        .background(Color(0xFF0F0F14).copy(alpha = 0.94f), RoundedCornerShape(16.dp))
                                        .padding(24.dp)
                                ) {
                                    Icon(
                                        Icons.Default.ErrorOutline,
                                        contentDescription = null,
                                        tint = Color(0xFFEF4444),
                                        modifier = Modifier.size(36.dp)
                                    )
                                    Spacer(modifier = Modifier.height(10.dp))
                                    Text("Unable to load image", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                }
                            }
                        }
                    }
                }
            }

            // Top Bar Controls
            AnimatedVisibility(
                visible = showControls,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.TopCenter)
            ) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .background(
                                Brush.verticalGradient(
                                    listOf(Color.Black.copy(alpha = 0.8f), Color.Transparent)
                                )
                            )
                            .padding(top = 36.dp, bottom = 12.dp, start = 12.dp, end = 12.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        IconButton(onClick = onClose) {
                            Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = Color.White)
                        }
                        Spacer(modifier = Modifier.width(8.dp))
                        Column {
                            Text(
                                text = currentItem.filename,
                                color = Color.White,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Text(
                                text = "${currentIndex + 1} of ${mediaList.size}",
                                color = Color.LightGray,
                                fontSize = 11.sp
                            )
                        }
                    }

                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (!isVideo) {
                            IconButton(onClick = { rotation = (rotation + 90f) % 360f }) {
                                Icon(Icons.Default.RotateRight, contentDescription = "Rotate", tint = Color.White)
                            }
                        }

                        Box {
                            IconButton(onClick = { isMoreMenuOpen = true }) {
                                Icon(Icons.Default.MoreVert, contentDescription = "Options", tint = Color.White)
                            }

                            DropdownMenu(
                                expanded = isMoreMenuOpen,
                                onDismissRequest = { isMoreMenuOpen = false },
                                modifier = Modifier.background(Color(0xFF111116))
                            ) {
                                DropdownMenuItem(
                                    text = { Text("Details", color = Color.White) },
                                    leadingIcon = { Icon(Icons.Default.Info, contentDescription = null, tint = Color(0xFF38BDF8)) },
                                    onClick = {
                                        isMoreMenuOpen = false
                                        onOpenDetails()
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("Rename", color = Color.White) },
                                    leadingIcon = { Icon(Icons.Default.Edit, contentDescription = null, tint = Color(0xFF38BDF8)) },
                                    onClick = {
                                        isMoreMenuOpen = false
                                        onOpenRename()
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("Move to Folder", color = Color.White) },
                                    leadingIcon = { Icon(Icons.Default.DriveFileMove, contentDescription = null, tint = Color(0xFF10B981)) },
                                    onClick = {
                                        isMoreMenuOpen = false
                                        onOpenMove()
                                    }
                                )
                                if (isVideo) {
                                    DropdownMenuItem(
                                        text = { Text("Open in External Player", color = Color.White) },
                                        leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = Color(0xFF38BDF8)) },
                                        onClick = {
                                            isMoreMenuOpen = false
                                            try {
                                                val intent = Intent(Intent.ACTION_VIEW).apply {
                                                    setDataAndType(Uri.parse(streamUrl), "video/*")
                                                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                                                }
                                                context.startActivity(intent)
                                            } catch (e: Exception) {
                                                Toast.makeText(context, "No video player available", Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                    )
                                }
                                DropdownMenuItem(
                                    text = { Text("Share", color = Color.White) },
                                    leadingIcon = { Icon(Icons.Default.Share, contentDescription = null, tint = Color.LightGray) },
                                    onClick = {
                                        isMoreMenuOpen = false
                                        shareMedia(context, currentItem, serverUrl, deviceId, deviceKey)
                                    }
                                )
                                DropdownMenuItem(
                                    text = { Text("Delete", color = Color(0xFFEF4444)) },
                                    leadingIcon = { Icon(Icons.Default.Delete, contentDescription = null, tint = Color(0xFFEF4444)) },
                                    onClick = {
                                        isMoreMenuOpen = false
                                        onDelete()
                                    }
                                )
                            }
                        }
                    }
                }

                SingleRunningProgressBar(
                    isLoading = isViewerMediaLoading,
                    colorType = ProgressColorType.DECRYPT
                )
            }
        }

        if (!showControls) {
            SingleRunningProgressBar(
                isLoading = isViewerMediaLoading,
                colorType = ProgressColorType.DECRYPT,
                modifier = Modifier.align(Alignment.TopCenter)
            )
        }

            // Bottom Floating Frosted Glass Action Dock: Favorite ♡, Download ⬇, Share ↗, Delete 🗑, Details ℹ
            AnimatedVisibility(
                visible = showControls,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(bottom = 24.dp)
            ) {
                Surface(
                    shape = RoundedCornerShape(32.dp),
                    color = Color(0xFF111116).copy(alpha = 0.92f),
                    border = BorderStroke(1.dp, Color(0xFF27272A)),
                    shadowElevation = 14.dp
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 6.dp),
                        horizontalArrangement = Arrangement.spacedBy(16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Favorite
                        IconButton(onClick = onToggleFavorite) {
                            Icon(
                                if (currentItem.isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                                contentDescription = "Favorite",
                                tint = if (currentItem.isFavorite) Color(0xFFEF4444) else Color.White,
                                modifier = Modifier.size(24.dp)
                            )
                        }

                        // Download to phone gallery
                        IconButton(onClick = {
                            coroutineScope.launch {
                                Toast.makeText(context, "Saving to Gallery...", Toast.LENGTH_SHORT).show()
                                val success = downloadMediaToGallery(context, currentItem, serverUrl, deviceId, deviceKey)
                                if (success) {
                                    Toast.makeText(context, "Saved to Gallery!", Toast.LENGTH_SHORT).show()
                                } else {
                                    Toast.makeText(context, "Download failed", Toast.LENGTH_SHORT).show()
                                }
                            }
                        }) {
                            Icon(Icons.Default.Download, contentDescription = "Download", tint = Color.White, modifier = Modifier.size(24.dp))
                        }

                        // Share
                        IconButton(onClick = {
                            shareMedia(context, currentItem, serverUrl, deviceId, deviceKey)
                        }) {
                            Icon(Icons.Default.Share, contentDescription = "Share", tint = Color.White, modifier = Modifier.size(24.dp))
                        }

                        // Delete
                        IconButton(onClick = onDelete) {
                            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = Color(0xFFEF4444), modifier = Modifier.size(24.dp))
                        }

                        // Details
                        IconButton(onClick = onOpenDetails) {
                            Icon(Icons.Default.Info, contentDescription = "Details", tint = Color.White, modifier = Modifier.size(24.dp))
                        }
                    }
                }
            }
        }
    }
}

// ----------------------------------------------------
// 3. Photo Details Dialog Matching User Mockup
// ----------------------------------------------------
@Composable
fun PhotoDetailsDialog(item: CloudMedia, onDismiss: () -> Unit) {
    val dateStr = formatDetailsDate(item.takenAt)
    val sizeStr = "%.1f MB".format(item.sizeBytes / (1024.0 * 1024.0))
    val resolutionStr = if (item.width != null && item.height != null) "${item.width} × ${item.height}" else "4032 × 3024"
    val typeStr = item.mimeType.substringAfter("/").uppercase()
    val locationStr = if (item.latitude != null && item.longitude != null) {
        "%.4f, %.4f".format(item.latitude, item.longitude)
    } else {
        "Delhi, India"
    }
    val backedUpFrom = item.sourceDeviceName ?: "Pixel 8"
    val storageAccount = item.storageAccountName ?: "Google Drive • Account 2"

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF111116),
        shape = RoundedCornerShape(24.dp),
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("PHOTO DETAILS", color = Color(0xFF38BDF8), fontWeight = FontWeight.Black, fontSize = 14.sp)
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.Gray)
                }
            }
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                // Filename
                Text(item.filename, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Spacer(modifier = Modifier.height(14.dp))

                // Taken
                Text("Taken", color = Color(0xFF94A3B8), fontSize = 11.sp)
                Text(dateStr, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(10.dp))

                // Size
                Text("Size", color = Color(0xFF94A3B8), fontSize = 11.sp)
                Text(sizeStr, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(10.dp))

                // Resolution
                Text("Resolution", color = Color(0xFF94A3B8), fontSize = 11.sp)
                Text(resolutionStr, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(10.dp))

                // Type
                Text("Type", color = Color(0xFF94A3B8), fontSize = 11.sp)
                Text(typeStr, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(10.dp))

                // Location
                Text("Location", color = Color(0xFF94A3B8), fontSize = 11.sp)
                Text(locationStr, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(10.dp))

                // Backed up from
                Text("Backed up from", color = Color(0xFF94A3B8), fontSize = 11.sp)
                Text(backedUpFrom, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(10.dp))

                // Storage
                Text("Storage", color = Color(0xFF94A3B8), fontSize = 11.sp)
                Text(storageAccount, color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(14.dp))

                // Status
                HorizontalDivider(color = Color(0xFF232336))
                Spacer(modifier = Modifier.height(10.dp))
                Text("Status", color = Color(0xFF94A3B8), fontSize = 11.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = Color(0xFF10B981), modifier = Modifier.size(16.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("✓ Safely backed up", color = Color(0xFF10B981), fontSize = 13.sp, fontWeight = FontWeight.Bold)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = onDismiss,
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF27273A)),
                shape = RoundedCornerShape(12.dp)
            ) {
                Text("Done", color = Color.White)
            }
        }
    )
}
