package com.drive.sync

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.work.*
import com.drive.sync.workers.SyncWorker
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    SyncDashboardScreen(onScheduleSync = { wifiOnly, chargingOnly ->
                        scheduleBackupWork(wifiOnly, chargingOnly)
                    })
                }
            }
        }
    }

    private fun scheduleBackupWork(wifiOnly: Boolean, chargingOnly: Boolean) {
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
                    "server_url" to "http://10.0.2.2:5000",
                    "device_id" to "android_pixel_9",
                    "device_key" to "dkey_android_dev_test"
                )
            )
            .build()

        WorkManager.getInstance(applicationContext).enqueueUniquePeriodicWork(
            "UnifiedDriveSync",
            ExistingPeriodicWorkPolicy.UPDATE,
            syncRequest
        )
    }
}

@Composable
fun SyncDashboardScreen(onScheduleSync: (Boolean, Boolean) -> Unit) {
    var wifiOnly by remember { mutableStateOf(true) }
    var chargingOnly by remember { mutableStateOf(false) }
    var isSyncActive by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            text = "myDrive",
            style = MaterialTheme.typography.headlineMedium
        )
        Text(
            text = "Personal Cloud Storage & Multi-Drive Pooling",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )

        Spacer(modifier = Modifier.height(16.dp))

        Card(
            modifier = Modifier.fillMaxWidth()
        ) {
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

                Divider()

                Text(
                    text = "Deletion Protection: Keep in Cloud (Safe)",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary
                )
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        Button(
            onClick = {
                onScheduleSync(wifiOnly, chargingOnly)
                isSyncActive = true
            },
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(if (isSyncActive) "Background Sync Scheduled" else "Start Automatic Backup")
        }
    }
}
