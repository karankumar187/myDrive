package com.drive.sync.network

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.locks.ReentrantLock
import kotlin.concurrent.withLock

/**
 * Thread-safe singleton for recording and displaying sync logs in real time across
 * WorkManager background workers and Compose UI screens.
 * Automatically persists recent entries to a local log file (synced_logs.txt).
 */
object SyncLogManager {
    private const val MAX_LOGS = 250
    private const val LOG_FILE_NAME = "synced_logs.txt"

    private val lock = ReentrantLock()
    private val timeFormat = SimpleDateFormat("HH:mm:ss", Locale.getDefault())

    private val _logsFlow = MutableStateFlow<List<String>>(emptyList())
    val logsFlow: StateFlow<List<String>> = _logsFlow.asStateFlow()

    private val _currentStatusFlow = MutableStateFlow<String>("")
    val currentStatusFlow: StateFlow<String> = _currentStatusFlow.asStateFlow()

    private var logFile: File? = null
    private var isInitialized = false

    fun init(context: Context) {
        lock.withLock {
            if (isInitialized && logFile != null) return
            try {
                val file = File(context.filesDir, LOG_FILE_NAME)
                logFile = file
                if (file.exists()) {
                    val lines = file.readLines()
                        .filter { it.isNotBlank() }
                        .takeLast(MAX_LOGS)
                        .reversed() // newest first
                    _logsFlow.value = lines
                }
                isInitialized = true
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    fun log(message: String) {
        lock.withLock {
            val timestamp = timeFormat.format(Date())
            val formatted = "[$timestamp] $message"
            val currentList = _logsFlow.value.toMutableList()
            currentList.add(0, formatted) // newest first
            if (currentList.size > MAX_LOGS) {
                currentList.removeAt(currentList.size - 1)
            }
            _logsFlow.value = currentList

            try {
                logFile?.let { file ->
                    file.appendText("$formatted\n")
                    // If file exceeds ~200KB, trim it to recent entries
                    if (file.length() > 200 * 1024) {
                        val trimmed = currentList.reversed().joinToString("\n")
                        file.writeText("$trimmed\n")
                    }
                }
            } catch (_: Exception) {}
        }
    }

    fun status(status: String) {
        _currentStatusFlow.value = status
    }

    fun clear() {
        lock.withLock {
            _logsFlow.value = emptyList()
            _currentStatusFlow.value = ""
            try {
                logFile?.delete()
            } catch (_: Exception) {}
        }
    }

    fun formatBytes(bytes: Long): String {
        if (bytes <= 0) return "0 B"
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        val digitGroups = (Math.log10(bytes.toDouble()) / Math.log10(1024.0)).toInt()
        val index = digitGroups.coerceIn(0, units.size - 1)
        val value = bytes / Math.pow(1024.0, index.toDouble())
        return if (index == 0) "${bytes} B" else String.format(Locale.US, "%.1f %s", value, units[index])
    }
}
