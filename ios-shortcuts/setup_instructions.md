# 📱 myDrive — iPhone Shortcuts Setup Guide

Complete guide to build **Upload** and **Auto-Sync** shortcuts with notifications for your iPhone.

---

## 🔔 Notifications in iOS Shortcuts

**Yes!** Shortcuts support local notifications:

| Feature | iOS Support |
|---|---|
| **Show Notification** | ✅ Title, body, sound, image attachment |
| **Progress updates** ("Uploading 3 of 10…") | ✅ Fire multiple notifications inside a loop |
| **Show Alert** (modal popup) | ✅ Blocks until user taps OK |
| **Banner notification** (background) | ✅ Works even when shortcut runs via automation |
| **Persistent ongoing notification** (like Android) | ❌ Not possible — iOS doesn't allow this |
| **Sound/vibration** | ✅ Default notification sound |

> **Key difference from Android**: You get a burst of banner notifications (one per file), not a single updating progress bar. But it works great for knowing what's happening.

---

## Prerequisites

### 1. Pair iPhone from Web Dashboard
1. Open your myDrive web dashboard
2. Go to **Device Policies** → **"Setup iPhone Shortcut"**
3. Enter a device name (e.g. `Karan's iPhone`)
4. Copy the generated:
   - **Device ID**: `dev_...`
   - **Device Key**: `dkey_iphone_...`

### 2. Note your server URL
```
https://drive-edge-cache.karan9302451907.workers.dev
```

---

## Shortcut 1: 📤 Manual Upload (Share Sheet + Manual)

This shortcut lets you:
- Select photos/videos manually and upload them
- OR share from any app to upload
- Shows notification per file uploaded

### Step-by-step build:

Open **Shortcuts** app → **+** → Name it **"Upload to myDrive"**

---

#### Action 1: Text — Server URL
- Add action: **Text**
- Content: `https://drive-edge-cache.karan9302451907.workers.dev`
- Rename variable to: `ServerURL`

#### Action 2: Text — Device ID
- Add action: **Text**
- Content: `YOUR_DEVICE_ID_HERE`
- Rename variable to: `DeviceId`

#### Action 3: Text — Device Key
- Add action: **Text**
- Content: `YOUR_DEVICE_KEY_HERE`
- Rename variable to: `DeviceKey`

#### Action 4: Get Shortcut Input or Select Photos
- Add action: **If**
  - Condition: `Shortcut Input` → `has any value`
- **If true** branch:
  - Add action: **Set Variable**
  - Name: `PhotosToUpload`
  - Value: `Shortcut Input`
- **Otherwise** branch:
  - Add action: **Select Photos**
    - ✅ Enable **Select Multiple**
  - Add action: **Set Variable**
  - Name: `PhotosToUpload`
  - Value: `Selected Photos`
- **End If**

#### Action 5: Count Photos
- Add action: **Count**
  - Input: `PhotosToUpload`
- Add action: **Set Variable**
  - Name: `TotalCount`
  - Value: `Count`

#### Action 6: Show Start Notification
- Add action: **Show Notification**
  - Title: `myDrive Upload`
  - Body: `Starting upload of [TotalCount] files…`

#### Action 7: Set Counter
- Add action: **Set Variable**
  - Name: `UploadedCount`
  - Value: `0` (use **Number** action set to 0)

#### Action 8: Repeat with Each Photo
- Add action: **Repeat with Each**
  - Input: `PhotosToUpload`

  Inside the loop:

  **a) Get file details**
  - Add action: **Get Details of Images**
    - Get: `Name` of `Repeat Item`
  - Rename variable to: `FileName`

  **b) Upload file**
  - Add action: **Get Contents of URL**
    - URL: `[ServerURL]/api/v1/shortcuts/upload`
    - Method: **POST**
    - Headers:
      - `X-Device-Id` → `[DeviceId]`
      - `X-Device-Key` → `[DeviceKey]`
    - Request Body: **Form**
      - Key: `media` → Value: `Repeat Item` → Type: **File**
      - Key: `deviceAssetId` → Value: `[FileName]` → Type: **Text**
      - Key: `filename` → Value: `[FileName]` → Type: **Text**
  - Rename variable to: `UploadResult`

  **c) Increment counter**
  - Add action: **Calculate**
    - `UploadedCount` + `1`
  - Add action: **Set Variable**
    - Name: `UploadedCount`
    - Value: `Calculation Result`

  **d) Show progress notification**
  - Add action: **Show Notification**
    - Title: `myDrive`
    - Body: `✅ [FileName] ([UploadedCount]/[TotalCount])`

