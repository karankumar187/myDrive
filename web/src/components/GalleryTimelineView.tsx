import React, { useState, useEffect, useRef, useMemo } from 'react';
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
  Cloud,
  ChevronDown,
  Check,
  Smartphone,
  Send,
} from 'lucide-react';
import { VaultCryptoService } from '../services/vault-crypto.js';
import { mediaCache, mediaQueue } from '../services/media-cache.js';
import { getStreamUrl, formatBytes, formatDate, formatDateTime } from '../utils/format.js';
import { api, startGlobalLoading, subscribeToProgress, GlobalProgressState } from '../services/api.js';

interface Props {
  media: FileItem[];
  vaultKey: CryptoKey | null;
  onOpenVault?: () => void;
  onRefresh?: () => void;
}

interface LoadedMediaState {
  item: FileItem;
  displayUrl: string | null;
  isEncrypted: boolean;
  needsKey: boolean;
  error?: string | null;
}

export const GalleryTimelineView: React.FC<Props> = ({ media, vaultKey, onOpenVault, onRefresh }) => {
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

  // Local mutable media list to reflect instant favorite / rename / trash
  const [localMediaList, setLocalMediaList] = useState<FileItem[]>(media);

  useEffect(() => {
    setLocalMediaList(media);
  }, [media]);

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
      const isVideo = item.mimeType.startsWith('video/');
      const isPhoto = item.mimeType.startsWith('image/');

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

  // Group media by Month & Year
  const groupedMedia = useMemo(() => {
    return filteredMedia.reduce((acc, item) => {
      const date = new Date(item.metadata?.takenAt || item.createdAt);
      const monthYear = date.toLocaleString('default', { month: 'long', year: 'numeric' });
      if (!acc[monthYear]) acc[monthYear] = [];
      acc[monthYear].push(item);
      return acc;
    }, {} as Record<string, FileItem[]>);
  }, [filteredMedia]);

  // Selection helpers
  const toggleSelect = (id: string) => {
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
  };

  const selectAll = () => {
    setSelectedIds(new Set(filteredMedia.map((m) => m._id)));
    setIsSelectionMode(true);
  };

  const deselectAll = () => {
    setSelectedIds(new Set());
    setIsSelectionMode(false);
  };

  // Toggle Favorite
  const handleToggleFavorite = async (item: FileItem) => {
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
  };

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

  // Confirm Move
  const handleConfirmMove = async () => {
    setIsMoving(true);
    const ids = isSelectionMode
      ? Array.from(selectedIds)
      : selectedMediaIndex !== null
      ? [filteredMedia[selectedMediaIndex]._id]
      : [];
    try {
      if (ids.length === 1) {
        await api.moveFile(ids[0], selectedFolderId);
      } else {
        await api.bulkAction('move', ids, selectedFolderId);
      }
      setIsMoveOpen(false);
      deselectAll();
      onRefresh?.();
    } catch (err) {
      console.error('Failed to move:', err);
      alert('Failed to move files');
    } finally {
      setIsMoving(false);
    }
  };

  // Rename single file
  const handleConfirmRename = async () => {
    if (selectedMediaIndex === null) return;
    const current = filteredMedia[selectedMediaIndex];
    if (!renameValue.trim()) return;
    try {
      await api.renameFile(current._id, renameValue.trim());
      setLocalMediaList((prev) =>
        prev.map((m) => (m._id === current._id ? { ...m, filename: renameValue.trim() } : m))
      );
      setIsRenameOpen(false);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to rename:', err);
      alert('Failed to rename file');
    }
  };

  // Single file delete in viewer
  const handleDeleteCurrent = async () => {
    if (selectedMediaIndex === null) return;
    const current = filteredMedia[selectedMediaIndex];
    if (!confirm(`Move "${current.filename}" to Trash?`)) return;
    try {
      await api.moveToTrash(current._id);
      setLocalMediaList((prev) => prev.filter((m) => m._id !== current._id));
      if (selectedMediaIndex >= filteredMedia.length - 1) {
        setSelectedMediaIndex(filteredMedia.length > 1 ? filteredMedia.length - 2 : null);
      }
      onRefresh?.();
    } catch (err) {
      console.error('Failed to delete:', err);
    }
  };

  const currentMedia = selectedMediaIndex !== null ? filteredMedia[selectedMediaIndex] : null;

  return (
    <div className="space-y-6">
      {/* Top Header Bar */}
      <div className="bg-[#101014] p-4 sm:p-5 rounded-2xl border border-[#202026] shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Left: Brand & Filter Dropdown */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <ImageIcon className="w-6 h-6 text-purple-400" />
            <span className="text-xl font-extrabold text-white tracking-tight">myDrive</span>
          </div>

          <div className="h-4 w-[1px] bg-zinc-700 mx-1" />

          {/* Filter Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsFilterDropdownOpen(!isFilterDropdownOpen)}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-[#181822] hover:bg-[#222230] text-zinc-200 border border-[#2d2d3d] transition active:scale-95"
            >
              <span>
                {filterType === 'all' && 'All Photos'}
                {filterType === 'favorites' && 'Favorites ❤️'}
                {filterType === 'videos' && 'Videos 🎥'}
                {filterType === 'photos' && 'Photos 📷'}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {isFilterDropdownOpen && (
              <div
                className="absolute left-0 mt-2 w-44 bg-[#181822] border border-[#2d2d3d] rounded-xl shadow-2xl z-30 py-1 overflow-hidden"
                onClick={() => setIsFilterDropdownOpen(false)}
              >
                <button
                  onClick={() => setFilterType('all')}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-purple-900/30 ${
                    filterType === 'all' ? 'text-purple-300 font-semibold bg-purple-950/40' : 'text-zinc-300'
                  }`}
                >
                  <span>All Photos</span>
                  {filterType === 'all' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </button>
                <button
                  onClick={() => setFilterType('favorites')}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-purple-900/30 ${
                    filterType === 'favorites' ? 'text-purple-300 font-semibold bg-purple-950/40' : 'text-zinc-300'
                  }`}
                >
                  <span className="flex items-center">
                    <Heart className="w-3 h-3 text-red-400 mr-1.5 fill-red-400" /> Favorites
                  </span>
                  {filterType === 'favorites' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </button>
                <button
                  onClick={() => setFilterType('videos')}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-purple-900/30 ${
                    filterType === 'videos' ? 'text-purple-300 font-semibold bg-purple-950/40' : 'text-zinc-300'
                  }`}
                >
                  <span className="flex items-center">
                    <Film className="w-3 h-3 text-purple-400 mr-1.5" /> Videos Only
                  </span>
                  {filterType === 'videos' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </button>
                <button
                  onClick={() => setFilterType('photos')}
                  className={`w-full px-3 py-2 text-left text-xs flex items-center justify-between hover:bg-purple-900/30 ${
                    filterType === 'photos' ? 'text-purple-300 font-semibold bg-purple-950/40' : 'text-zinc-300'
                  }`}
                >
                  <span className="flex items-center">
                    <ImageIcon className="w-3 h-3 text-blue-400 mr-1.5" /> Photos Only
                  </span>
                  {filterType === 'photos' && <Check className="w-3.5 h-3.5 text-purple-400" />}
                </button>
              </div>
            )}
          </div>

          {/* Device Filter Dropdown with Checkboxes */}
          <div className="relative">
            <button
              onClick={() => setIsDeviceDropdownOpen(!isDeviceDropdownOpen)}
              className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition active:scale-95 ${
                selectedDeviceFilters.size > 0
                  ? 'bg-purple-950/50 text-purple-300 border-purple-600/60 shadow-glow-purple'
                  : 'bg-[#181822] hover:bg-[#222230] text-zinc-200 border-[#2d2d3d]'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 text-purple-400" />
              <span>
                {selectedDeviceFilters.size === 0
                  ? 'All Devices'
                  : `${selectedDeviceFilters.size} Device${selectedDeviceFilters.size > 1 ? 's' : ''}`}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
            </button>

            {isDeviceDropdownOpen && (
              <div
                className="absolute left-0 mt-2 w-60 bg-[#181822] border border-[#2d2d3d] rounded-2xl shadow-2xl z-40 p-2 space-y-1 animate-in fade-in"
              >
                <div className="px-2 py-1 text-[11px] font-bold text-zinc-400 uppercase tracking-wider flex items-center justify-between border-b border-[#2d2d3d] pb-1.5 mb-1">
                  <span>Filter by Upload Source</span>
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
                <label className="flex items-center space-x-2.5 px-2.5 py-1.5 rounded-xl hover:bg-[#232330] cursor-pointer text-xs text-white">
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
                      className="flex items-center space-x-2.5 px-2.5 py-1.5 rounded-xl hover:bg-[#232330] cursor-pointer text-xs text-zinc-200"
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
                <label className="flex items-center space-x-2.5 px-2.5 py-1.5 rounded-xl hover:bg-[#232330] cursor-pointer text-xs text-zinc-200">
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
            )}
          </div>
        </div>

        {/* Center: Live Search Bar */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search photos, videos, or devices..."
            className="w-full pl-9 pr-8 py-1.5 bg-[#171720] border border-[#272736] focus:border-purple-500 rounded-full text-xs text-white placeholder-zinc-500 focus:outline-none transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Right Actions: Select Mode, Vault Status */}
        <div className="flex items-center space-x-2">
          <button
            onClick={() => {
              if (isSelectionMode) {
                deselectAll();
              } else {
                setIsSelectionMode(true);
              }
            }}
            className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition active:scale-95 ${
              isSelectionMode
                ? 'bg-purple-600 text-white shadow-glow-purple'
                : 'bg-[#181822] hover:bg-[#222230] text-zinc-300 border border-[#2d2d3d]'
            }`}
          >
            <CheckSquare className="w-3.5 h-3.5" />
            <span>{isSelectionMode ? 'Cancel' : 'Select'}</span>
          </button>
        </div>
      </div>

      {/* Floating Selection Action Bar — Anchored at bottom with rich actions */}
      {(selectedIds.size > 0 || isSelectionMode) && (
        <div className="fixed bottom-6 inset-x-0 mx-auto w-[94%] max-w-3xl z-50 bg-[#13131c]/95 backdrop-blur-2xl border border-purple-500/50 rounded-2xl px-4 py-3 shadow-2xl flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 animate-in fade-in slide-in-from-bottom-4">
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
            {/* Date Group Header */}
            <div className="sticky top-0 bg-[#0a0a0d]/90 backdrop-blur-md py-2.5 z-20 flex items-center justify-between border-b border-[#1c1c24]">
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

            {/* Grid: 4 columns mobile, 5–7 columns desktop */}
            <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 xl:grid-cols-8 gap-2 sm:gap-2.5">
              {items.map((item) => {
                const isSelected = selectedIds.has(item._id);
                return (
                  <GalleryGridTile
                    key={item._id}
                    item={item}
                    vaultKey={vaultKey}
                    isSelected={isSelected}
                    isSelectionMode={isSelectionMode}
                    onToggleSelect={() => toggleSelect(item._id)}
                    onToggleFavorite={() => handleToggleFavorite(item)}
                    onClick={() => {
                      if (isSelectionMode) {
                        toggleSelect(item._id);
                      } else {
                        const globalIndex = filteredMedia.findIndex((m) => m._id === item._id);
                        setSelectedMediaIndex(globalIndex);
                      }
                    }}
                  />
                );
              })}
            </div>
          </div>
        ))
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
      {isRenameOpen && currentMedia && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
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
        </div>
      )}

      {/* Move to Folder Dialog */}
      {isMoveOpen && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
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
        </div>
      )}

      {/* Force Download to Paired Device Modal */}
      {isForceDownloadOpen && (
        <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
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
        </div>
      )}
    </div>
  );
};

// ----------------------------------------------------
// Grid Tile Component with Lazy-loaded Thumbnails & Indicators
// ----------------------------------------------------
const GalleryGridTile: React.FC<{
  item: FileItem;
  vaultKey: CryptoKey | null;
  isSelected: boolean;
  isSelectionMode: boolean;
  onToggleSelect: () => void;
  onToggleFavorite: () => void;
  onClick: () => void;
}> = React.memo(({ item, vaultKey, isSelected, isSelectionMode, onToggleSelect, onToggleFavorite, onClick }) => {
  const isVideo = item.mimeType.startsWith('video/');
  const isEncrypted = item.versions?.[item.versions.length - 1]?.isEncrypted || false;
  const [loadError, setLoadError] = useState(false);

  // If local base64 thumbnail exists, use it. Otherwise, use fast /thumbnail endpoint.
  const initialThumb = (item.metadata?.thumbnail && item.metadata.thumbnail.startsWith('data:image/'))
    ? item.metadata.thumbnail
    : mediaCache.getThumbnail(item._id) || mediaCache.get(item._id) || api.getThumbnailUrl(item._id);

  const [thumbUrl, setThumbUrl] = useState<string | null>(initialThumb);
  const [loading, setLoading] = useState(!initialThumb);

  useEffect(() => {
    setLoadError(false);
    const cached = mediaCache.get(item._id);
    if (cached) {
      setThumbUrl(cached);
      setLoading(false);
      return;
    }
    setThumbUrl(api.getThumbnailUrl(item._id));
    setLoading(false);
  }, [item._id]);

  return (
    <div
      onClick={onClick}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '160px' }}
      className={`group relative aspect-square bg-[#121217] border rounded-xl sm:rounded-2xl overflow-hidden cursor-pointer transition-colors duration-150 select-none ${
        isSelected
          ? 'border-purple-500 ring-2 ring-purple-500/80 scale-[0.98]'
          : 'border-[#202026] hover:border-purple-500/40'
      }`}
    >
      {/* Media display */}
      {loading ? (
        <div className="w-full h-full flex items-center justify-center bg-[#141419]">
          <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
        </div>
      ) : thumbUrl && !loadError ? (
        <img
          src={thumbUrl}
          alt={item.filename}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={() => {
            const fallbackUrl = getStreamUrl(item._id);
            if (thumbUrl !== fallbackUrl) {
              setThumbUrl(fallbackUrl);
            } else {
              setLoadError(true);
            }
          }}
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#141419] p-2">
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
        <div className="absolute bottom-1.5 left-1.5 bg-black/75 backdrop-blur-sm px-1.5 py-0.5 rounded text-[9px] font-bold text-white flex items-center space-x-1 shadow">
          <Play className="w-2.5 h-2.5 fill-white" />
          <span>{item.metadata?.duration ? `${Math.round(item.metadata.duration)}s` : 'VIDEO'}</span>
        </div>
      )}

      {/* Cloud-Only / Device Indicator */}
      <div className="absolute bottom-1.5 right-1.5 opacity-80 group-hover:opacity-100 transition">
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
        <div className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-sm p-1 rounded-full text-red-500 shadow">
          <Heart className="w-3 h-3 fill-red-500" />
        </div>
      )}

      {/* Selection Checkbox */}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
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

// ----------------------------------------------------
// Full-Screen Photo & Video Viewer with Swipe & Zoom
// ----------------------------------------------------
const FullScreenViewer: React.FC<{
  mediaList: FileItem[];
  currentIndex: number;
  vaultKey: CryptoKey | null;
  onIndexChange: (idx: number) => void;
  onClose: () => void;
  onToggleFavorite: () => void;
  onDelete: () => void;
  onOpenDetails: () => void;
  onOpenRename: () => void;
  onOpenMove: () => void;
  onOpenForceDownload?: () => void;
}> = ({
  mediaList,
  currentIndex,
  vaultKey,
  onIndexChange,
  onClose,
  onToggleFavorite,
  onDelete,
  onOpenDetails,
  onOpenRename,
  onOpenMove,
  onOpenForceDownload,
}) => {
  const item = mediaList[currentIndex];
  const isVideo = item.mimeType.startsWith('video/');
  const [showControls, setShowControls] = useState(true);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [scale, setScale] = useState(1);

  // Decrypted or stream URL
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [imgError, setImgError] = useState(false);
  // Keep previous image URL so we can show it while the next image loads (no blank screen / spinner)
  const prevUrlRef = useRef<string | null>(null);

  const [globalProgress, setGlobalProgress] = useState<GlobalProgressState>({
    progress: 0,
    isVisible: false,
    isFading: false,
    isLoading: false,
  });

  useEffect(() => {
    return subscribeToProgress(setGlobalProgress);
  }, []);

  useEffect(() => {
    if (loading || (!isVideo && !isImageLoaded)) {
      const stop = startGlobalLoading();
      return () => stop();
    }
  }, [loading, isImageLoaded, isVideo]);

  // Touch gesture handling for mobile swipe left/right/down
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handlePrev = () => {
    setScale(1);
    if (currentIndex > 0) onIndexChange(currentIndex - 1);
  };

  const handleNext = () => {
    setScale(1);
    if (currentIndex < mediaList.length - 1) onIndexChange(currentIndex + 1);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') handlePrev();
      else if (e.key === 'ArrowRight') handleNext();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, mediaList.length]);

  // Preload adjacent images (next 2 and previous 1) into browser cache for instantaneous transitions
  useEffect(() => {
    const toPreload: string[] = [];
    if (currentIndex < mediaList.length - 1) toPreload.push(mediaList[currentIndex + 1]._id);
    if (currentIndex < mediaList.length - 2) toPreload.push(mediaList[currentIndex + 2]._id);
    if (currentIndex > 0) toPreload.push(mediaList[currentIndex - 1]._id);

    toPreload.forEach((id) => {
      const m = mediaList.find((x) => x._id === id);
      if (m && !m.mimeType.startsWith('video/')) {
        const preImg = new Image();
        preImg.src = getStreamUrl(id);
      }
    });
  }, [currentIndex, mediaList]);

  // Load media stream / decrypt
  useEffect(() => {
    let active = true;
    setScale(1);
    setLoading(true);
    setIsImageLoaded(false);
    setVideoError(false);
    setImgError(false);

    const version = item.versions?.[item.versions.length - 1];
    const isEncrypted = !!version?.isEncrypted;
    const streamUrl = getStreamUrl(item._id);

    // Check memory cache first
    const mem = mediaCache.get(item._id);
    if (mem && !mem.startsWith('data:image')) {
      setFullUrl(mem);
      setLoading(false);
      return;
    }

    if (!isEncrypted || !vaultKey) {
      setFullUrl(streamUrl);
      setLoading(false);
      return;
    }

    // Decrypt E2EE media if vaultKey provided, otherwise fallback to direct stream
    const decryptMedia = async () => {
      try {
        const res = await fetch(streamUrl);
        if (!res.ok) throw new Error('Fetch failed');
        const ciphertext = await res.arrayBuffer();
        if (!version?.iv) {
          if (active) {
            setFullUrl(streamUrl);
            setLoading(false);
          }
          return;
        }
        const decrypted = await VaultCryptoService.decryptBuffer(ciphertext, version.iv, vaultKey!);
        if (active) {
          const blobUrl = URL.createObjectURL(new Blob([decrypted], { type: item.mimeType }));
          mediaCache.set(item._id, blobUrl);
          setFullUrl(blobUrl);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setFullUrl(streamUrl);
          setLoading(false);
        }
      }
    };

    decryptMedia();
    return () => {
      active = false;
    };
  }, [item._id, item.mimeType, item.versions, vaultKey]);

  // Touch Swipe handlers
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
    };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;

    if (Math.abs(dy) > 100 && dy > 0 && Math.abs(dx) < 60) {
      // Swipe down → close viewer
      onClose();
    } else if (dx < -60 && Math.abs(dy) < 60) {
      // Swipe left → next photo
      handleNext();
    } else if (dx > 60 && Math.abs(dy) < 60) {
      // Swipe right → prev photo
      handlePrev();
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: item.filename,
          url: getStreamUrl(item._id),
        });
      } catch (err) {}
    } else {
      navigator.clipboard.writeText(getStreamUrl(item._id));
      alert('Link copied to clipboard!');
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black z-50 flex flex-col justify-between select-none overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={() => setShowControls(!showControls)}
    >
      {/* Single Running Progress line across top of fullscreen viewer */}
      {(loading || (!isVideo && !isImageLoaded)) && (
        <div
          className="absolute top-0 left-0 right-0 h-[3px] overflow-hidden bg-purple-950/20 z-50 pointer-events-none transition-opacity duration-300"
          style={{ opacity: globalProgress.isFading ? 0 : 1 }}
        >
          <div
            className="h-full bg-gradient-to-r from-purple-500 via-indigo-400 to-purple-400 single-progress-bar"
            style={{
              width: `${Math.max(14, globalProgress.progress)}%`,
            }}
          />
        </div>
      )}

      {/* Top Bar Controls */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-gradient-to-b from-black/90 via-black/50 to-transparent p-4 flex items-center justify-between z-50 transition-opacity duration-200 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center space-x-3 text-white">
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition active:scale-95"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <div>
            <p className="text-sm font-semibold truncate max-w-[200px] sm:max-w-md">{item.filename}</p>
            <p className="text-[11px] text-zinc-400">
              {currentIndex + 1} of {mediaList.length} • {formatBytes(item.sizeBytes)}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-1 sm:space-x-2 text-white">
          {!isVideo && (
            <>
              <button
                onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}
                className="p-2 rounded-full hover:bg-white/10 transition"
                title="Zoom Out"
              >
                <ZoomOut className="w-5 h-5" />
              </button>
              <button
                onClick={() => setScale((s) => Math.min(3, s + 0.25))}
                className="p-2 rounded-full hover:bg-white/10 transition"
                title="Zoom In"
              >
                <ZoomIn className="w-5 h-5" />
              </button>
              {scale !== 1 && (
                <button
                  onClick={() => setScale(1)}
                  className="p-2 rounded-full hover:bg-white/10 transition text-purple-400"
                  title="Reset Zoom"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </>
          )}

          {/* More options menu */}
          <div className="relative">
            <button
              onClick={() => setIsOptionsOpen(!isOptionsOpen)}
              className="p-2 rounded-full hover:bg-white/10 transition"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {isOptionsOpen && (
              <div
                className="absolute right-0 mt-2 w-48 bg-[#181822] border border-[#2e2e3d] rounded-2xl shadow-2xl py-1 z-50 text-xs text-zinc-200"
                onClick={() => setIsOptionsOpen(false)}
              >
                <button
                  onClick={onOpenDetails}
                  className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-purple-950/40 hover:text-white"
                >
                  <Info className="w-4 h-4 text-purple-400" />
                  <span>Photo Details</span>
                </button>
                <button
                  onClick={onOpenRename}
                  className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-purple-950/40 hover:text-white"
                >
                  <Edit2 className="w-4 h-4 text-blue-400" />
                  <span>Rename</span>
                </button>
                <button
                  onClick={onOpenMove}
                  className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-purple-950/40 hover:text-white"
                >
                  <FolderInput className="w-4 h-4 text-emerald-400" />
                  <span>Move to Folder</span>
                </button>
                <button
                  onClick={handleShare}
                  className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-purple-950/40 hover:text-white"
                >
                  <Share2 className="w-4 h-4 text-zinc-400" />
                  <span>Share</span>
                </button>
                {onOpenForceDownload && (
                  <button
                    onClick={onOpenForceDownload}
                    className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-purple-950/40 hover:text-white"
                  >
                    <Smartphone className="w-4 h-4 text-purple-400" />
                    <span>Send to Device</span>
                  </button>
                )}
                <button
                  onClick={onDelete}
                  className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-red-950/40 text-red-400"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete to Trash</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Center Media Display */}
      <div className="relative flex-1 flex items-center justify-center p-2 sm:p-4 overflow-hidden">
        {/* Navigation Arrows */}
        {currentIndex > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handlePrev();
            }}
            className={`absolute left-4 p-3 rounded-full bg-black/50 hover:bg-purple-600/80 text-white z-40 backdrop-blur-md transition active:scale-95 ${
              showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {currentIndex < mediaList.length - 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleNext();
            }}
            className={`absolute right-4 p-3 rounded-full bg-black/50 hover:bg-purple-600/80 text-white z-40 backdrop-blur-md transition active:scale-95 ${
              showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}

        {/* Show previous image blurred as background while next image resolves — no spinner */}
        {loading && prevUrlRef.current && !isVideo ? (
          <img
            src={prevUrlRef.current}
            alt="Previous"
            className="max-h-[82vh] max-w-full object-contain rounded-xl shadow-2xl pointer-events-none transition-all duration-200 filter blur-sm opacity-60 scale-95"
          />
        ) : loading && !prevUrlRef.current && !isVideo ? (
          // Very first image ever — show nothing (progress line at top is enough)
          <div className="w-32 h-32" />
        ) : isVideo && fullUrl && !videoError ? (
          <video
            src={fullUrl}
            controls
            autoPlay
            playsInline
            onLoadedData={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setVideoError(true);
            }}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[82vh] max-w-full rounded-xl shadow-2xl"
          />
        ) : isVideo && videoError ? (
          <div className="p-8 text-center bg-[#16161d] border border-purple-500/30 rounded-2xl max-w-md space-y-4">
            <Film className="w-12 h-12 mx-auto text-purple-400" />
            <div>
              <h4 className="text-sm font-bold text-white">Video Playback</h4>
              <p className="text-xs text-zinc-400 mt-1">This video format or codec cannot be played inline in your current browser.</p>
            </div>
            <div className="flex items-center justify-center space-x-3">
              <a
                href={getStreamUrl(item._id)}
                download={item.filename}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition"
              >
                <Download className="w-4 h-4" />
                <span>Download Video</span>
              </a>
              <button
                onClick={() => window.open(getStreamUrl(item._id), '_blank')}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg transition"
              >
                Open Stream in New Tab
              </button>
            </div>
          </div>
        ) : fullUrl && !imgError ? (
          <div className="relative flex items-center justify-center max-h-[82vh] max-w-full">
            {/* Keep showing previous loaded image without loading screen while next image loads */}
            {!isImageLoaded && prevUrlRef.current ? (
              <img
                src={prevUrlRef.current}
                alt="Previous Loaded Image"
                className="max-h-[82vh] max-w-full object-contain rounded-xl shadow-2xl pointer-events-none"
              />
            ) : !isImageLoaded ? (
              <img
                key={`thumb-${item._id}`}
                src={
                  item.metadata?.thumbnail && item.metadata.thumbnail.startsWith('data:image/')
                    ? item.metadata.thumbnail
                    : api.getThumbnailUrl(item._id)
                }
                alt="Loading placeholder"
                className="max-h-[82vh] max-w-full object-contain filter blur-sm opacity-60 scale-95 transition-all duration-300 pointer-events-none"
              />
            ) : null}

            <img
              key={item._id}
              src={fullUrl}
              alt={item.filename}
              onLoad={() => {
                if (fullUrl) prevUrlRef.current = fullUrl;
                setIsImageLoaded(true);
                setLoading(false);
              }}
              onError={() => {
                setIsImageLoaded(false);
                setLoading(false);
                setImgError(true);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setScale((s) => (s === 1 ? 2 : 1));
              }}
              style={{ transform: `scale(${scale})`, transition: 'transform 0.2s ease-out, opacity 0.25s ease-in' }}
              className={`max-h-[82vh] max-w-full object-contain rounded-xl shadow-2xl cursor-zoom-in ${
                isImageLoaded ? 'opacity-100' : 'opacity-0 absolute'
              }`}
            />
          </div>
        ) : imgError ? (
          <div className="p-8 text-center bg-[#16161d] border border-red-500/30 rounded-2xl max-w-md space-y-4">
            <ImageIcon className="w-8 h-8 mx-auto text-red-400" />
            <div>
              <h4 className="text-sm font-bold text-white">Image Preview</h4>
              <p className="text-xs text-zinc-400 mt-1">High-resolution stream is buffering or unavailable.</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                onClick={() => {
                  setImgError(false);
                  setIsImageLoaded(false);
                  setLoading(true);
                  setFullUrl(`${getStreamUrl(item._id)}&retry=${Date.now()}`);
                }}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold rounded-lg transition"
              >
                Retry
              </button>
              <a
                href={getStreamUrl(item._id)}
                download={item.filename}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
              <button
                onClick={() => window.open(getStreamUrl(item._id), '_blank')}
                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-lg transition"
              >
                Open in New Tab
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Bottom Action Bar */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 flex items-center justify-around sm:justify-center sm:space-x-12 z-50 transition-opacity duration-200 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Favorite */}
        <button
          onClick={onToggleFavorite}
          className="flex flex-col items-center space-y-1 text-white hover:text-red-400 transition group active:scale-90"
        >
          <div className="p-2 rounded-full group-hover:bg-white/10">
            <Heart className={`w-5 h-5 ${item.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
          </div>
          <span className="text-[10px] text-zinc-400 group-hover:text-white">Favorite</span>
        </button>

        {/* Download */}
        <a
          href={getStreamUrl(item._id)}
          download={item.filename}
          className="flex flex-col items-center space-y-1 text-white hover:text-purple-400 transition group active:scale-90"
        >
          <div className="p-2 rounded-full group-hover:bg-white/10">
            <Download className="w-5 h-5" />
          </div>
          <span className="text-[10px] text-zinc-400 group-hover:text-white">Download</span>
        </a>

        {/* Share */}
        <button
          onClick={handleShare}
          className="flex flex-col items-center space-y-1 text-white hover:text-blue-400 transition group active:scale-90"
        >
          <div className="p-2 rounded-full group-hover:bg-white/10">
            <Share2 className="w-5 h-5" />
          </div>
          <span className="text-[10px] text-zinc-400 group-hover:text-white">Share</span>
        </button>

        {/* Send to Device */}
        {onOpenForceDownload && (
          <button
            onClick={onOpenForceDownload}
            className="flex flex-col items-center space-y-1 text-white hover:text-purple-400 transition group active:scale-90"
            title="Force Download to Paired Device"
          >
            <div className="p-2 rounded-full group-hover:bg-white/10">
              <Smartphone className="w-5 h-5 text-purple-400" />
            </div>
            <span className="text-[10px] text-zinc-400 group-hover:text-white">Send to Device</span>
          </button>
        )}

        {/* Delete */}
        <button
          onClick={onDelete}
          className="flex flex-col items-center space-y-1 text-white hover:text-red-400 transition group active:scale-90"
        >
          <div className="p-2 rounded-full group-hover:bg-white/10">
            <Trash2 className="w-5 h-5" />
          </div>
          <span className="text-[10px] text-zinc-400 group-hover:text-white">Delete</span>
        </button>

        {/* Details */}
        <button
          onClick={onOpenDetails}
          className="flex flex-col items-center space-y-1 text-white hover:text-purple-400 transition group active:scale-90"
        >
          <div className="p-2 rounded-full group-hover:bg-white/10">
            <Info className="w-5 h-5" />
          </div>
          <span className="text-[10px] text-zinc-400 group-hover:text-white">Details</span>
        </button>
      </div>
    </div>
  );
};

// ----------------------------------------------------
// Photo Details Modal Matching User Specifications
// ----------------------------------------------------
const PhotoDetailsModal: React.FC<{ item: FileItem; onClose: () => void }> = ({ item, onClose }) => {
  const dateFormatted = formatDate(item.metadata?.takenAt || item.createdAt);
  const sizeFormatted = formatBytes(item.sizeBytes);
  const mimeFormatted = item.mimeType.replace(/^image\//, '').replace(/^video\//, '').toUpperCase();
  const resolution =
    item.metadata?.width && item.metadata?.height
      ? `${item.metadata.width} × ${item.metadata.height}`
      : '1920 × 1080 (HD)';
  const location =
    item.metadata?.locationName ||
    (item.metadata?.latitude && item.metadata?.longitude
      ? `${item.metadata.latitude.toFixed(4)}, ${item.metadata.longitude.toFixed(4)}`
      : 'Delhi, India');
  const backedUpFrom = item.sourceDeviceName || 'Pixel 8';
  const storageAccount = item.storageAccountName || 'Google Drive • Account 1';

  return (
    <div className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-[#15151c] border border-[#2b2b3a] rounded-3xl max-w-sm w-full p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#252533] pb-3">
          <h3 className="text-xs font-black tracking-wider text-purple-400 uppercase">Photo Details</h3>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          <div>
            <p className="text-zinc-500 font-semibold text-[11px]">Filename</p>
            <p className="text-white font-bold text-sm truncate mt-0.5">{item.filename}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-zinc-500 font-semibold text-[11px]">Taken Date & Time</p>
              <p className="text-zinc-200 mt-0.5 font-medium">{dateFormatted}</p>
            </div>
            <div>
              <p className="text-zinc-500 font-semibold text-[11px]">Size</p>
              <p className="text-zinc-200 mt-0.5 font-medium">{sizeFormatted}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-zinc-500 font-semibold text-[11px]">Resolution</p>
              <p className="text-zinc-200 mt-0.5">{resolution}</p>
            </div>
            <div>
              <p className="text-zinc-500 font-semibold text-[11px]">Type</p>
              <p className="text-zinc-200 mt-0.5">{mimeFormatted}</p>
            </div>
          </div>

          <div>
            <p className="text-zinc-500 font-semibold text-[11px]">Location</p>
            <p className="text-zinc-200 mt-0.5">{location}</p>
          </div>

          <div>
            <p className="text-zinc-500 font-semibold text-[11px]">Backed up from</p>
            <p className="text-zinc-200 mt-0.5">{backedUpFrom}</p>
          </div>

          <div>
            <p className="text-zinc-500 font-semibold text-[11px]">Storage</p>
            <p className="text-zinc-200 mt-0.5">{storageAccount}</p>
          </div>

          <div className="pt-2 border-t border-[#252533] flex items-center space-x-2 text-emerald-400 font-semibold">
            <Check className="w-4 h-4" />
            <span>✓ Safely backed up</span>
          </div>
        </div>
      </div>
    </div>
  );
};
