package com.drive.sync

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.media.MediaPlayer
import android.widget.MediaController
import android.widget.Toast
import android.widget.VideoView
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
        val req = Request.Builder().url(streamUrl).build()
        val res = sharedHttpClient.newCall(req).execute()
        if (!res.isSuccessful) return@withContext false
        val bytes = res.body?.bytes() ?: return@withContext false

        val isVideo = item.mimeType.startsWith("video/")
        val contentValues = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, item.filename)
            put(MediaStore.MediaColumns.MIME_TYPE, item.mimeType)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(
                    MediaStore.MediaColumns.RELATIVE_PATH,
                    if (isVideo) Environment.DIRECTORY_MOVIES + "/myDrive" else Environment.DIRECTORY_PICTURES + "/myDrive"
                )
                put(MediaStore.MediaColumns.IS_PENDING, 1)
            }
        }

        val collection = if (isVideo) {
            MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        } else {
            MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        }

        val uri = context.contentResolver.insert(collection, contentValues) ?: return@withContext false
        context.contentResolver.openOutputStream(uri)?.use { out ->
            out.write(bytes)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            contentValues.clear()
            contentValues.put(MediaStore.MediaColumns.IS_PENDING, 0)
            context.contentResolver.update(uri, contentValues, null, null)
        }
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
// Single Running Progress Line from Start to Complete
// ----------------------------------------------------
@Composable
fun SingleRunningProgressBar(
    isLoading: Boolean,
    modifier: Modifier = Modifier,
    height: androidx.compose.ui.unit.Dp = 2.5.dp,
    color: Color = Color(0xFFA855F7),
    trackColor: Color = Color(0x22A855F7)
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
    val thumbUrl = remember(item.id, serverUrl, deviceId, deviceKey) {
        "${serverUrl.trimEnd('/')}/api/v1/files/${item.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"
    }

    val imageRequest = remember(item.id, thumbUrl) {
        ImageRequest.Builder(context)
            .data(thumbUrl)
            .addHeader("x-device-id", deviceId)
            .addHeader("x-device-key", deviceKey)
            .size(Size(240, 240))
            .precision(Precision.INEXACT)
            .memoryCacheKey("thumb_${item.id}")
            .diskCacheKey("thumb_${item.id}")
            .crossfade(false)
            .build()
    }

    Box(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(4.dp))
            .background(Color(0xFF14141D))
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
                            listOf(Color(0xFF261044), Color(0xFF101018))
                        )
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Default.PlayArrow,
                    contentDescription = null,
                    tint = Color(0xFFA855F7).copy(alpha = 0.75f),
                    modifier = Modifier.size(34.dp)
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

        // Video Indicator
        if (isVideo) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomStart)
                    .padding(3.dp)
                    .background(Color.Black.copy(alpha = 0.7f), RoundedCornerShape(3.dp))
                    .padding(horizontal = 4.dp, vertical = 2.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.PlayArrow,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(10.dp)
                    )
                    if (item.duration != null && item.duration > 0) {
                        Spacer(modifier = Modifier.width(2.dp))
                        Text(
                            text = "${item.duration.toInt()}s",
                            color = Color.White,
                            fontSize = 8.sp,
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
                    .align(Alignment.BottomEnd)
                    .padding(3.dp)
                    .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                    .padding(2.dp)
            ) {
                Icon(
                    Icons.Default.Cloud,
                    contentDescription = "Cloud only",
                    tint = Color(0xFFA855F7),
                    modifier = Modifier.size(10.dp)
                )
            }
        }

        // Favorite Indicator
        if (item.isFavorite) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(3.dp)
                    .background(Color.Black.copy(alpha = 0.6f), CircleShape)
                    .padding(2.dp)
            ) {
                Icon(
                    Icons.Default.Favorite,
                    contentDescription = "Favorite",
                    tint = Color(0xFFEF4444),
                    modifier = Modifier.size(10.dp)
                )
            }
        }

        // Selection Checkbox
        if (isSelectionMode) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(3.dp)
                    .background(
                        if (isSelected) Color(0xFFA855F7) else Color.Black.copy(alpha = 0.5f),
                        CircleShape
                    )
                    .padding(2.dp)
            ) {
                Icon(
                    if (isSelected) Icons.Default.Check else Icons.Default.RadioButtonUnchecked,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(12.dp)
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
    onRefresh: () -> Unit
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
            .background(Color(0xFF09090C))
    ) {
        // Top Header Bar
        Surface(
            modifier = Modifier.fillMaxWidth(),
            color = Color(0xFF101015),
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
                                focusedBorderColor = Color(0xFFA855F7),
                                unfocusedBorderColor = Color(0xFF27273A),
                                focusedContainerColor = Color(0xFF161622),
                                unfocusedContainerColor = Color(0xFF161622)
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
                                        withStyle(style = SpanStyle(color = Color(0xFFC084FC))) {
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
                                        .background(Color(0xFFA855F7))
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
                                    modifier = Modifier.background(Color(0xFF1B1B26))
                                ) {
                                    DropdownMenuItem(
                                        text = { Text("Select Mode", color = Color.White) },
                                        leadingIcon = { Icon(Icons.Default.CheckCircleOutline, contentDescription = null, tint = Color(0xFFA855F7)) },
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
                                    HorizontalDivider(color = Color(0xFF28283C))
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
                                color = Color(0xFF1E1E2C),
                                border = BorderStroke(1.dp, Color(0xFF323247)),
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
                                modifier = Modifier.background(Color(0xFF1B1B26))
                            ) {
                                listOf("All Photos", "Favorites", "Videos", "Photos").forEach { opt ->
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                text = opt,
                                                color = if (filterType == opt) Color(0xFFA855F7) else Color.White,
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
                                color = if (selectedDeviceFilters.isNotEmpty()) Color(0xFF2E1A47) else Color(0xFF1E1E2C),
                                border = BorderStroke(1.dp, if (selectedDeviceFilters.isNotEmpty()) Color(0xFFA855F7) else Color(0xFF323247)),
                                modifier = Modifier.clickable { isDeviceFilterMenuOpen = true }
                            ) {
                                Row(
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Icon(
                                        Icons.Default.PhoneAndroid,
                                        contentDescription = null,
                                        tint = if (selectedDeviceFilters.isNotEmpty()) Color(0xFFA855F7) else Color(0xFF94A3B8),
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
                                    .background(Color(0xFF1B1B26))
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
                                                    checkedColor = Color(0xFFA855F7),
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

                                HorizontalDivider(color = Color(0xFF28283C))

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
                                                        checkedColor = Color(0xFFA855F7),
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
                                                    checkedColor = Color(0xFFA855F7),
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
                color = Color(0xFF1A1A28),
                border = BorderStroke(1.dp, Color(0xFFA855F7)),
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
                            color = Color(0xFFA855F7),
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
                            Icon(Icons.Default.Download, contentDescription = "Download to Gallery", tint = Color(0xFFA855F7))
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
                                coroutineScope.launch {
                                    isActionLoading = true
                                    try {
                                        apiBulkAction(serverUrl, deviceId, deviceKey, "trash", ids)
                                        localList = localList.filter { !ids.contains(it.id) }
                                        selectedIds.clear()
                                        isSelectionMode = false
                                        Toast.makeText(context, "Moved to Trash", Toast.LENGTH_SHORT).show()
                                    } finally {
                                        isActionLoading = false
                                    }
                                }
                            },
                            enabled = selectedIds.isNotEmpty()
                        ) {
                            Icon(Icons.Default.Delete, contentDescription = "Trash", tint = Color(0xFFF87171))
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
            // Main 4-Column Grid with Date Grouping
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 80.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
                horizontalArrangement = Arrangement.spacedBy(2.dp)
            ) {
                groupedMedia.forEach { (monthYear, itemsInGroup) ->
                    // Date Group Header
                    item(
                        key = "header_$monthYear",
                        span = { GridItemSpan(4) },
                        contentType = "header"
                    ) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .background(Color(0xFF09090C))
                                .padding(horizontal = 14.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = monthYear,
                                color = Color(0xFFF1F5F9),
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                letterSpacing = 0.3.sp
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
                coroutineScope.launch {
                    isActionLoading = true
                    try {
                        apiTrashFile(serverUrl, deviceId, deviceKey, current.id)
                        localList = localList.filter { it.id != current.id }
                        if (viewerIndex!! >= localList.size) {
                            viewerIndex = if (localList.isNotEmpty()) localList.size - 1 else null
                        }
                        Toast.makeText(context, "Moved to Trash", Toast.LENGTH_SHORT).show()
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
                        focusedBorderColor = Color(0xFFA855F7),
                        unfocusedBorderColor = Color(0xFF36364D)
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
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFA855F7))
                ) {
                    Text("Save", color = Color.White)
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
                        var isBuffering by remember { mutableStateOf(true) }
                        var playbackError by remember { mutableStateOf<String?>(null) }
                        var videoViewRef by remember { mutableStateOf<VideoView?>(null) }
                        var directVideoUrl by remember { mutableStateOf<String?>(null) }

                        LaunchedEffect(currentItem.id) {
                            withContext(Dispatchers.IO) {
                                try {
                                    val gdriveReqUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${currentItem.id}/gdrive-url?deviceId=$deviceId&deviceKey=$deviceKey"
                                    val req = Request.Builder()
                                        .url(gdriveReqUrl)
                                        .addHeader("x-device-id", deviceId)
                                        .addHeader("x-device-key", deviceKey)
                                        .get()
                                        .build()
                                    val res = sharedHttpClient.newCall(req).execute()
                                    if (res.isSuccessful) {
                                        val body = res.body?.string() ?: ""
                                        val json = JSONObject(body)
                                        val direct = json.optString("directUrl", "")
                                        if (direct.isNotBlank()) {
                                            withContext(Dispatchers.Main) {
                                                directVideoUrl = direct
                                            }
                                            return@withContext
                                        }
                                    }
                                } catch (e: Exception) {
                                    // fallback
                                }
                                withContext(Dispatchers.Main) {
                                    directVideoUrl = streamUrl
                                }
                            }
                        }

                        DisposableEffect(currentItem.id) {
                            onDispose {
                                videoViewRef?.stopPlayback()
                            }
                        }

                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            val playUrl = directVideoUrl
                            if (playUrl != null) {
                                AndroidView(
                                    factory = { ctx ->
                                        VideoView(ctx).apply {
                                            videoViewRef = this
                                            val mc = MediaController(ctx)
                                            mc.setAnchorView(this)
                                            setMediaController(mc)

                                            setOnPreparedListener { mp ->
                                                isBuffering = false
                                                isViewerMediaLoading = false
                                                playbackError = null
                                                mp.isLooping = false
                                                start()
                                            }

                                            setOnInfoListener { _, what, _ ->
                                                if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) {
                                                    isBuffering = true
                                                    isViewerMediaLoading = true
                                                } else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END) {
                                                    isBuffering = false
                                                    isViewerMediaLoading = false
                                                }
                                                true
                                            }

                                            setOnErrorListener { _, what, extra ->
                                                isBuffering = false
                                                isViewerMediaLoading = false
                                                playbackError = "Unable to stream video ($what, $extra)"
                                                true
                                            }

                                            setVideoURI(Uri.parse(playUrl))
                                        }
                                    },
                                    modifier = Modifier.fillMaxSize()
                                )
                            }

                            if ((isBuffering || directVideoUrl == null) && playbackError == null) {
                                // Progress line at top handles buffering UX — no circular spinner
                                if (directVideoUrl == null) {
                                    Text(
                                        "Connecting to Google Drive CDN...",
                                        color = Color.White.copy(alpha = 0.6f),
                                        fontSize = 12.sp,
                                        modifier = Modifier.align(Alignment.Center)
                                    )
                                }
                            }

                            if (playbackError != null) {
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
                                    Text("Playback Error", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                                    Spacer(modifier = Modifier.height(4.dp))
                                    Text(playbackError ?: "", color = Color(0xFF94A3B8), fontSize = 12.sp)
                                    Spacer(modifier = Modifier.height(14.dp))
                                    Button(
                                        onClick = {
                                            try {
                                                val intent = Intent(Intent.ACTION_VIEW).apply {
                                                    setDataAndType(Uri.parse(playUrl ?: streamUrl), "video/*")
                                                    flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION
                                                }
                                                context.startActivity(intent)
                                            } catch (e: Exception) {
                                                Toast.makeText(context, "No external video player found", Toast.LENGTH_SHORT).show()
                                            }
                                        },
                                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF7E22CE))
                                    ) {
                                        Text("Open in External Player")
                                    }
                                }
                            }
                        }
                    }
                } else {
                    key(currentItem.id) {
                        var isImageLoading by remember { mutableStateOf(true) }
                        var isImageError by remember { mutableStateOf(false) }
                        val thumbUrl = "${serverUrl.trimEnd('/')}/api/v1/files/${currentItem.id}/thumbnail?deviceId=$deviceId&deviceKey=$deviceKey"

                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            // While high-res loads: show previous image (or thumbnail) — no spinner or loading screen
                            if (isImageLoading && !isImageError) {
                                val prevUrl = prevImageUrl
                                if (prevUrl != null) {
                                    // Previous image kept clear and crisp — seamless transition without blank screen or loading spinner
                                    AsyncImage(
                                        model = ImageRequest.Builder(context)
                                            .data(prevUrl)
                                            .addHeader("x-device-id", deviceId)
                                            .addHeader("x-device-key", deviceKey)
                                            .crossfade(false)
                                            .build(),
                                        contentDescription = null,
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Fit
                                    )
                                } else {
                                    // First-ever image: show thumbnail while full-res loads
                                    AsyncImage(
                                        model = ImageRequest.Builder(context)
                                            .data(thumbUrl)
                                            .addHeader("x-device-id", deviceId)
                                            .addHeader("x-device-key", deviceKey)
                                            .crossfade(false)
                                            .build(),
                                        contentDescription = null,
                                        modifier = Modifier.fillMaxSize(),
                                        contentScale = ContentScale.Fit
                                    )
                                }
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
                                    prevImageUrl = streamUrl
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
                                        translationX = offset.x,
                                        translationY = offset.y,
                                        alpha = if (isImageLoading) 0f else 1f
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

                    Box {
                        IconButton(onClick = { isMoreMenuOpen = true }) {
                            Icon(Icons.Default.MoreVert, contentDescription = "Options", tint = Color.White)
                        }

                        DropdownMenu(
                            expanded = isMoreMenuOpen,
                            onDismissRequest = { isMoreMenuOpen = false },
                            modifier = Modifier.background(Color(0xFF1B1B26))
                        ) {
                            DropdownMenuItem(
                                text = { Text("Details", color = Color.White) },
                                leadingIcon = { Icon(Icons.Default.Info, contentDescription = null, tint = Color(0xFFA855F7)) },
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
                                leadingIcon = { Icon(Icons.Default.DriveFileMove, contentDescription = null, tint = Color(0xFF34D399)) },
                                onClick = {
                                    isMoreMenuOpen = false
                                    onOpenMove()
                                }
                            )
                            if (isVideo) {
                                DropdownMenuItem(
                                    text = { Text("Open in External Player", color = Color.White) },
                                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.OpenInNew, contentDescription = null, tint = Color(0xFFA855F7)) },
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

                SingleRunningProgressBar(
                    isLoading = isViewerMediaLoading
                )
            }
        }

        if (!showControls) {
            SingleRunningProgressBar(
                isLoading = isViewerMediaLoading,
                modifier = Modifier.align(Alignment.TopCenter)
            )
        }

            // Bottom Action Bar: Favorite ♡, Download ⬇, Share ↗, Delete 🗑, Details ℹ
            AnimatedVisibility(
                visible = showControls,
                enter = fadeIn(),
                exit = fadeOut(),
                modifier = Modifier.align(Alignment.BottomCenter)
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(
                            Brush.verticalGradient(
                                listOf(Color.Transparent, Color.Black.copy(alpha = 0.85f))
                            )
                        )
                        .padding(top = 16.dp, bottom = 32.dp, start = 16.dp, end = 16.dp),
                    horizontalArrangement = Arrangement.SpaceAround,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Favorite
                    IconButton(onClick = onToggleFavorite) {
                        Icon(
                            if (currentItem.isFavorite) Icons.Default.Favorite else Icons.Default.FavoriteBorder,
                            contentDescription = "Favorite",
                            tint = if (currentItem.isFavorite) Color(0xFFEF4444) else Color.White,
                            modifier = Modifier.size(26.dp)
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
                        Icon(Icons.Default.Download, contentDescription = "Download", tint = Color.White, modifier = Modifier.size(26.dp))
                    }

                    // Share
                    IconButton(onClick = {
                        shareMedia(context, currentItem, serverUrl, deviceId, deviceKey)
                    }) {
                        Icon(Icons.Default.Share, contentDescription = "Share", tint = Color.White, modifier = Modifier.size(26.dp))
                    }

                    // Delete
                    IconButton(onClick = onDelete) {
                        Icon(Icons.Default.Delete, contentDescription = "Delete", tint = Color(0xFFEF4444), modifier = Modifier.size(26.dp))
                    }

                    // Details
                    IconButton(onClick = onOpenDetails) {
                        Icon(Icons.Default.Info, contentDescription = "Details", tint = Color.White, modifier = Modifier.size(26.dp))
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
        containerColor = Color(0xFF161622),
        shape = RoundedCornerShape(24.dp),
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("PHOTO DETAILS", color = Color(0xFFA855F7), fontWeight = FontWeight.Black, fontSize = 14.sp)
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