- **End Repeat**

#### Action 9: Final Notification
- Add action: **Show Notification**
  - Title: `myDrive Upload Complete`
  - Body: `🎉 Successfully uploaded [UploadedCount] files to your cloud!`
  - ✅ Play Sound

#### Share Sheet Setup:
1. Tap the **ⓘ** icon at the bottom of the shortcut
2. Enable **"Show in Share Sheet"**
3. Set **Receives**: Images, Media, Files

---

## Shortcut 2: 🔄 Auto-Sync (Background + Scheduled)

This shortcut:
- Checks the server for last sync timestamp
- Finds all photos taken AFTER that timestamp
- Uploads only new ones (dedup handled server-side too)
- Shows notifications throughout

### Step-by-step build:

Open **Shortcuts** app → **+** → Name it **"myDrive Auto Sync"**

---

#### Action 1: Text — Server URL
- Add action: **Text**
- Content: `https://drive-edge-cache.karan9302451907.workers.dev`
- Rename variable to: `ServerURL`

#### Action 2: Text — Device ID
- Add action: **Text**
- Content: `YOUR_DEVICE_ID_HERE`
- Rename variable to: `DeviceId`

#### Action 3: Text — Device Key
- Add action: **Text**
- Content: `YOUR_DEVICE_KEY_HERE`
- Rename variable to: `DeviceKey`

#### Action 4: Sync Check — Get Last Sync Date
- Add action: **Get Contents of URL**
  - URL: `[ServerURL]/api/v1/shortcuts/sync-check`
  - Method: **GET**
  - Headers:
    - `X-Device-Id` → `[DeviceId]`
    - `X-Device-Key` → `[DeviceKey]`
- Rename variable to: `SyncStatus`

#### Action 5: Extract Last Sync Date
- Add action: **Get Dictionary Value**
  - Get value for key: `lastSyncedDate`
  - Dictionary: `SyncStatus`
- Add action: **Date**
  - Use: `Dictionary Value` (parsed from the ISO string)
- Rename variable to: `LastSyncDate`

#### Action 6: Find New Photos Since Last Sync
- Add action: **Find Photos**
  - Add filter: **Date Taken** → `is after` → `[LastSyncDate]`
  - Sort by: **Date Taken** → Oldest First
  - Limit: ✅ Enable → **50** items (keeps each run fast)
- Rename variable to: `NewPhotos`

#### Action 7: Count New Photos
- Add action: **Count**
  - Input: `NewPhotos`
- Add action: **Set Variable**
  - Name: `TotalNew`

#### Action 8: Check if Any New
- Add action: **If**
  - Condition: `TotalNew` → `is` → `0`
- **If true**:
  - Add action: **Show Notification**
    - Title: `myDrive Sync`
    - Body: `✅ Already up to date. No new photos.`
  - Add action: **Stop this Shortcut**
- **End If**

#### Action 9: Start Notification
- Add action: **Show Notification**
  - Title: `myDrive Sync Started`
  - Body: `📸 Found [TotalNew] new files to sync…`

#### Action 10: Set Counter
- Add action: **Set Variable**
  - Name: `SyncedCount`
  - Value: `0` (Number action)
- Add action: **Set Variable**
  - Name: `FailedCount`
  - Value: `0` (Number action)

#### Action 11: Upload Loop
- Add action: **Repeat with Each**
  - Input: `NewPhotos`

  Inside the loop:

  **a) Get file name**
  - Add action: **Get Details of Images**
    - Get: `Name` of `Repeat Item`
  - Rename variable to: `FileName`

  **b) Upload to server**
  - Add action: **Get Contents of URL**
    - URL: `[ServerURL]/api/v1/shortcuts/upload`
    - Method: **POST**
    - Headers:
      - `X-Device-Id` → `[DeviceId]`
      - `X-Device-Key` → `[DeviceKey]`
    - Request Body: **Form**
      - Key: `media` → Value: `Repeat Item` → Type: **File**
      - Key: `deviceAssetId` → Value: `[FileName]` → Type: **Text**
      - Key: `filename` → Value: `[FileName]` → Type: **Text**

  **c) Check result and update counter**
  - Add action: **If** → `Result` → `has any value`
    - **If true**:
      - **Calculate**: `SyncedCount` + `1`
      - **Set Variable**: `SyncedCount` = result
      - **Show Notification**:
        - Title: `myDrive`
        - Body: `☁️ [FileName] ([SyncedCount]/[TotalNew])`
    - **Otherwise**:
      - **Calculate**: `FailedCount` + `1`
      - **Set Variable**: `FailedCount` = result
  - **End If**

