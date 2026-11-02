import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { FileItem, FolderItem, DeviceItem } from '../types.js';
import {
  Film,
  Calendar,
  Download,
  ShieldCheck,
  Lock,
  X,
  Loader2,
  Image as ImageIcon,
  Play,
  Heart,
  Search,
  CheckSquare,
  Square,
  Trash2,
  FolderInput,
  Edit2,
  Share2,
  Info,
  MoreVertical,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Cloud,
  ChevronDown,
  Check,
  Smartphone,
  Send,
  Upload,
  Compass,
  Clock,
  FolderPlus,
} from 'lucide-react';
import { uploadService } from '../services/UploadService.js';
import { VaultCryptoService } from '../services/vault-crypto.js';
import { mediaCache, mediaQueue, isVideoFile, extractVideoThumbnailFromUrl } from '../services/media-cache.js';
import { getStreamUrl, getPreviewUrl, formatBytes, formatDate, formatDateTime } from '../utils/format.js';
import { api, startGlobalLoading, subscribeToProgress, GlobalProgressState } from '../services/api.js';
import { ModernVideoPlayer } from './ModernVideoPlayer.js';
import { FullScreenViewer, PhotoDetailsModal } from './FullScreenViewer.js';
import { AlbumsShowcaseView } from './albums/AlbumsShowcaseView.js';
import { AddToAlbumModal } from './albums/AddToAlbumModal.js';

interface Props {
  media: FileItem[];
  vaultKey: CryptoKey | null;
  onOpenVault?: () => void;
  onRefresh?: () => void;
  initialCursor?: string | null;
  initialHasMore?: boolean;
  gallerySubTab?: 'timeline' | 'albums';
  onSubTabChange?: (tab: 'timeline' | 'albums') => void;
}

interface LoadedMediaState {
  item: FileItem;
  displayUrl: string | null;
  isEncrypted: boolean;
  needsKey: boolean;
  error?: string | null;
}

