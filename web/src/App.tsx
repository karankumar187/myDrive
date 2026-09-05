import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  HardDrive,
  Folder,
  Image as ImageIcon,
  Smartphone,
  Trash2,
  Shield,
  ShieldCheck,
  RefreshCw,
  Plus,
  LogOut,
  Search,
  Bell,
} from 'lucide-react';
import { api, subscribeToProgress, GlobalProgressState } from './services/api.js';
import { getSocket, disconnectSocket } from './services/socket.js';
import { StorageSummary, FileItem, FolderItem, DeviceItem, User, BreadcrumbItem } from './types.js';
import { StorageSummaryView } from './components/StorageSummaryView.js';
import { FolderExplorerView } from './components/FolderExplorerView.js';
import { GalleryTimelineView } from './components/GalleryTimelineView.js';
import { DeviceManagerView } from './components/DeviceManagerView.js';
import { TrashBinView } from './components/TrashBinView.js';
import { IPhoneShortcutModal } from './components/IPhoneShortcutModal.js';
import { UploadDrawer } from './components/UploadDrawer.js';
import { uploadService } from './services/UploadService.js';
import { VaultModal } from './components/VaultModal.js';
import { VaultCryptoService } from './services/vault-crypto.js';

type Tab = 'dashboard' | 'folders' | 'gallery' | 'devices' | 'trash';

