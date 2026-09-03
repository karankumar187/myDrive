# myDrive — Unified Personal Cloud Storage

A personal cloud platform that combines multiple authorized Google Drive accounts (15 GB free tiers) into one unified storage pool, supports automatic mobile backup (Android Kotlin & iPhone Shortcuts), provides a unified web library (React), and maintains strict separation between **App User Authentication** and **Google Drive Storage Authorization**.

---

## Architecture Overview

```
                                  ┌───────────────────────────────┐
                                  │       Google Identity         │
                                  └───────┬───────────────┬───────┘
                     App Login Scope      │               │ Drive Storage Scope
               (profile, email, openid)   │               │ (drive.file)
                                          │               │
                                   ┌──────▼──────┐ ┌──────▼──────────────┐
                                   │ Passport.js │ │ GDrive OAuth Router │
                                   └──────┬──────┘ └──────┬──────────────┘
                                          │               │
                                   ┌──────▼──────┐ ┌──────▼──────────────┐
                                   │    User     │ │  StorageAccount     │
                                   │  Collection │ │  (Encrypted Tokens) │
                                   └─────────────┘ └──────┬──────────────┘
                                                          │
┌──────────────────────────────┐                   ┌──────▼──────────────┐
│   Clients (Web / Android /   │──REST / Socket───►│ Unified Storage Eng │
│        iPhone Shortcut)      │                   │  - Quota Aggregator │
│  - React Web Dashboard       │                   │  - Dynamic Router   │
│  - Kotlin Android Background │                   │  - Resumable Upload │
│  - iPhone Shortcuts Worker   │                   │  - SHA-256 Dedup    │
└──────────────────────────────┘                   └─────────────────────┘
```

---

## Core Security & Architecture Features

1. **Strict Identity Separation**:
   - **User App Login**: Handled via Passport.js (`google-oauth20`) requesting only `openid`, `profile`, `email`.
   - **Google Drive Storage Linking**: Handled via independent OAuth requesting `https://www.googleapis.com/auth/drive.file`.
   - Refresh tokens are stored with **AES-256-GCM envelope encryption**; unlinking or revoking a Drive account will never log you out of the app.
2. **Permanent Refresh Tokens (No 7-Day Expiry)**:
   - Setting Google Cloud OAuth status to **"In Production"** ensures refresh tokens last permanently without recurring manual re-authentication.
3. **Zero-Knowledge Client-Side Encryption (E2EE)**:
   - Files and photos are encrypted in the browser (Web Crypto API) or Android app (Jetpack Security) using **AES-256-GCM** before uploading to Google Drive.
   - Files on Google Drive appear as opaque, unreadable binary blobs (`blob_<uuid>.enc`). Google cannot scan photos, read EXIF tags, or inspect contents.
4. **Instant Deduplication**:
   - Computes raw **SHA-256** before encryption. If a photo is already backed up, the system links the new device source without duplicating bytes in Google Drive.
5. **Safe Deletions**:
   - Clearing phone storage to free space never deletes files from the cloud.
   - Cloud deletions move to a 30-day Recycle Bin before permanent purging.

---

## Getting Started

### 1. Start Database & Cache (Docker Compose)
```bash
docker compose up -d
```
Starts:
- **MongoDB** on `localhost:27017`
- **Redis** on `localhost:6379`

### 2. Start Backend Server
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```
Backend API will start at `http://localhost:5000`.

### 3. Start React Web Dashboard
```bash
cd web
npm install
npm run dev
```
Web dashboard will start at `http://localhost:5173`.

---

## Client Setup

- **iPhone Shortcuts**: See [ios-shortcuts/setup_instructions.md](file:///Users/karankumar/Documents/Projects/Drive/ios-shortcuts/setup_instructions.md) for importing the Shortcut and setting up automated nightly charging backups.
- **Android App**: Open `mobile-android/` in Android Studio to build and run the Jetpack Compose app with WorkManager background sync.
