package com.drive.sync

import android.content.Context
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.work.*
import com.drive.sync.workers.SyncWorker
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val prefs = getSharedPreferences("drive_prefs", Context.MODE_PRIVATE)

        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    SyncDashboardScreen(
                        initialServerUrl = prefs.getString("server_url", "http://10.0.2.2:5000") ?: "http://10.0.2.2:5000",
                        initialDeviceId = prefs.getString("device_id", "") ?: "",
                        initialDeviceKey = prefs.getString("device_key", "") ?: "",
                        initialWifiOnly = prefs.getBoolean("wifi_only", true),
                        initialChargingOnly = prefs.getBoolean("charging_only", false),
                        initialSyncVideos = prefs.getBoolean("sync_videos", true),
                        onSaveSettings = { serverUrl, deviceId, deviceKey, wifiOnly, chargingOnly, syncVideos ->
                            prefs.edit().apply {
                                putString("server_url", serverUrl)
                                putString("device_id", deviceId)
                                putString("device_key", deviceKey)
                                putBoolean("wifi_only", wifiOnly)
                                putBoolean("charging_only", chargingOnly)
                                putBoolean("sync_videos", syncVideos)
                                apply()
                            }
                        },
                        onScheduleSync = { serverUrl, deviceId, deviceKey, wifiOnly, chargingOnly, syncVideos ->
                            scheduleBackupWork(serverUrl, deviceId, deviceKey, wifiOnly, chargingOnly, syncVideos)
                            Toast.makeText(this, "Periodic background sync scheduled!", Toast.LENGTH_SHORT).show()
                        },
                        onSyncNow = { serverUrl, deviceId, deviceKey, syncVideos ->
                            triggerImmediateSync(serverUrl, deviceId, deviceKey, syncVideos)
                            Toast.makeText(this, "Immediate media sync triggered!", Toast.LENGTH_SHORT).show()
                        }
                    )
                }
            }
        }
    }

    private fun scheduleBackupWork(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
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
        syncVideos: Boolean
    ) {
        val syncRequest = OneTimeWorkRequestBuilder<SyncWorker>()
            .setInputData(
                workDataOf(
                    "server_url" to serverUrl,
                    "device_id" to deviceId,
                    "device_key" to deviceKey,
                    "sync_videos" to syncVideos
                )
            )
            .build()

        WorkManager.getInstance(applicationContext).enqueue(syncRequest)
    }
}

@Composable
fun SyncDashboardScreen(
    initialServerUrl: String,
    initialDeviceId: String,
    initialDeviceKey: String,
    initialWifiOnly: Boolean,
    initialChargingOnly: Boolean,
    initialSyncVideos: Boolean,
    onSaveSettings: (String, String, String, Boolean, Boolean, Boolean) -> Unit,
    onScheduleSync: (String, String, String, Boolean, Boolean, Boolean) -> Unit,
    onSyncNow: (String, String, String, Boolean) -> Unit
) {
    var serverUrl by remember { mutableStateOf(initialServerUrl) }
    var deviceId by remember { mutableStateOf(initialDeviceId) }
    var deviceKey by remember { mutableStateOf(initialDeviceKey) }
    var wifiOnly by remember { mutableStateOf(initialWifiOnly) }
    var chargingOnly by remember { mutableStateOf(initialChargingOnly) }
    var syncVideos by remember { mutableStateOf(initialSyncVideos) }

    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "myDrive Sync",
            style = MaterialTheme.typography.headlineMedium
        )
        Text(
            text = "Personal Cloud Storage & Multi-Drive Backup",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        // Configuration Card
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                Text(
                    text = "Connection & Pairing",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    text = "Get Device ID & Key from web app: Connected Devices > Pair Android",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.outline
                )

                OutlinedTextField(
                    value = serverUrl,
                    onValueChange = { serverUrl = it },
                    label = { Text("Server Backend URL") },
                    placeholder = { Text("https://your-backend.onrender.com") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = deviceId,
                    onValueChange = { deviceId = it },
                    label = { Text("Device ID") },
                    placeholder = { Text("e.g. dev_1725... or pixel_9") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )

                OutlinedTextField(
                    value = deviceKey,
                    onValueChange = { deviceKey = it },
                    label = { Text("Device Key") },
                    placeholder = { Text("dkey_android_...") },
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true
                )
            }
        }

        // Policy Controls Card
        Card(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "Backup Policies",
                    style = MaterialTheme.typography.titleMedium
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Wi-Fi Only Uploads")
                    Switch(checked = wifiOnly, onCheckedChange = { wifiOnly = it })
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Charging Only Uploads")
                    Switch(checked = chargingOnly, onCheckedChange = { chargingOnly = it })
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Backup Videos")
                    Switch(checked = syncVideos, onCheckedChange = { syncVideos = it })
                }

                HorizontalDivider()

                Text(
                    text = "Deletion Policy: Keep in Cloud (Safe)",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }

        // Action Buttons
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedButton(
                onClick = {
                    if (deviceId.isBlank() || deviceKey.isBlank()) return@OutlinedButton
                    onSaveSettings(serverUrl, deviceId, deviceKey, wifiOnly, chargingOnly, syncVideos)
                    onSyncNow(serverUrl, deviceId, deviceKey, syncVideos)
                },
                modifier = Modifier.weight(1f),
                enabled = deviceId.isNotBlank() && deviceKey.isNotBlank()
            ) {
                Text("Sync Now")
            }

            Button(
                onClick = {
                    if (deviceId.isBlank() || deviceKey.isBlank()) return@Button
                    onSaveSettings(serverUrl, deviceId, deviceKey, wifiOnly, chargingOnly, syncVideos)
                    onScheduleSync(serverUrl, deviceId, deviceKey, wifiOnly, chargingOnly, syncVideos)
                },
                modifier = Modifier.weight(1f),
                enabled = deviceId.isNotBlank() && deviceKey.isNotBlank()
            ) {
                Text("Save & Auto Sync")
            }
        }

        if (deviceId.isBlank() || deviceKey.isBlank()) {
            Text(
                text = "Please enter Device ID and Device Key to enable sync.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error
            )
        }
    }
}