const TABS: Array<{ id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Dashboard', icon: HardDrive },
  { id: 'folders', label: 'Files', icon: Folder },
  { id: 'gallery', label: 'Gallery', icon: ImageIcon },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

export const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [summary, setSummary] = useState<StorageSummary | null>(() => {
    try {
      const saved = localStorage.getItem('drive_cache_summary');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [files, setFiles] = useState<FileItem[]>(() => {
    try {
      const saved = localStorage.getItem('drive_cache_files_root');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [recentFiles, setRecentFiles] = useState<FileItem[]>(() => {
    try {
      const saved = localStorage.getItem('drive_cache_recent');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [folders, setFolders] = useState<FolderItem[]>(() => {
    try {
      const saved = localStorage.getItem('drive_cache_folders_root');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const currentFolderIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentFolderIdRef.current = currentFolderId;
  }, [currentFolderId]);

  const [currentFolder, setCurrentFolder] = useState<FolderItem | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([{ id: null, name: 'My Drive' }]);
  const [media, setMedia] = useState<FileItem[]>(() => {
    try {
      const saved = localStorage.getItem('drive_cache_gallery');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [trashedFiles, setTrashedFiles] = useState<FileItem[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [globalProgress, setGlobalProgress] = useState<GlobalProgressState>({
    progress: 0,
    isVisible: false,
    isFading: false,
    isLoading: false,
    colorType: 'default',
  });

  useEffect(() => {
    return subscribeToProgress(setGlobalProgress);
  }, []);

  // Zero-Knowledge Vault state
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  const [isVaultModalOpen, setIsVaultModalOpen] = useState(false);
  const [isIPhoneModalOpen, setIsIPhoneModalOpen] = useState(false);
  const [isSocketConnected, setIsSocketConnected] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [logModalDevice, setLogModalDevice] = useState<DeviceItem | null>(null);

  // Initial authentication check & OAuth callback handling
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const authError = urlParams.get('error');
    if (authError) {
      alert(`Authentication notification: ${authError}`);
      window.history.replaceState({}, document.title, window.location.origin + '/');
    }

    const tokenFromUrl = urlParams.get('token');
    if (tokenFromUrl) {
      localStorage.setItem('drive_token', tokenFromUrl);
      window.history.replaceState({}, document.title, window.location.origin + '/');
    }

    const token = localStorage.getItem('drive_token');
    if (token) {
      api
        .getCurrentUser()
        .then((res) => {
          setCurrentUser(res.user);
        })
        .catch((err) => {
          console.error('Failed to get current user:', err);
          // Only clear token if server explicitly says 401 Unauthorized
          if (err.message && err.message.includes('401')) {
            localStorage.removeItem('drive_token');
          }
        })
        .finally(() => {
          setIsCheckingAuth(false);
        });
    } else {
      setIsCheckingAuth(false);
    }

    // Restore Vault key from session if previously unlocked
    VaultCryptoService.restoreKeyFromSession().then((key) => {
      if (key) setVaultKey(key);
    });
  }, []);

  // Socket.io Real-time connection
  useEffect(() => {
    if (!currentUser) return;

    const socket = getSocket();

    socket.on('connect', () => {
      setIsSocketConnected(true);
    });

    socket.on('disconnect', () => {
      setIsSocketConnected(false);
    });

    socket.on('file:uploaded', () => {
      loadDashboardData();
    });

    socket.on('device:sync_status', (data: any) => {
      setDevices((prevDevices) =>
        prevDevices.map((d) => {
          if (d.deviceId === data.deviceId) {
            return {
              ...d,
              status: data.status || d.status,
              currentSyncActivity: data.currentSyncActivity !== undefined ? data.currentSyncActivity : d.currentSyncActivity,
              syncLogs: data.syncLogs || d.syncLogs,
              lastSeenAt: new Date().toISOString(),
            };
          }
          return d;
        })
      );
    });

    return () => {
      disconnectSocket();
    };
  }, [currentUser]);

  // Periodic device status poll to keep live sync status up to date
  useEffect(() => {
    if (!currentUser) return;
    const interval = setInterval(() => {
      api.listDevices().then((res) => {
        if (res.devices) setDevices(res.devices);
      }).catch(() => {});
    }, 10000);
    return () => clearInterval(interval);
  }, [currentUser]);

  // Local memory cache for instant (0ms) folder navigation
  const folderCache = useRef<Map<string, {
    files: FileItem[];
    recentFiles: FileItem[];
    folders: FolderItem[];
    breadcrumbs: BreadcrumbItem[];
    currentFolder: FolderItem | null;
  }>>(new Map());

  // Fast folder loader with instant cache hit
  const loadFolderData = useCallback(async (folderId: string | null) => {
    if (!currentUser) return;
    const cacheKey = folderId || 'root';

    // 1. Instant memory cache hit (0ms delay)
    if (folderCache.current.has(cacheKey)) {
      const cached = folderCache.current.get(cacheKey)!;
      setFiles(cached.files);
      setRecentFiles(cached.recentFiles);
      setFolders(cached.folders);
      setBreadcrumbs(cached.breadcrumbs);
      setCurrentFolder(cached.currentFolder);
    } else {
      // Check localStorage for offline/fast load
      try {
        const localFiles = localStorage.getItem(`drive_cache_files_${cacheKey}`);
        const localFolders = localStorage.getItem(`drive_cache_folders_${cacheKey}`);
        if (localFiles && localFolders) {
          setFiles(JSON.parse(localFiles));
          setFolders(JSON.parse(localFolders));
        }
      } catch {
        // ignore
      }
    }

    // 2. Fast background revalidation: only query files and folders for this folder
    try {
      const [filesRes, foldersRes] = await Promise.all([
        api.listFiles(folderId).catch(() => ({ files: [], recentFiles: [] })),
        api.listFolders(folderId).catch(() => ({ folders: [], currentFolder: null, breadcrumbs: [] })),
      ]);

      setFiles(filesRes.files);
      setRecentFiles(filesRes.recentFiles || []);
      setFolders(foldersRes.folders);
      if (foldersRes.breadcrumbs) setBreadcrumbs(foldersRes.breadcrumbs);
      setCurrentFolder(foldersRes.currentFolder || null);

      // Update in-memory cache
      folderCache.current.set(cacheKey, {
        files: filesRes.files,
        recentFiles: filesRes.recentFiles || [],
        folders: foldersRes.folders,
        breadcrumbs: foldersRes.breadcrumbs || [{ id: null, name: 'My Drive' }],
        currentFolder: foldersRes.currentFolder || null,
      });

      // Update localStorage cache
      try {
        localStorage.setItem(`drive_cache_files_${cacheKey}`, JSON.stringify(filesRes.files));
        localStorage.setItem(`drive_cache_folders_${cacheKey}`, JSON.stringify(foldersRes.folders));
        if (cacheKey === 'root') {
          localStorage.setItem('drive_cache_recent', JSON.stringify(filesRes.recentFiles || []));
        }
      } catch {
        // ignore quota exceeded
      }
    } catch (err) {
      console.error('Error loading folder:', err);
    }
  }, [currentUser]);

  // Load full dashboard data (storage summary, devices, gallery, trash)
  const loadDashboardData = async () => {
    if (!currentUser) return;
    try {
      setIsRefreshing(true);
      // Invalidate folder cache on explicit refresh so changes show
      folderCache.current.clear();

      const [storageRes, galleryRes, devicesRes, trashRes] = await Promise.all([
        api.getStorageSummary().catch(() => null),
        api.getGallery().catch(() => ({ media: [] })),
        api.listDevices().catch(() => ({ devices: [] })),
        api.listFiles(null, undefined, true).catch(() => ({ files: [], recentFiles: [] })),
      ]);

      if (storageRes) {
        setSummary(storageRes);
        try { localStorage.setItem('drive_cache_summary', JSON.stringify(storageRes)); } catch {}
      }
      setMedia(galleryRes.media);
      try { localStorage.setItem('drive_cache_gallery', JSON.stringify(galleryRes.media)); } catch {}
      setDevices(devicesRes.devices);
      setTrashedFiles(trashRes.files);

      // Load folder contents for currently selected folder (never throws out to root!)
      await loadFolderData(currentFolderIdRef.current);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // When background upload succeeds, refresh the current active folder
  useEffect(() => {
    uploadService.setOnUploadSuccess(() => {
      loadFolderData(currentFolderIdRef.current);
      api.getStorageSummary().then(setSummary).catch(() => {});
    });
  }, [loadFolderData]);

  // Full reload on initial login
  useEffect(() => {
    if (currentUser) {
      loadDashboardData();
    }
  }, [currentUser]);

  // Fast navigation when currentFolderId changes (0ms cache + fast revalidation)
  useEffect(() => {
    if (currentUser) {
      loadFolderData(currentFolderId);
    }
  }, [currentUser, currentFolderId, loadFolderData]);

  const handleGoogleLogin = () => {
    const apiBase = import.meta.env.VITE_API_URL || '';
    window.location.href = `${apiBase}/api/v1/auth/google`;
  };

  const handleConnectDrive = async () => {
    try {
      const { url } = await api.getConnectUrl();
      window.location.href = url;
    } catch (err: any) {
      alert(err.message || 'Failed to start Google Drive authorization');
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-[#08080a] text-white flex flex-col items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-purple-600/15 rounded-full blur-[140px] pointer-events-none" />
        <div className="relative z-10 flex flex-col items-center space-y-4">
          <img src="/logo.png" alt="myDrive" className="w-16 h-16 rounded-2xl object-cover shadow-glow-purple border border-purple-500/30 animate-pulse" />
          <div className="flex items-center space-x-2 text-zinc-400 text-sm font-medium">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-ping" />
            <span>Connecting to myDrive...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="min-h-screen bg-[#08080a] text-white flex items-center justify-center p-4 relative overflow-hidden">
        {/* Background purple glow */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-purple-600/15 rounded-full blur-[140px] pointer-events-none" />

        <div className="bg-[#111114] border border-[#222227] rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6 text-center relative z-10">
          {/* Minimal myDrive Logo */}
          <div className="relative w-16 h-16 mx-auto flex items-center justify-center">
            <img src="/logo.png" alt="myDrive" className="w-16 h-16 rounded-2xl object-cover shadow-lg border border-white/10" />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-center space-x-1.5">
              <h1 className="text-2xl font-black tracking-tight text-white">
                my<span className="text-purple-400">Drive</span>
              </h1>
              <span className="w-2 h-2 rounded-full bg-purple-500 shadow-glow-purple" />
            </div>
            <p className="text-xs text-zinc-400">
              Personal multi-account cloud storage pooling & zero-knowledge backup.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={handleGoogleLogin}
              className="w-full py-3 px-4 bg-white hover:bg-zinc-100 text-zinc-950 font-semibold rounded-2xl text-xs shadow-md flex items-center justify-center space-x-2.5 transition active:scale-[0.99]"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>
          </div>

          <div className="pt-2 text-[11px] text-zinc-500 border-t border-[#1e1e24]">
            App login is decoupled from Drive storage accounts.
          </div>
        </div>
      </div>
    );
  }

  const firstName = currentUser.name.split(' ')[0] || 'there';

  return (
    <div className="min-h-screen bg-[#08080a] text-zinc-100 flex flex-col relative selection:bg-purple-600 selection:text-white pb-24 md:pb-8">
      {/* Subtle top ambient purple glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[300px] bg-purple-600/10 rounded-full blur-[160px] pointer-events-none" />

      {/* TOP FLOATING NAVBAR */}
      <header className="sticky top-0 z-40 w-full backdrop-blur-xl bg-[#08080a]/75 border-b border-[#1c1c22] relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Left Brand Logo */}
          <div className="flex items-center space-x-2.5">
            <img src="/logo.png" alt="myDrive" className="w-8 h-8 rounded-lg object-cover border border-white/10" />
            <div className="flex items-center space-x-1">
              <span className="font-extrabold text-base tracking-tight text-white">
                my<span className="text-purple-400">Drive</span>
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500 shadow-glow-purple ml-0.5" />
            </div>
          </div>

          {/* Center Pill Navbar (Desktop) */}
          <nav className="hidden md:flex items-center bg-[#131317]/90 border border-[#222229] p-1 rounded-full shadow-lg">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition flex items-center space-x-1 ${
                  activeTab === id ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                <span>{label}</span>
                {id === 'trash' && trashedFiles.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 bg-purple-500 text-white rounded-full text-[10px]">
                    {trashedFiles.length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Right Action Controls */}
          <div className="flex items-center space-x-3">
            {/* Live Syncing Device Indicator Badge */}
            {(() => {
              const syncingDev = devices.find((d) => d.status === 'syncing');
              if (!syncingDev) return null;
              return (
                <button
                  onClick={() => {
                    setLogModalDevice(syncingDev);
                    setActiveTab('devices');
                  }}
                  className="flex items-center space-x-2 px-3 py-1 bg-purple-950/70 hover:bg-purple-900/80 border border-purple-500/60 text-purple-300 rounded-full text-xs font-semibold shadow-glow-purple transition animate-pulse"
                  title={`Device syncing live: ${syncingDev.deviceName}`}
                >
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
                  <span className="max-w-[130px] sm:max-w-[190px] truncate">
                    {syncingDev.deviceName}: {syncingDev.currentSyncActivity || 'Syncing...'}
                  </span>
                </button>
              );
            })()}

            {/* Profile Avatar with Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                className="w-8 h-8 rounded-full overflow-hidden bg-gradient-to-tr from-purple-700 to-violet-500 flex items-center justify-center text-white font-bold text-xs shadow-glow-purple ring-2 ring-[#222229] hover:ring-purple-500 transition"
              >
                {currentUser.avatarUrl ? (
                  <img src={currentUser.avatarUrl} alt={currentUser.name} className="w-full h-full object-cover" />
                ) : (
                  currentUser.name.charAt(0).toUpperCase()
                )}
              </button>

              {showProfileMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-[#121216] border border-[#222229] rounded-2xl p-2 shadow-2xl z-50 space-y-1">
                  <div className="px-3 py-2 border-b border-[#1c1c22]">
                    <p className="text-xs font-bold text-white truncate">{currentUser.name}</p>
                    <p className="text-[10px] text-zinc-400 truncate">{currentUser.email}</p>
                  </div>
                  <button
                    onClick={api.logout}
                    className="w-full flex items-center space-x-2 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 rounded-xl transition"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Single Running Progress Line under Navbar with Purpose-Specific Colors */}
        {globalProgress.isVisible && (
          <div
            className="absolute bottom-0 left-0 right-0 h-[3px] overflow-hidden bg-purple-950/20 z-50 pointer-events-none transition-opacity duration-300"
            style={{ opacity: globalProgress.isFading ? 0 : 1 }}
          >
            <div
              className={`h-full single-progress-bar progress-${globalProgress.colorType || 'default'}`}
              style={{
                width: `${globalProgress.progress}%`,
              }}
            />
          </div>
        )}
      </header>

      {/* HERO HEADER SECTION (Only displayed on Dashboard) */}
      {activeTab === 'dashboard' && (
        <section className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 pt-8 pb-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white flex items-baseline">
              <span>Welcome back, {firstName}</span>
              <span className="text-purple-400 ml-0.5">.</span>
            </h1>
            <p className="text-xs text-purple-300/80 font-medium mt-1 flex items-center space-x-1.5">
              <span>Unified personal cloud storage hub</span>
              <span className="text-zinc-600">•</span>
              <span className="text-purple-400 font-semibold">v1.0 E2EE</span>
            </p>
          </div>
        </section>
      )}

      {/* MAIN CONTENT VIEWS */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-4 flex-1">
        {activeTab === 'dashboard' && (
          <StorageSummaryView
            summary={summary}
            onRefresh={loadDashboardData}
          />
        )}

        {activeTab === 'folders' && (
          <FolderExplorerView
            files={files}
            recentFiles={recentFiles}
            folders={folders}
            currentFolderId={currentFolderId}
            currentFolder={currentFolder}
            breadcrumbs={breadcrumbs}
            onSelectFolder={(id) => setCurrentFolderId(id)}
            onRefresh={loadDashboardData}
            vaultKey={vaultKey}
            onOpenVault={() => setIsVaultModalOpen(true)}
          />
        )}

        {activeTab === 'gallery' && (
          <GalleryTimelineView
            media={media}
            vaultKey={vaultKey}
            onOpenVault={() => setIsVaultModalOpen(true)}
            onRefresh={loadDashboardData}
          />
        )}

        {activeTab === 'devices' && (
          <DeviceManagerView
            devices={devices}
            onRefresh={loadDashboardData}
            onOpenIPhoneModal={() => setIsIPhoneModalOpen(true)}
            selectedLogDevice={logModalDevice}
            onCloseLogModal={() => setLogModalDevice(null)}
          />
        )}

        {activeTab === 'trash' && (
          <TrashBinView
            trashedFiles={trashedFiles}
            onRefresh={loadDashboardData}
          />
        )}
      </main>

      {/* MOBILE / APP / SHORTCUT FLOATING BOTTOM NAVBAR */}
      <nav className="md:hidden fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#121217]/95 border border-[#272733] shadow-2xl backdrop-blur-xl rounded-full px-3 py-2 flex items-center space-x-2">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`p-2.5 rounded-full text-xs flex items-center justify-center transition ${
              activeTab === id ? 'bg-white text-zinc-950 shadow-md' : 'text-zinc-400 hover:text-white'
            }`}
            title={label}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </nav>

      {/* Modals */}
      <IPhoneShortcutModal
        isOpen={isIPhoneModalOpen}
        onClose={() => setIsIPhoneModalOpen(false)}
        onSuccess={() => {
          loadDashboardData();
        }}
      />

      <VaultModal
        isOpen={isVaultModalOpen}
        onClose={() => setIsVaultModalOpen(false)}
        onVaultUnlocked={(key) => setVaultKey(key)}
      />

      {/* Floating Background Upload Drawer */}
      <UploadDrawer />
    </div>
  );
};