- **End Repeat**

#### Action 12: Final Summary Notification
- Add action: **Show Notification**
  - Title: `myDrive Sync Complete`
  - Body: `🎉 Synced: [SyncedCount] ✅ | Failed: [FailedCount] ❌`
  - ✅ Play Sound

---

## ⏰ Automation Setup (Hands-Free Background Sync)

Make the sync run automatically without you touching anything:

### Option A: Every time you plug in to charge
1. Open Shortcuts → **Automation** tab
2. Tap **+ New Automation**
3. Choose **"Charger"** → "Is Connected"
4. **Run Immediately** (disable "Ask Before Running")
5. Action: **Run Shortcut** → select **"myDrive Auto Sync"**

### Option B: Scheduled time (e.g., every night at 2 AM)
1. Open Shortcuts → **Automation** tab
2. Tap **+ New Automation**
3. Choose **"Time of Day"** → set **2:00 AM** → **Daily**
4. **Run Immediately** (disable "Ask Before Running")
5. Action: **Run Shortcut** → select **"myDrive Auto Sync"**

### Option C: When connected to home Wi-Fi
1. Open Shortcuts → **Automation** tab
2. Tap **+ New Automation**
3. Choose **"Wi-Fi"** → select your **home network**
4. **Run Immediately** (disable "Ask Before Running")
5. Action: **Run Shortcut** → select **"myDrive Auto Sync"**

> 💡 **Pro Tip**: You can set up ALL THREE automations. The server handles deduplication via SHA-256, so multiple syncs won't re-upload the same file.

---

## 🔔 Notification Behavior Summary

| Scenario | What You'll See |
|---|---|
| **Sync starts** | `📸 Found 12 new files to sync…` |
| **Each file uploaded** | `☁️ IMG_1234.jpg (3/12)` |
| **Sync complete** | `🎉 Synced: 12 ✅ | Failed: 0 ❌` |
| **Nothing to sync** | `✅ Already up to date. No new photos.` |
| **Share Sheet upload** | `✅ Beach_Photo.jpg (1/3)` per file |

Notifications appear as **banners** even when the shortcut runs in the background via automation — you'll see them on your Lock Screen and in Notification Center.

---

## ⚠️ iOS Limitations vs Android

| Feature | Android App | iOS Shortcut |
|---|---|---|
| **Background sync** | ✅ WorkManager + AlarmManager | ✅ Automation triggers |
| **Ongoing notification** | ✅ Persistent progress bar | ❌ Individual banners per file |
| **Auto-run without unlock** | ✅ Full background | ⚠️ Phone must have been unlocked once that day |
| **Upload limit per run** | Unlimited | ~50 files recommended (timeout risk) |
| **Wi-Fi only constraint** | ✅ Built-in toggle | ✅ Use Wi-Fi automation trigger |
| **Charging only constraint** | ✅ Built-in toggle | ✅ Use Charger automation trigger |
| **Deduplication** | ✅ SHA-256 server-side | ✅ Same SHA-256 server-side |
| **Video support** | ✅ | ✅ (50MB max per file via Shortcut) |
| **Gallery/file browser** | ✅ Full app UI | ❌ Use web dashboard |

---

## 🛠️ Troubleshooting

### "Could not connect to server"
- Make sure Server URL is exactly: `https://drive-edge-cache.karan9302451907.workers.dev`
- No trailing slash

### "Device authentication required"
- Double check Device ID and Device Key match what's in the web dashboard

### Automation doesn't run
- Go to Settings → Shortcuts → Advanced → Turn ON **"Allow Running Scripts"**
- Make sure "Run Immediately" is enabled (not "Ask Before Running")

### Uploads timeout on large videos
- Shortcut has a ~30s timeout per HTTP request
- Videos over 50MB will fail — use the web dashboard for those
- Set the Find Photos limit to 25-30 for video-heavy syncs
