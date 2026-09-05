# ☁️ myDrive — Unified Personal Cloud Storage & Media Vault

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green?logo=node.js)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev/)
[![Android](https://img.shields.io/badge/Android-Jetpack%20Compose-3DDC84?logo=android)](https://developer.android.com/jetpack/compose)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers%20%26%20Edge%20Cache-F38020?logo=cloudflare)](https://workers.cloudflare.com/)
[![Render](https://img.shields.io/badge/Deploy-Render-46E3B7?logo=render)](https://render.com)
[![License](https://img.shields.io/badge/License-MIT-purple)](#license)

**myDrive** is a self-hosted, enterprise-grade personal cloud storage platform that seamlessly pools multiple Google Drive accounts (15 GB free tiers) into one unified, infinite storage drive. It features zero-knowledge client-side encryption (E2EE), instant SHA-256 deduplication, a Google Photos-style timeline gallery, an Android Jetpack Compose app with background battery-aware sync, and a global Cloudflare edge caching layer.

---

## 📑 Table of Contents

- [Architectural Overview](#-architectural-overview)
- [Key Features & Capabilities](#-key-features--capabilities)
  - [1. Multi-Drive Storage Pooling & Routing](#1-multi-drive-storage-pooling--routing)
  - [2. Google Photos-Style Timeline Gallery](#2-google-photos-style-timeline-gallery)
  - [3. Zero-Knowledge E2EE Vault](#3-zero-knowledge-e2ee-vault)
  - [4. Android App (Jetpack Compose & Kotlin)](#4-android-app-jetpack-compose--kotlin)
  - [5. iOS Shortcuts Automated Backup](#5-ios-shortcuts-automated-backup)
  - [6. High-Performance Streaming & Edge Caching](#6-high-performance-streaming--edge-caching)
  - [7. File & Folder Management](#7-file--folder-management)
- [System Architecture & Deployment Stack](#-system-architecture--deployment-stack)
- [Installation & Local Setup](#-installation--local-setup)
  - [Prerequisites](#prerequisites)
  - [Step 1: Start Database (Docker Compose)](#step-1-start-database-docker-compose)
  - [Step 2: Start Backend Server](#step-2-start-backend-server)
  - [Step 3: Start Web Frontend](#step-3-start-web-frontend)
- [Android App Compilation & Installation](#-android-app-compilation--installation)
- [Production Deployment Guide](#-production-deployment-guide)
  - [Render (Backend)](#render-backend)
  - [Cloudflare Workers (Frontend & Edge Cache)](#cloudflare-workers-frontend--edge-cache)
- [Environment Variables Guide](#-environment-variables-guide)
- [Security & Architecture Separation](#-security--architecture-separation)

---

## 🏛️ Architectural Overview

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
│  - Cloudflare Edge Gateway   │                   │  - Cursor Pagination│
└──────────────────────────────┘                   └─────────────────────┘
```

---

## 🚀 Key Features & Capabilities

### 1. Multi-Drive Storage Pooling & Routing
- **Unlimited Drive Aggregation**: Connect 2, 5, 10, or more Google Drive accounts to build a 30 GB, 75 GB, 150 GB+ continuous pool without paying monthly cloud subscriptions.
- **Dynamic Smart Routing**: The storage engine inspects real-time available quota across all connected Google accounts and dynamically routes uploads to the account with the most remaining space.
- **Resumable Chunked Uploads**: Seamlessly handles large files and videos by initiating Google Drive resumable upload sessions.
- **Storage Health Dashboard**: Visual breakdown of total pool capacity, consumed storage, per-account quotas, and connection health with one-click reauthorization.

### 2. Google Photos-Style Timeline Gallery
- **Timeline Organization**: Media items are automatically grouped chronologically by Month & Year with sticky headers and file counts.
- **Infinite Scroll with Cursor Pagination**: Fast cursor pagination (`limit` & `cursor`) backed by MongoDB compound indexes (`metadata.takenAt`, `createdAt`, `_id`). Pre-fetches batches 400px before reaching the bottom for 60fps scrolling.
- **Full-Screen Media Viewer**:
  - High-res photo inspection with zoom in/out, 90° clockwise/counter-clockwise rotation.
  - Video playback with custom controls and keyboard navigation (`←`/`→` arrows, `Esc`).
  - Quick action toolbar: Favorite, Download, Rename, Move to Folder, Move to Trash, and File Details.
- **Dynamic Search & Filtering**: Instant client & server filtering by:
  - `Photos` only or `Videos` only
  - `Favorites`
  - Source Device (filter by phone, web, or specific paired device)
  - Filename and device name keyword search.

### 3. Zero-Knowledge E2EE Vault
- **Client-Side AES-256-GCM**: Files and photos are encrypted in the browser (Web Crypto API) or Android app (Jetpack Security) with 256-bit keys derived via PBKDF2 (100,000 iterations).
- **Google Scanning Protection**: Files land on Google Drive as opaque binary blobs (`blob_<uuid>.enc`). Google cannot read EXIF data, inspect photo contents, or build tracking profiles.
- **Zero Server Knowledge**: Encryption keys and passphrases are never sent to or stored on the backend server.
- **Instant Hash Deduplication**: Pre-computes raw SHA-256 hashes before encryption. If an identical file exists in the cloud, it links immediately without consuming additional Drive space.

### 4. Android App (Jetpack Compose & Kotlin)
- **100% Native Jetpack Compose**: Beautiful dark theme, Material 3 components, smooth animations, and edge-to-edge UI.
- **Zero-Memory Streaming Uploads**: Streams file bytes directly through Okio pipes (`ContentResolver.openInputStream(uri)`) into OkHttp request bodies. Eliminates full-file heap buffers and prevents OutOfMemory crashes on multi-GB 4K videos.
- **Smart WorkManager Background Sync**:
  - Configurable periodic sync intervals (1h, 2h, 4h, 6h, 12h, 24h) with initial stagger offset.
  - **Battery Protection**: Automatically halts sync when battery is low (<15-20%) unless connected to a charger (`setRequiresBatteryNotLow(true)`).
  - **Storage Protection**: Pauses sync if device storage is critically low (`setRequiresStorageNotLow(true)`).
  - **Network Policy**: Wi-Fi Only or Unmetered Network toggles.
- **Inbound Sync**: Auto-downloads photos and documents uploaded from other devices or the web directly into your Android gallery.
- **File Management**: Long-press multi-select, batch favorites, batch move, batch trash, rename dialogs, and folder picker.
- **R8 Minification**: Pre-configured ProGuard/R8 shrinking reducing APK size to just ~7 MB.

### 5. iOS Shortcuts Automated Backup
- **Native iOS Shortcuts Support**: Back up iPhone camera roll and documents automatically without installing third-party apps or paying for an Apple Developer license.
- **Nightly Automated Charging Backup**: Triggers when the iPhone is plugged into a charger at night and connected to home Wi-Fi.
- **Setup Guide**: Includes ready-to-use Shortcut workflow in [`ios-shortcuts/`](file:///Users/karankumar/Documents/Projects/Drive/ios-shortcuts).

### 6. High-Performance Streaming & Edge Caching
- **Cloudflare Edge Gateway Worker**: Geo-distributed edge worker (`https://drive-edge-cache.karan9302451907.workers.dev`) providing:
  - Edge caching of media thumbnails across 330+ Cloudflare data centers (`Cache-Control: public, max-age=604800`).
  - HTTP/3 and Brotli acceleration.
  - Transparent API and media stream proxying.
- **Video Seeking & Byte-Range Requests**:
  - Full support for `HTTP 206 Partial Content` with `Accept-Ranges: bytes`.
  - Edge and browser caching headers (`Cache-Control: private, max-age=86400, stale-while-revalidate=43200`) enabling instant seeking forwards/backwards in browser players without re-requesting streams from Google Drive.
- **Static Assets Immutable Caching**: Vite bundle outputs hashed in `/assets/*` cached permanently with `Cache-Control: public, max-age=31536000, immutable`.
- **Backend Query Optimization**: Mongoose `.lean()` hydration-free queries on all high-throughput endpoints.

### 7. File & Folder Management
- **Hierarchical Folders**: Create, rename, delete folders with full breadcrumb navigation.
- **File Actions**: Rename, download, move between folders, toggle favorites.
- **30-Day Recycle Bin**: Soft deletion to Recycle Bin with one-click restore or permanent Google Drive purging.
- **Live WebSocket Events**: Real-time sync notifications via Socket.IO across all active client sessions.

---

## 🛠️ System Architecture & Deployment Stack

| Layer | Technology | Hosting / Environment |
|---|---|---|
| **Edge Gateway** | Cloudflare Workers (TypeScript) | Cloudflare Edge Network (330+ locations) |
| **Web Frontend** | React 18, Vite 6, TailwindCSS, Lucide | Cloudflare Workers Static Assets |
| **Backend API** | Node.js, Express, TypeScript, Passport.js | Render Web Service |
| **Mobile App** | Kotlin, Jetpack Compose, WorkManager, OkHttp | Android 8.0+ (API 26+) |
| **Database** | MongoDB Atlas / MongoDB 7.0 | Managed Cloud / Docker Compose |
| **Object Storage** | Google Drive API v3 (`drive.file` scope) | Pooled Google Accounts |

---

## 💻 Installation & Local Setup

### Prerequisites
- Node.js 20+ and npm
- Docker & Docker Compose (optional, for local MongoDB)
- Android Studio (optional, for Android APK builds)
- Google Cloud Console Project with OAuth 2.0 Client ID

### Step 1: Start Database (Docker Compose)
```bash
docker compose up -d
```
Starts MongoDB on `localhost:27017` and Redis on `localhost:6379`.

### Step 2: Start Backend Server
```bash
cd backend
cp .env.example .env
npm install
npm run dev
```
Backend API will start at `http://localhost:5000`.

### Step 3: Start Web Frontend
```bash
cd web
cp .env.example .env
npm install
npm run dev
```
Web dashboard will start at `http://localhost:5173`.

---

## 📱 Android App Compilation & Installation

The Android project is located in `mobile-android/`.

### 1. Build Release APK (Optimized & Shrunk with R8)
```bash
cd mobile-android
JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleRelease
```
The compiled, optimized release APK is located at:
```
mobile-android/app/build/outputs/apk/release/app-release.apk
```

### 2. Install on Device via ADB
```bash
adb install -r app/build/outputs/apk/release/app-release.apk
```

---

## 🌐 Production Deployment Guide

### Render (Backend)
1. Fork or push this repository to GitHub.
2. In Render, create a new **Web Service** pointing to the repository.
3. Configure the build and start commands:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
4. Set the environment variables listed in the section below.

### Cloudflare Workers (Frontend & Edge Cache)
1. **Frontend SPA**:
   ```bash
   cd web
   npm install && npm run build
   npx wrangler deploy
   ```
2. **Edge Cache Gateway**:
   ```bash
   npx wrangler deploy
   ```

---

## 🔑 Environment Variables Guide

### Backend (`backend/.env`)

| Variable | Description | Example |
|---|---|---|
| `PORT` | Server HTTP port | `5000` |
| `MONGODB_URI` | MongoDB connection string | `mongodb+srv://user:pass@cluster.mongodb.net/mydrive` |
| `JWT_SECRET` | Secret key for signing app JWT tokens | `your-random-jwt-secret-32-chars` |
| `SESSION_SECRET` | Secret key for Express session cookies | `your-random-session-secret` |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting refresh tokens at rest | `64_char_hex_string` |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `xxxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret | `GOCSPX-xxxx` |
| `GOOGLE_CALLBACK_URL` | App login OAuth callback URL | `https://api.yourdomain.com/api/v1/auth/google/callback` |
| `GDRIVE_CALLBACK_URL` | Storage linking OAuth callback URL | `https://api.yourdomain.com/api/v1/storage/google/callback` |
| `FRONTEND_URL` | Primary web dashboard URL | `https://mydrive-frontend.workers.dev` |

### Web Frontend (`web/.env.production`)

| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | Backend API or Edge Gateway base URL | `https://drive-edge-cache.workers.dev/api/v1` |

---

## 🔒 Security & Architecture Separation

1. **Strict Identity & Storage Separation**:
   - **App Login**: Requests only `openid`, `profile`, `email`.
   - **Storage Account Linking**: Requests only `https://www.googleapis.com/auth/drive.file`.
   - Revoking or disconnecting a Google Drive storage account never affects user login sessions.
2. **Envelope Encryption for OAuth Tokens**:
   - Google Drive refresh tokens are encrypted at rest in MongoDB using AES-256-GCM.
3. **Permanent Token Validity**:
   - Publishing Google Cloud OAuth to "In Production" prevents token expiration after 7 days.
4. **Dynamic Origin Redirects**:
   - OAuth flows embed client origins securely in the `state` parameter, redirecting seamlessly between custom domains, Cloudflare Workers, and mobile environments without redirect URI mismatches.

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
