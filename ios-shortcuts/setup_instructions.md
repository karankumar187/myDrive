# iPhone Apple Shortcuts — Setup & Automation Guide

This guide explains how to set up the **Apple Shortcut** for automatic, background photo and video backup to your Unified Personal Cloud.

---

## Architecture Overview

Because Apple iOS restricts background apps from running freely without App Store distribution, **Apple Shortcuts** provides native system integration with zero App Store friction. It natively accesses your Photos library and runs automated sync checks.

```
┌────────────────────────────────────────────────────────┐
│                   iPhone Trigger                       │
│    (Plugged into Charger OR Connected to Home Wi-Fi)   │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                Apple Shortcut (CloudSync)              │
│  1. Queries: GET /api/v1/shortcuts/sync-check          │
│     (Header: X-Device-Id, X-Device-Key)                │
│  2. Action: Find Photos where Date Taken > LastSync    │
│  3. For Each Photo:                                    │
│     - POST /api/v1/shortcuts/upload                    │
│     - Backend dedups via SHA-256 & stores in Drive     │
│  4. Reconciles local deletions                         │
└────────────────────────────────────────────────────────┘
```

---

## Step 1: Pair Your iPhone in Web Dashboard

1. Open your Unified Drive Web Dashboard on your laptop or phone browser.
2. Go to **Device Policies** → Click **"Setup iPhone Shortcut"**.
3. Enter your device name (e.g. `Karan iPhone 15`) and click **Generate Device Key**.
4. You will receive:
   - **Device ID**: `dev_...`
   - **Device Key**: `dkey_iphone_...`
5. Copy both values.

---

## Step 2: Configure the Apple Shortcut

1. Open the built-in **Shortcuts** app on your iPhone.
2. Tap **+** (New Shortcut) and rename it to **"Unified Drive Sync"**.
3. Add the following Actions:

### Action 1: Define Config Variables
* **Dictionary**:
  * `ServerUrl`: `http://<YOUR_SERVER_IP>:5000`
  * `DeviceId`: `<YOUR_DEVICE_ID>`
  * `DeviceKey`: `<YOUR_DEVICE_KEY>`

### Action 2: Check Last Sync Checkpoint
* **Get Contents of URL**:
  * URL: `http://<YOUR_SERVER_IP>:5000/api/v1/shortcuts/sync-check`
  * Method: `GET`
  * Headers:
    * `X-Device-Id`: `[Dictionary.DeviceId]`
    * `X-Device-Key`: `[Dictionary.DeviceKey]`
* **Get Dictionary Value**: Key `lastSyncedDate` from Contents of URL.

### Action 3: Find New Media
* **Find Photos**:
  * Filter: `Date Taken` is after `[lastSyncedDate]`
  * Sort by: `Date Taken` (Oldest First)
  * Limit: `50 items` (to keep each run efficient)

### Action 4: Upload Each Photo
* **Repeat with Each** (Photos):
  * **Get Contents of URL**:
    * URL: `http://<YOUR_SERVER_IP>:5000/api/v1/shortcuts/upload`
    * Method: `POST`
    * Headers:
      * `X-Device-Id`: `[Dictionary.DeviceId]`
      * `X-Device-Key`: `[Dictionary.DeviceKey]`
    * Request Body: `Form`
      * Key `media`: `[Repeat Item]` (Type: File)
      * Key `deviceAssetId`: `[Repeat Item's Name]`
* **End Repeat**

---

## Step 3: Set Up Hands-Free Nightly Automation

To make this completely automatic without ever touching the Shortcuts app again:

1. In the Shortcuts app, tap the **Automation** tab at the bottom.
2. Tap **+ (New Automation)**.
3. Choose either:
   - **"Charger"** → *When iPhone is connected to power*
   - **OR "Time of Day"** → *2:00 AM daily*
4. Select **"Run Immediately"** (turn off "Ask Before Running").
5. Action: Select **Run Shortcut** → **"Unified Drive Sync"**.

✅ **Done!** Every night when you plug in your phone, all new photos, videos, and screenshots will seamlessly back up to your pooled Google Drive accounts.
