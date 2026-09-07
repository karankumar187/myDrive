package com.drive.sync.network

import android.os.Handler
import android.os.Looper
import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket

object DriveSocketManager {
    private const val TAG = "DriveSocketManager"
    private var socket: Socket? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    private var currentServerUrl: String = ""
    private var currentDeviceId: String = ""
    private var currentDeviceKey: String = ""

    @Synchronized
    fun connect(
        serverUrl: String,
        deviceId: String,
        deviceKey: String,
        onEvent: (eventType: String) -> Unit
    ) {
        val cleanUrl = serverUrl.trimEnd('/')
        if (cleanUrl.isBlank() || deviceId.isBlank() || deviceKey.isBlank()) {
            return
        }

        // If already connected with same credentials, reuse existing socket
        if (socket != null && socket!!.connected() &&
            currentServerUrl == cleanUrl && currentDeviceId == deviceId && currentDeviceKey == deviceKey
        ) {
            return
        }

        disconnect()

        currentServerUrl = cleanUrl
        currentDeviceId = deviceId
        currentDeviceKey = deviceKey

        try {
            val authMap = mapOf(
                "deviceId" to deviceId,
                "deviceKey" to deviceKey
            )

            val options = IO.Options.builder()
                .setAuth(authMap)
                .setTransports(arrayOf("websocket", "polling"))
                .setReconnection(true)
                .setReconnectionAttempts(Int.MAX_VALUE)
                .setReconnectionDelay(2000)
                .setTimeout(15000)
                .build()

            socket = IO.socket(cleanUrl, options)

            socket?.on(Socket.EVENT_CONNECT) {
                Log.d(TAG, "⚡ Socket.IO connected to $cleanUrl as device $deviceId")
            }

            socket?.on(Socket.EVENT_CONNECT_ERROR) { args ->
                val err = if (args.isNotEmpty()) args[0].toString() else "Unknown error"
                Log.w(TAG, "Socket.IO connection error: $err")
            }

            socket?.on(Socket.EVENT_DISCONNECT) {
                Log.d(TAG, "Socket.IO disconnected")
            }

            // Real-time events from server
            val events = listOf(
                "file:uploaded",
                "file:trashed",
                "file:deleted",
                "file:restored",
                "file:bulk_action",
                "trash:emptied",
                "folder:created",
                "folder:deleted",
                "file:renamed",
                "file:moved",
                "file:favorite_toggled",
                "device:sync_status"
            )

            for (event in events) {
                socket?.on(event) { _ ->
                    Log.d(TAG, "⚡ Socket.IO event received: $event")
                    mainHandler.post {
                        onEvent(event)
                    }
                }
            }

            socket?.connect()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize Socket.IO: ${e.message}", e)
        }
    }

    @Synchronized
    fun disconnect() {
        try {
            socket?.disconnect()
            socket?.off()
            socket = null
        } catch (e: Exception) {
            Log.e(TAG, "Error during Socket.IO disconnect: ${e.message}")
        }
    }
}