const getLastCursor = (list: FileItem[]): string | null => {
  if (!list || list.length === 0) return null;
  const lastItem = list[list.length - 1];
  const payload = {
    takenAt: lastItem.metadata?.takenAt || null,
    createdAt: lastItem.createdAt,
    id: lastItem._id,
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

export const GalleryTimelineView: React.FC<Props> = ({
  media,
  vaultKey,
  onOpenVault,
  onRefresh,
  initialCursor,
  initialHasMore,
  gallerySubTab: externalSubTab,
  onSubTabChange,
}) => {
  // Gallery Sub-Navigation Mode: Timeline vs Albums
  const [internalSubTab, setInternalSubTab] = useState<'timeline' | 'albums'>('timeline');
  const gallerySubTab = externalSubTab ?? internalSubTab;
  const setGallerySubTab = onSubTabChange ?? setInternalSubTab;
  const [selectedAlbumMediaIds, setSelectedAlbumMediaIds] = useState<string[]>([]);
  const [isAddToAlbumOpen, setIsAddToAlbumOpen] = useState(false);
  const [albumSuccessToast, setAlbumSuccessToast] = useState<string | null>(null);

  // Filters & Search
  const [filterType, setFilterType] = useState<'all' | 'favorites' | 'videos' | 'photos'>('all');
  const [isFilterDropdownOpen, setIsFilterDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Device Filter State
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedDeviceFilters, setSelectedDeviceFilters] = useState<Set<string>>(new Set());
  const [isDeviceDropdownOpen, setIsDeviceDropdownOpen] = useState(false);

  // Force Download to Paired Device State
  const [isForceDownloadOpen, setIsForceDownloadOpen] = useState(false);
  const [forceDownloadTargetIds, setForceDownloadTargetIds] = useState<string[]>([]);
  const [selectedTargetDeviceId, setSelectedTargetDeviceId] = useState<string>('');
  const [isSendingForceDownload, setIsSendingForceDownload] = useState(false);
  const [forceDownloadStatusMsg, setForceDownloadStatusMsg] = useState<string | null>(null);

  // Selection Mode
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Viewer State
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);

  // Modals
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  // Local mutable media list to reflect instant favorite / rename / trash & infinite scroll
  const [localMediaList, setLocalMediaList] = useState<FileItem[]>(() => (media || []).filter((m: any) => !m.isMediaApi && !m.publicId));
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor ?? null);
  const [hasMore, setHasMore] = useState<boolean>(initialHasMore ?? true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const isFirstMountRef = useRef(true);

  useEffect(() => {
    setLocalMediaList(media);
    if (initialCursor !== undefined) setNextCursor(initialCursor);
    if (initialHasMore !== undefined) setHasMore(initialHasMore);
  }, [media, initialCursor, initialHasMore]);

  // Load more media on infinite scroll
  const loadMoreMedia = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const cursor = nextCursor || getLastCursor(localMediaList);
      if (!cursor) {
        setHasMore(false);
        return;
      }
      const res = await api.getGallery({
        limit: 'all',
        cursor,
        filter: filterType !== 'all' ? filterType : undefined,
        search: searchQuery.trim() || undefined,
      });

      if (res.media && res.media.length > 0) {
        setLocalMediaList((prev) => {
          const existingIds = new Set(prev.map((m) => m._id));
          const newItems = (res.media || []).filter((m: any) => !m.isMediaApi && !m.publicId && !existingIds.has(m._id));
          return [...prev, ...newItems];
        });
        setNextCursor(res.nextCursor || null);
        setHasMore(Boolean(res.hasMore));
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to load more gallery media:', err);
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, hasMore, nextCursor, localMediaList, filterType, searchQuery]);

  // Infinite scroll IntersectionObserver
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          loadMoreMedia();
        }
      },
      { rootMargin: '400px' }
    );

    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [loadMoreMedia, hasMore, isLoadingMore]);

  // Query server when filter or search changes
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    let cancelled = false;
    const fetchFiltered = async () => {
      try {
        setIsLoadingMore(true);
        const res = await api.getGallery({
          limit: 'all',
          filter: filterType !== 'all' ? filterType : undefined,
          search: searchQuery.trim() || undefined,
        });
        if (!cancelled) {
          setLocalMediaList((res.media || []).filter((m: any) => !m.isMediaApi && !m.publicId));
          setNextCursor(res.nextCursor || null);
          setHasMore(Boolean(res.hasMore));
        }
      } catch (err) {
        console.error('Error fetching filtered media:', err);
      } finally {
        if (!cancelled) setIsLoadingMore(false);
      }
    };

    if (filterType !== 'all' || searchQuery.trim()) {
      fetchFiltered();
    } else {
      setLocalMediaList((media || []).filter((m: any) => !m.isMediaApi && !m.publicId));
      setNextCursor(initialCursor ?? null);
      setHasMore(initialHasMore ?? true);
    }

    return () => {
      cancelled = true;
    };
  }, [filterType, searchQuery]);

  useEffect(() => {
    api.listDevices().then((res) => {
      const devList = res.devices || [];
      setDevices(devList);
      if (devList.length > 0) {
        setSelectedTargetDeviceId(devList[0].deviceId);
      }
    }).catch((err) => console.error('Failed to load devices for gallery filter:', err));
  }, []);

  // Filtered media based on filterType, selectedDeviceFilters, and searchQuery
  const filteredMedia = useMemo(() => {
    return localMediaList.filter((item) => {
      const isVideo = isVideoFile(item.mimeType) || isVideoFile(item.filename);
      const isPhoto = item.mimeType.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic|svg|bmp)$/i.test(item.filename);

      if (filterType === 'favorites' && !item.isFavorite) return false;
      if (filterType === 'videos' && !isVideo) return false;
      if (filterType === 'photos' && !isPhoto) return false;

      // Filter by uploaded devices (checkbox selection)
      if (selectedDeviceFilters.size > 0) {
        const itemDevId = item.sourceDeviceId || (item.sourceDeviceIds && item.sourceDeviceIds[0]) || 'web';
        const isWeb = !item.sourceDeviceIds || item.sourceDeviceIds.length === 0 || itemDevId === 'web' || (item.sourceDeviceName || '').toLowerCase().includes('web') || (item.sourceDeviceName || '').toLowerCase().includes('unified');
        const matches = selectedDeviceFilters.has(itemDevId) || (isWeb && selectedDeviceFilters.has('web'));
        if (!matches) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = item.filename.toLowerCase().includes(q);
        const matchDevice = (item.sourceDeviceName || '').toLowerCase().includes(q);
        if (!matchName && !matchDevice) return false;
      }
      return true;
    });
  }, [localMediaList, filterType, selectedDeviceFilters, searchQuery]);

  // Cached month-year formatter for blazing fast grouping
  const monthYearFormatter = useMemo(() => new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }), []);

  // Group media by Month & Year
  const groupedMedia = useMemo(() => {
    return filteredMedia.reduce((acc, item) => {
      const date = new Date(item.metadata?.takenAt || item.createdAt);
      const monthYear = monthYearFormatter.format(date);
      if (!acc[monthYear]) acc[monthYear] = [];
      acc[monthYear].push(item);
      return acc;
    }, {} as Record<string, FileItem[]>);
  }, [filteredMedia, monthYearFormatter]);

  // Precomputed ID -> Index map for instantaneous O(1) tile opening
  const mediaIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    filteredMedia.forEach((m, idx) => map.set(m._id, idx));
    return map;
  }, [filteredMedia]);

  // Selection helpers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setIsSelectionMode(true);
  }, []);

  const isSelectionModeRef = useRef(isSelectionMode);
  isSelectionModeRef.current = isSelectionMode;

  const handleTileClick = useCallback((id: string) => {
    if (isSelectionModeRef.current) {
      toggleSelect(id);
    } else {
      const idx = mediaIndexMap.get(id);
      if (idx !== undefined) setSelectedMediaIndex(idx);
    }
  }, [mediaIndexMap, toggleSelect]);

  const handleTileToggleSelect = useCallback((id: string) => {
    toggleSelect(id);
  }, [toggleSelect]);

  const selectAll = () => {
    setSelectedIds(new Set(filteredMedia.map((m) => m._id)));
    setIsSelectionMode(true);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  // Toggle Favorite
  const handleToggleFavorite = useCallback(async (item: FileItem) => {
    const nextVal = !item.isFavorite;
    setLocalMediaList((prev) =>
      prev.map((m) => (m._id === item._id ? { ...m, isFavorite: nextVal } : m))
    );
    try {
      await api.toggleFavorite(item._id, nextVal);
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      // rollback
      setLocalMediaList((prev) =>
        prev.map((m) => (m._id === item._id ? { ...m, isFavorite: !nextVal } : m))
      );
    }
  }, []);

  // Bulk Favorite
  const handleBulkFavorite = async (fav: boolean) => {
    const ids = Array.from(selectedIds);
    setLocalMediaList((prev) =>
      prev.map((m) => (selectedIds.has(m._id) ? { ...m, isFavorite: fav } : m))
    );
    try {
      await api.bulkAction(fav ? 'favorite' : 'unfavorite', ids);
      deselectAll();
    } catch (err) {
      console.error('Failed bulk favorite:', err);
      onRefresh?.();
    }
  };

  // Bulk Trash
  const handleBulkTrash = async () => {
    if (!confirm(`Move ${selectedIds.size} selected items to Trash?`)) return;
    const ids = Array.from(selectedIds);
    setLocalMediaList((prev) => prev.filter((m) => !selectedIds.has(m._id)));
    try {
      await api.bulkAction('trash', ids);
      deselectAll();
      onRefresh?.();
    } catch (err) {
      console.error('Failed bulk trash:', err);
      onRefresh?.();
    }
  };

  // Bulk Download
  const handleBulkDownload = () => {
    Array.from(selectedIds).forEach((id, idx) => {
      const item = localMediaList.find((m) => m._id === id);
      if (!item) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = getStreamUrl(item._id);
        a.download = item.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }, idx * 400);
    });
  };

  // Open Move dialog
  const handleOpenMove = async () => {
    try {
      const res = await api.listFolders();
      setFolders(res.folders || []);
      setSelectedFolderId(null);
      setIsMoveOpen(true);
    } catch (err) {
      console.error('Failed to list folders:', err);
    }
  };

  // Confirm Move (Optimistic)
  const handleConfirmMove = async () => {
    setIsMoving(true);
    const ids = isSelectionMode
      ? Array.from(selectedIds)
      : selectedMediaIndex !== null
      ? [filteredMedia[selectedMediaIndex]._id]
      : [];
    if (ids.length === 0) {
      setIsMoving(false);
      return;
    }
    const idSet = new Set(ids);
    const movedItems = localMediaList.filter((m) => idSet.has(m._id));

    // Optimistically update folderId in local media list
    setLocalMediaList((prev) =>
      prev.map((m) => (idSet.has(m._id) ? { ...m, folderId: selectedFolderId } : m))
    );
    setIsMoveOpen(false);
    deselectAll();

    try {
      if (ids.length === 1) {
        await api.moveFile(ids[0], selectedFolderId);
      } else {
        await api.bulkAction('move', ids, selectedFolderId);
      }
      onRefresh?.();
    } catch (err) {
      console.error('Failed to move:', err);
      // Rollback
      setLocalMediaList((prev) =>
        prev.map((m) => {
          const orig = movedItems.find((o) => o._id === m._id);
          return orig ? orig : m;
        })
      );
      alert('Failed to move files');
    } finally {
      setIsMoving(false);
    }
  };

  // Rename single file (Optimistic)
  const handleConfirmRename = async () => {
    if (selectedMediaIndex === null) return;
    const current = filteredMedia[selectedMediaIndex];
    if (!renameValue.trim()) return;
    const oldName = current.filename;
    const newName = renameValue.trim();

    // Optimistically update filename immediately
    setLocalMediaList((prev) =>
      prev.map((m) => (m._id === current._id ? { ...m, filename: newName } : m))
    );
    setIsRenameOpen(false);

    try {
      await api.renameFile(current._id, newName);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to rename:', err);
      // Rollback
      setLocalMediaList((prev) =>
        prev.map((m) => (m._id === current._id ? { ...m, filename: oldName } : m))
      );
      alert('Failed to rename file');
    }
  };

  // Single file delete in viewer (Optimistic)
  const handleDeleteCurrent = async () => {
    if (selectedMediaIndex === null) return;
    const current = filteredMedia[selectedMediaIndex];
    if (!confirm(`Move "${current.filename}" to Trash?`)) return;

    const deletedItem = current;
    const deletedIndex = selectedMediaIndex;

    // Optimistically remove from view immediately
    setLocalMediaList((prev) => prev.filter((m) => m._id !== current._id));
    if (selectedMediaIndex >= filteredMedia.length - 1) {
      setSelectedMediaIndex(filteredMedia.length > 1 ? filteredMedia.length - 2 : null);
    }

    try {
      await api.moveToTrash(deletedItem._id);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to delete:', err);
      // Rollback on failure
      setLocalMediaList((prev) => [...prev.slice(0, deletedIndex), deletedItem, ...prev.slice(deletedIndex)]);
      alert('Failed to delete file from cloud. Restored.');
    }
  };

  const currentMedia = selectedMediaIndex !== null ? filteredMedia[selectedMediaIndex] : null;

  return (
    <div className="space-y-3 sm:space-y-4 w-full max-w-full min-w-0 overflow-x-hidden">
      {/* Albums Sub-View */}
      {gallerySubTab === 'albums' ? (
        <AlbumsShowcaseView
          allMedia={localMediaList}
          vaultKey={vaultKey}
          initialSelectedMediaIds={selectedAlbumMediaIds}
        />
      ) : (
        <>
          {/* Minimal, Ultra-Low Height (36px) Single-Row Gallery Controls Bar */}
          <div className="flex items-center gap-1.5 sm:gap-2 w-full pt-1 pb-1">
            {/* Media Type Filter Dropdown */}
            <div className="relative shrink-0">
              <button
                onClick={() => {
                  setIsFilterDropdownOpen(!isFilterDropdownOpen);
                  setIsDeviceDropdownOpen(false);
                }}
                className="inline-flex items-center space-x-1.5 h-8 px-2.5 sm:px-3 rounded-full text-xs font-semibold bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 transition active:scale-95"
                title="Filter Media Type"
              >
                <span>
                  {filterType === 'all' && (
                    <>
                      <span className="hidden sm:inline">All Photos</span>
                      <span className="sm:hidden">All</span>
                    </>
                  )}
                  {filterType === 'favorites' && (
                    <>
                      <span className="hidden sm:inline">Favorites ❤️</span>
                      <span className="sm:hidden">❤️</span>
                    </>
                  )}
                  {filterType === 'videos' && (
                    <>
                      <span className="hidden sm:inline">Videos Only 🎥</span>
                      <span className="sm:hidden">Videos</span>
                    </>
                  )}
                  {filterType === 'photos' && (
                    <>
                      <span className="hidden sm:inline">Photos Only 📷</span>
                      <span className="sm:hidden">Photos</span>
                    </>
                  )}
                </span>
                <ChevronDown className="w-3 h-3 text-zinc-400" />
              </button>

              {isFilterDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setIsFilterDropdownOpen(false)}
                  />
                  <div
                    className="absolute left-0 mt-1.5 w-44 bg-[#14141a] border border-zinc-800 rounded-2xl shadow-2xl z-30 py-1.5 overflow-hidden animate-in fade-in"
                    onClick={() => setIsFilterDropdownOpen(false)}
                  >
                    <button
                      onClick={() => setFilterType('all')}
                      className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between hover:bg-purple-950/40 ${
                        filterType === 'all' ? 'text-purple-300 font-semibold bg-purple-950/30' : 'text-zinc-300'
                      }`}
                    >
                      <span>All Photos</span>
                      {filterType === 'all' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </button>
                    <button
                      onClick={() => setFilterType('favorites')}
                      className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between hover:bg-purple-950/40 ${
                        filterType === 'favorites' ? 'text-purple-300 font-semibold bg-purple-950/30' : 'text-zinc-300'
                      }`}
                    >
                      <span className="flex items-center">
                        <Heart className="w-3 h-3 text-red-400 mr-1.5 fill-red-400" /> Favorites
                      </span>
                      {filterType === 'favorites' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </button>
                    <button
                      onClick={() => setFilterType('videos')}
                      className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between hover:bg-purple-950/40 ${
                        filterType === 'videos' ? 'text-purple-300 font-semibold bg-purple-950/30' : 'text-zinc-300'
                      }`}
                    >
                      <span className="flex items-center">
                        <Film className="w-3 h-3 text-purple-400 mr-1.5" /> Videos Only
                      </span>
                      {filterType === 'videos' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </button>
                    <button
                      onClick={() => setFilterType('photos')}
                      className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between hover:bg-purple-950/40 ${
                        filterType === 'photos' ? 'text-purple-300 font-semibold bg-purple-950/30' : 'text-zinc-300'
                      }`}
                    >
                      <span className="flex items-center">
                        <ImageIcon className="w-3 h-3 text-blue-400 mr-1.5" /> Photos Only
                      </span>
                      {filterType === 'photos' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Device Filter Dropdown with Counter Badge */}
            <div className="relative shrink-0">
              <button
                onClick={() => {
                  setIsDeviceDropdownOpen(!isDeviceDropdownOpen);
                  setIsFilterDropdownOpen(false);
                }}
                className={`inline-flex items-center space-x-1 h-8 px-2 sm:px-2.5 rounded-full text-xs font-semibold border transition active:scale-95 ${
                  selectedDeviceFilters.size > 0
                    ? 'bg-purple-950/60 text-purple-300 border-purple-500/60 shadow-sm'
                    : 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-200 border-zinc-800'
                }`}
                title="Filter by Device"
              >
                <Smartphone className="w-3.5 h-3.5 text-purple-400" />
                <span className="hidden sm:inline">
                  {selectedDeviceFilters.size === 0
                    ? 'All Devices'
                    : `${selectedDeviceFilters.size} Device${selectedDeviceFilters.size > 1 ? 's' : ''}`}
                </span>
                {selectedDeviceFilters.size > 0 && (
                  <span className="sm:hidden text-[10px] font-bold text-purple-300">
                    {selectedDeviceFilters.size}
                  </span>
                )}
                <ChevronDown className="w-3 h-3 text-zinc-400" />
              </button>

              {isDeviceDropdownOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setIsDeviceDropdownOpen(false)}
                  />
                  <div
                    className="absolute left-0 mt-1.5 w-60 bg-[#14141a] border border-zinc-800 rounded-2xl shadow-2xl z-40 p-2 space-y-1 animate-in fade-in"
                  >
                    <div className="px-2 py-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between border-b border-zinc-800 pb-1.5 mb-1">
                      <span>Upload Source</span>
                      {selectedDeviceFilters.size > 0 && (
                        <button
                          onClick={() => setSelectedDeviceFilters(new Set())}
                          className="text-purple-400 hover:text-purple-300 normal-case font-semibold text-[10px]"
                        >
                          Reset
                        </button>
                      )}
                    </div>

                    {/* All Devices checkbox */}
                    <label className="flex items-center space-x-2.5 px-2.5 py-1.5 rounded-xl hover:bg-zinc-800/60 cursor-pointer text-xs text-white">
                      <input
                        type="checkbox"
                        checked={selectedDeviceFilters.size === 0}
                        onChange={() => setSelectedDeviceFilters(new Set())}
                        className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 bg-[#121218] border-zinc-700"
                      />
                      <span className="font-semibold">All Devices</span>
                    </label>

                    {/* Paired devices checkboxes */}
                    {devices.map((dev) => {
                      const isChecked = selectedDeviceFilters.has(dev.deviceId);
                      return (
                        <label
                          key={dev.deviceId}
                          className="flex items-center space-x-2.5 px-2.5 py-1.5 rounded-xl hover:bg-zinc-800/60 cursor-pointer text-xs text-zinc-200"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setSelectedDeviceFilters((prev) => {
                                const next = new Set(prev);
                                if (next.has(dev.deviceId)) next.delete(dev.deviceId);
                                else next.add(dev.deviceId);
                                return next;
                              });
                            }}
                            className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 bg-[#121218] border-zinc-700"
                          />
                          <span className="truncate flex-1 font-medium">{dev.deviceName}</span>
                          <span className="text-[10px] text-zinc-500 uppercase">{dev.deviceType}</span>
                        </label>
                      );
                    })}

                    {/* Web / Unified Drive checkbox */}
                    <label className="flex items-center space-x-2.5 px-2.5 py-1.5 rounded-xl hover:bg-zinc-800/60 cursor-pointer text-xs text-zinc-200">
                      <input
                        type="checkbox"
                        checked={selectedDeviceFilters.has('web')}
                        onChange={() => {
                          setSelectedDeviceFilters((prev) => {
                            const next = new Set(prev);
                            if (next.has('web')) next.delete('web');
                            else next.add('web');
                            return next;
                          });
                        }}
                        className="w-4 h-4 rounded text-purple-600 focus:ring-purple-500 bg-[#121218] border-zinc-700"
                      />
                      <span className="truncate flex-1 font-medium">Unified Drive (Web)</span>
                      <Cloud className="w-3.5 h-3.5 text-zinc-500" />
                    </label>
                  </div>
                </>
              )}
            </div>

            {/* Center: Live Search Bar */}
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-zinc-400 absolute left-2.5 sm:left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search gallery..."
                className="w-full h-8 pl-8 pr-7 bg-zinc-900/60 hover:bg-zinc-900 focus:bg-zinc-900 border border-zinc-800/80 focus:border-purple-500/80 rounded-full text-xs text-white placeholder-zinc-500 focus:outline-none transition shadow-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Right Actions: Upload & Select */}
            <div className="flex items-center space-x-1.5 shrink-0">
              {/* Direct Photo & Video Upload */}
              <label
                className="inline-flex items-center justify-center space-x-1.5 h-8 px-2.5 sm:px-3.5 rounded-full text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-md shadow-purple-900/20 cursor-pointer transition active:scale-95"
                title="Upload Photos or Videos"
              >
                <Upload className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Upload</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      const selected = Array.from(e.target.files);
                      e.target.value = '';
                      setTimeout(() => {
                        uploadService.enqueue(selected, null);
                      }, 50);
                    }
                  }}
                />
              </label>

              {/* Select Mode Toggle */}
              <button
                onClick={() => {
                  if (isSelectionMode) {
                    deselectAll();
                  } else {
                    setIsSelectionMode(true);
                  }
                }}
                className={`inline-flex items-center justify-center space-x-1.5 h-8 px-2.5 sm:px-3 rounded-full text-xs font-semibold transition active:scale-95 ${
                  isSelectionMode
                    ? 'bg-purple-600 text-white shadow-md'
                    : 'bg-zinc-900/80 hover:bg-zinc-800 text-zinc-300 border border-zinc-800/80'
                }`}
                title={isSelectionMode ? 'Cancel Selection' : 'Select Photos'}
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isSelectionMode ? 'Cancel' : 'Select'}</span>
              </button>
            </div>
          </div>

      {/* Floating Selection Action Bar — Anchored at bottom with rich actions */}
      {(selectedIds.size > 0 || isSelectionMode) && (
        <div className="fixed bottom-[max(4.5rem,calc(env(safe-area-inset-bottom,0px)+3.75rem))] sm:bottom-6 inset-x-0 mx-auto w-[94%] max-w-3xl z-50 bg-[#13131c]/95 backdrop-blur-2xl border border-purple-500/50 rounded-2xl px-4 py-3 shadow-2xl flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center space-x-3">
            <div className="bg-purple-600/20 border border-purple-500/40 px-2.5 py-1 rounded-lg">
              <span className="text-xs font-bold text-purple-300">
                {selectedIds.size} selected
              </span>
            </div>
            <button
              onClick={selectedIds.size === filteredMedia.length ? deselectAll : selectAll}
              className="text-xs text-purple-400 hover:text-purple-300 font-semibold transition"
            >
              {selectedIds.size === filteredMedia.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          <div className="flex items-center space-x-2 overflow-x-auto py-0.5">
            {/* Add to Album */}
            <button
              disabled={selectedIds.size === 0}
              onClick={() => setIsAddToAlbumOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold text-xs border border-purple-400/40 shadow-glow-purple disabled:opacity-40 transition flex items-center space-x-1.5 active:scale-95"
              title="Add selected items to an album"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>Add to Album</span>
            </button>

            {/* Force Download to Paired Device */}
            <button
              disabled={selectedIds.size === 0}
              onClick={() => {
                setForceDownloadTargetIds(Array.from(selectedIds));
                setIsForceDownloadOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs border border-purple-400/40 shadow-glow-purple disabled:opacity-40 transition flex items-center space-x-1.5 active:scale-95"
              title="Force Download to Paired Device"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Send to Device</span>
            </button>

            {/* Favorite */}
            <button
              disabled={selectedIds.size === 0}
              onClick={() => handleBulkFavorite(true)}
              className="px-2.5 py-1.5 rounded-xl bg-[#1e1e28] hover:bg-purple-950/60 text-zinc-300 hover:text-red-400 border border-[#2d2d3d] disabled:opacity-40 transition flex items-center space-x-1 text-xs active:scale-95"
              title="Favorite Selected"
            >
              <Heart className="w-3.5 h-3.5 text-red-400" />
              <span className="hidden md:inline">Favorite</span>
            </button>

            {/* Download */}
            <button
              disabled={selectedIds.size === 0}
              onClick={handleBulkDownload}
              className="px-2.5 py-1.5 rounded-xl bg-[#1e1e28] hover:bg-[#282836] text-zinc-300 hover:text-white border border-[#2d2d3d] disabled:opacity-40 transition flex items-center space-x-1 text-xs active:scale-95"
              title="Download to PC"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Download</span>
            </button>

            {/* Move to Folder */}
            <button
              disabled={selectedIds.size === 0}
              onClick={handleOpenMove}
              className="px-2.5 py-1.5 rounded-xl bg-[#1e1e28] hover:bg-[#282836] text-zinc-300 hover:text-white border border-[#2d2d3d] disabled:opacity-40 transition flex items-center space-x-1 text-xs active:scale-95"
              title="Move to Folder"
            >
              <FolderInput className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Move</span>
            </button>

            {/* Move to Trash */}
            <button
              disabled={selectedIds.size === 0}
              onClick={handleBulkTrash}
              className="px-2.5 py-1.5 rounded-xl bg-red-950/40 hover:bg-red-900/60 text-red-400 border border-red-800/40 disabled:opacity-40 transition flex items-center space-x-1 text-xs active:scale-95"
              title="Move to Trash"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Delete</span>
            </button>

            {/* Cancel Selection */}
            <button
              onClick={deselectAll}
              className="p-1.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 transition active:scale-95"
              title="Cancel Selection"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Gallery Grid */}
      {filteredMedia.length === 0 ? (
        <div className="bg-[#111114] rounded-2xl border border-[#222227] p-16 text-center space-y-2">
          <Calendar className="w-12 h-12 mx-auto text-zinc-700" />
          <p className="text-sm font-semibold text-zinc-200">No media found</p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            {searchQuery
              ? `No results matching "${searchQuery}".`
              : 'Photos and videos synced from paired devices or uploaded will appear here.'}
          </p>
        </div>
      ) : (
        Object.entries(groupedMedia).map(([groupTitle, items]) => (
          <div key={groupTitle} className="space-y-3">
            {/* Date Group Header — Solid background avoids mobile GPU compositor stalls */}
            <div className="sticky top-14 sm:top-16 bg-[#08080a] py-2 z-20 flex items-center justify-between border-b border-zinc-800/80 w-full min-w-0 max-w-full">
              <div className="flex items-center space-x-2">
                <Calendar className="w-3.5 h-3.5 text-purple-400" />
                <span className="text-xs font-bold text-zinc-200 tracking-wide uppercase">{groupTitle}</span>
                <span className="text-[11px] text-zinc-500">({items.length})</span>
              </div>

              {isSelectionMode && (
                <button
                  onClick={() => {
                    const allInGroupSelected = items.every((i) => selectedIds.has(i._id));
                    setSelectedIds((prev) => {
                      const next = new Set(prev);
                      items.forEach((i) => {
                        if (allInGroupSelected) next.delete(i._id);
                        else next.add(i._id);
                      });
                      return next;
                    });
                  }}
                  className="text-[11px] text-purple-400 hover:text-purple-300"
                >
                  {items.every((i) => selectedIds.has(i._id)) ? 'Deselect Month' : 'Select Month'}
                </button>
              )}
            </div>

            {/* Grid: 3 columns mobile (iOS Photos standard), 4–8 columns desktop */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-1.5 sm:gap-2.5 w-full min-w-0 max-w-full">
              {items.map((item) => (
                <GalleryGridTile
                  key={item._id}
                  item={item}
                  isSelected={selectedIds.has(item._id)}
                  isSelectionMode={isSelectionMode}
                  onToggleSelect={handleTileToggleSelect}
                  onToggleFavorite={handleToggleFavorite}
                  onClick={handleTileClick}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Loading Indicator & Infinite Scroll Sentinel */}
      {isLoadingMore && (
        <div className="flex items-center justify-center py-6 space-x-2 text-zinc-400">
          <Loader2 className="w-5 h-5 text-purple-500 animate-spin" />
          <span className="text-xs font-medium">Loading more media...</span>
        </div>
      )}
      {hasMore && <div ref={sentinelRef} className="h-6 w-full" />}
      </>
      )}

      {/* Full-Screen Photo Viewer */}
      {selectedMediaIndex !== null && currentMedia && (
        <FullScreenViewer
          mediaList={filteredMedia}
          currentIndex={selectedMediaIndex}
          vaultKey={vaultKey}
          onIndexChange={(newIdx) => setSelectedMediaIndex(newIdx)}
          onClose={() => setSelectedMediaIndex(null)}
          onToggleFavorite={() => handleToggleFavorite(currentMedia)}
          onDelete={handleDeleteCurrent}
          onOpenDetails={() => setIsDetailsOpen(true)}
          onOpenRename={() => {
            setRenameValue(currentMedia.filename);
            setIsRenameOpen(true);
          }}
          onOpenMove={handleOpenMove}
          onOpenForceDownload={() => {
            setForceDownloadTargetIds([currentMedia._id]);
            setIsForceDownloadOpen(true);
          }}
          onLoadMore={loadMoreMedia}
        />
      )}

      {/* Photo Details Modal */}
      {isDetailsOpen && currentMedia && (
        <PhotoDetailsModal
          item={currentMedia}
          onClose={() => setIsDetailsOpen(false)}
        />
      )}

      {/* Rename Dialog */}
      {isRenameOpen && currentMedia && createPortal(
        <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#16161e] border border-[#2d2d3d] rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-white">Rename File</h3>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              className="w-full px-3.5 py-2 bg-[#101016] border border-[#282838] focus:border-purple-500 rounded-xl text-xs text-white focus:outline-none"
              autoFocus
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setIsRenameOpen(false)}
                className="px-3.5 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRename}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg shadow-glow-purple transition"
              >
                Save
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Move to Folder Dialog */}
      {isMoveOpen && createPortal(
        <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#16161e] border border-[#2d2d3d] rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <h3 className="text-sm font-bold text-white">Move to Folder</h3>
            <p className="text-xs text-zinc-400">Choose a destination folder in your unified cloud drive:</p>

            <div className="max-h-60 overflow-y-auto space-y-1.5 pr-1">
              <button
                onClick={() => setSelectedFolderId(null)}
                className={`w-full p-2.5 rounded-xl text-left text-xs flex items-center justify-between transition ${
                  selectedFolderId === null
                    ? 'bg-purple-950/50 border border-purple-600/60 text-purple-300 font-semibold'
                    : 'bg-[#101016] border border-[#222230] text-zinc-300 hover:bg-[#191924]'
                }`}
              >
                <span>Root / All Files</span>
                {selectedFolderId === null && <Check className="w-3.5 h-3.5 text-purple-400" />}
              </button>

              {folders.map((folder) => (
                <button
                  key={folder._id}
                  onClick={() => setSelectedFolderId(folder._id)}
                  className={`w-full p-2.5 rounded-xl text-left text-xs flex items-center justify-between transition ${
                    selectedFolderId === folder._id
                      ? 'bg-purple-950/50 border border-purple-600/60 text-purple-300 font-semibold'
                      : 'bg-[#101016] border border-[#222230] text-zinc-300 hover:bg-[#191924]'
                  }`}
                >
                  <span className="truncate">{folder.name}</span>
                  {selectedFolderId === folder._id && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </button>
              ))}
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setIsMoveOpen(false)}
                className="px-3.5 py-1.5 text-xs text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <button
                disabled={isMoving}
                onClick={handleConfirmMove}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-lg shadow-glow-purple disabled:opacity-50 transition"
              >
                {isMoving ? 'Moving...' : 'Move Here'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Force Download to Paired Device Modal */}
      {isForceDownloadOpen && createPortal(
        <div className="fixed inset-0 bg-black/85 z-[110] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#15151e] border border-purple-500/50 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="p-2.5 rounded-2xl bg-purple-600/20 border border-purple-500/40 text-purple-400 shadow-glow-purple">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Force Download to Device</h3>
                  <p className="text-xs text-zinc-400">
                    Push {forceDownloadTargetIds.length} item(s) to automatically save locally
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsForceDownloadOpen(false);
                  setForceDownloadStatusMsg(null);
                }}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {devices.length === 0 ? (
              <div className="p-5 rounded-2xl bg-[#101016] border border-[#242434] text-center space-y-2">
                <p className="text-xs text-zinc-200 font-semibold">No paired devices found</p>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Pair an Android phone, iPhone, or Mac in Device Manager to force download files directly to it.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                <p className="text-xs font-semibold text-zinc-300">Choose destination device:</p>
                {devices.map((dev) => {
                  const isSelected = selectedTargetDeviceId === dev.deviceId;
                  return (
                    <div
                      key={dev.deviceId}
                      onClick={() => setSelectedTargetDeviceId(dev.deviceId)}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-center justify-between ${
                        isSelected
                          ? 'bg-purple-950/50 border-purple-500 text-white shadow-glow-purple'
                          : 'bg-[#101016] border-[#222230] text-zinc-300 hover:bg-[#181822]'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <Smartphone className={`w-5 h-5 ${isSelected ? 'text-purple-400' : 'text-zinc-500'}`} />
                        <div>
                          <p className="text-xs font-bold text-white">{dev.deviceName}</p>
                          <p className="text-[10px] text-zinc-400 uppercase tracking-wider">
                            {dev.deviceType} • {dev.status === 'online' ? '🟢 Online' : '⚪ Standby'}
                          </p>
                        </div>
                      </div>
                      <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                        isSelected ? 'border-purple-500 bg-purple-600' : 'border-zinc-600'
                      }`}>
                        {isSelected && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {forceDownloadStatusMsg && (
              <p className="text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 p-2.5 rounded-xl font-medium">
                {forceDownloadStatusMsg}
              </p>
            )}

            <div className="flex justify-end space-x-2 pt-2 border-t border-[#252535]">
              <button
                onClick={() => {
                  setIsForceDownloadOpen(false);
                  setForceDownloadStatusMsg(null);
                }}
                className="px-4 py-2 text-xs text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition"
              >
                Cancel
              </button>
              <button
                disabled={!selectedTargetDeviceId || devices.length === 0 || isSendingForceDownload}
                onClick={async () => {
                  setIsSendingForceDownload(true);
                  try {
                    const targetDev = devices.find((d) => d.deviceId === selectedTargetDeviceId);
                    await api.forceDownloadToDevice(selectedTargetDeviceId, forceDownloadTargetIds);
                    setForceDownloadStatusMsg(`✓ Queued force download of ${forceDownloadTargetIds.length} item(s) to ${targetDev?.deviceName || 'device'}!`);
                    setTimeout(() => {
                      setIsForceDownloadOpen(false);
                      setForceDownloadStatusMsg(null);
                      deselectAll();
                    }, 1400);
                  } catch (err: any) {
                    alert(err.message || 'Failed to dispatch force download');
                  } finally {
                    setIsSendingForceDownload(false);
                  }
                }}
                className="px-5 py-2 text-xs font-bold text-white bg-purple-600 hover:bg-purple-500 rounded-xl shadow-glow-purple disabled:opacity-40 transition flex items-center space-x-1.5 active:scale-95"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSendingForceDownload ? 'Dispatching...' : 'Send & Force Download'}</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add to Album Modal */}
      <AddToAlbumModal
        isOpen={isAddToAlbumOpen}
        onClose={() => setIsAddToAlbumOpen(false)}
        selectedFileIds={Array.from(selectedIds)}
        onSuccess={(albumTitle) => {
          const count = selectedIds.size;
          deselectAll();
          setAlbumSuccessToast(`Added ${count} items to "${albumTitle}"`);
          setTimeout(() => setAlbumSuccessToast(null), 3000);
        }}
        onCreateNewAlbum={() => {
          setSelectedAlbumMediaIds(Array.from(selectedIds));
          setGallerySubTab('albums');
        }}
      />

      {/* Floating Success Toast */}
      {albumSuccessToast && (
        <div className="fixed top-6 right-6 z-[130] px-4 py-2.5 rounded-2xl bg-neutral-900 border border-purple-500/50 shadow-2xl text-xs font-semibold text-purple-300 flex items-center gap-2 animate-fadeIn">
          <Check className="w-4 h-4 text-purple-400" />
          <span>{albumSuccessToast}</span>
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------
// Grid Tile Component — Blazing fast 120fps virtualized rendering with content-visibility
// ----------------------------------------------------
const GalleryGridTile: React.FC<{
  item: FileItem;
  isSelected: boolean;
  isSelectionMode: boolean;
  onToggleSelect: (id: string) => void;
  onToggleFavorite: (item: FileItem) => void;
  onClick: (id: string) => void;
}> = React.memo(({ item, isSelected, isSelectionMode, onToggleSelect, onClick }) => {
  const isVideo = isVideoFile(item.mimeType) || isVideoFile(item.filename);
  const [loadError, setLoadError] = useState(false);
  const [streamFallback, setStreamFallback] = useState<string | null>(null);
  const [extractedThumb, setExtractedThumb] = useState<string | null>(null);

  const hasRealThumb = Boolean(
    (item.metadata?.thumbnail &&
      item.metadata.thumbnail.startsWith('data:image/') &&
      item.metadata.thumbnail.length > 500) ||
      mediaCache.getThumbnail(item._id)
  );

  // Synchronously compute thumbnail without extra render cycles
  const thumbUrl = useMemo(() => {
    if (item.metadata?.thumbnail && item.metadata.thumbnail.startsWith('data:image/')) {
      return item.metadata.thumbnail;
    }
    return mediaCache.getThumbnail(item._id) || mediaCache.get(item._id) || api.getThumbnailUrl(item._id);
  }, [item._id, item.metadata?.thumbnail]);

  // If a video has no real thumbnail stored, automatically extract it in the background queue
  useEffect(() => {
    if (!isVideo || hasRealThumb || extractedThumb) return;

    let active = true;
    mediaQueue.enqueue(async () => {
      if (!active) return;
      if (mediaCache.getThumbnail(item._id)) return;
      try {
        const streamUrl = getStreamUrl(item._id);
        const captured = await extractVideoThumbnailFromUrl(streamUrl);
        if (captured && active) {
          mediaCache.saveThumbnail(item._id, captured);
          setExtractedThumb(captured);
          // Persist to backend database asynchronously so it's permanently stored for all devices!
          api.updateThumbnail(item._id, captured).catch(() => {});
        }
      } catch (err) {
        // Silently continue if video stream cannot be decoded
      }
    });

    return () => {
      active = false;
    };
  }, [item._id, isVideo, hasRealThumb, extractedThumb]);

  const activeSrc = extractedThumb || streamFallback || thumbUrl;

  const handleClick = useCallback(() => {
    onClick(item._id);
  }, [onClick, item._id]);

  const handleSelectClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSelect(item._id);
  }, [onToggleSelect, item._id]);

  return (
    <div
      onClick={handleClick}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '130px' }}
      className={`group relative aspect-square bg-[#121217] border rounded-lg sm:rounded-2xl overflow-hidden cursor-pointer transition-transform duration-100 active:scale-95 select-none ${
        isSelected
          ? 'border-purple-500 ring-2 ring-purple-500/80 scale-[0.98]'
          : 'border-[#202026] hover:border-purple-500/40'
      }`}
    >
      {/* Media display */}
      {activeSrc && !loadError ? (
        <img
          src={activeSrc}
          alt={item.filename}
          style={{ imageOrientation: 'from-image' }}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => {
            if (isVideo) {
              setLoadError(true);
            } else if (!streamFallback) {
              const fallbackUrl = getPreviewUrl(item._id);
              if (activeSrc !== fallbackUrl) {
                setStreamFallback(fallbackUrl);
              } else {
                setLoadError(true);
              }
            } else {
              setLoadError(true);
            }
          }}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#141419] p-2 pointer-events-none">
          {isVideo ? (
            <div className="flex flex-col items-center space-y-1">
              <Film className="w-7 h-7 text-purple-400" />
              <span className="text-[9px] text-zinc-500 font-mono">Video</span>
            </div>
          ) : (
            <ImageIcon className="w-6 h-6 text-zinc-600" />
          )}
        </div>
      )}

      {/* Video Indicator */}
      {isVideo && (
        <div className="absolute bottom-1.5 left-1.5 bg-black/75 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-bold text-white flex items-center space-x-1 shadow pointer-events-none">
          <Play className="w-2.5 h-2.5 fill-white" />
          <span>{item.metadata?.duration ? `${Math.round(item.metadata.duration)}s` : 'VIDEO'}</span>
        </div>
      )}

      {/* Cloud-Only / Device Indicator */}
      <div className="absolute bottom-1.5 right-1.5 opacity-80 group-hover:opacity-100 transition pointer-events-none">
        {item.sourceDeviceIds && item.sourceDeviceIds.length > 0 ? (
          <div className="bg-black/60 backdrop-blur-sm p-1 rounded-full text-zinc-300" title="Backed up from phone">
            <Check className="w-2.5 h-2.5 text-emerald-400" />
          </div>
        ) : (
          <div className="bg-black/60 backdrop-blur-sm p-1 rounded-full text-zinc-300" title="Cloud only">
            <Cloud className="w-2.5 h-2.5 text-purple-400" />
          </div>
        )}
      </div>

      {/* Favorite Heart Badge */}
      {item.isFavorite && (
        <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-sm p-1 rounded-full text-red-500 shadow pointer-events-none">
          <Heart className="w-3 h-3 fill-red-500" />
        </div>
      )}

      {/* Selection Checkbox */}
      <div
        onClick={handleSelectClick}
        className={`absolute top-1.5 left-1.5 p-1 rounded-full transition ${
          isSelected
            ? 'bg-purple-600 text-white'
            : isSelectionMode
            ? 'bg-black/70 text-zinc-400 hover:text-white'
            : 'opacity-0 group-hover:opacity-100 bg-black/60 text-zinc-300 hover:text-white'
        }`}
      >
        {isSelected ? (
          <CheckSquare className="w-3.5 h-3.5 fill-purple-600 text-white" />
        ) : (
          <Square className="w-3.5 h-3.5" />
        )}
      </div>
    </div>
  );
});
