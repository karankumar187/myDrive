import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FileItem, AlbumDetailItem } from '../../types.js';
import {
  ChevronLeft,
  MapPin,
  Calendar,
  Image as ImageIcon,
  Play,
  Heart,
  Plus,
  Trash2,
  Share2,
  Pin,
  Download,
  Loader2,
  Sparkles,
  Smartphone,
  Laptop,
  Camera,
  LayoutGrid,
  Columns,
  X,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { EditorialCollageGrid } from './EditorialCollageGrid.js';
import { ModernVideoPlayer } from '../ModernVideoPlayer.js';
import { getPreviewUrl, getStreamUrl, formatBytes } from '../../utils/format.js';
import { isVideoFile } from '../../services/media-cache.js';

// In-memory cache for instant 0ms album transitions (SWR)
const albumDetailCache = new Map<string, AlbumDetailItem>();

interface AlbumDetailViewProps {
  albumId: string;
  onBack: () => void;
  allMedia: FileItem[];
  vaultKey: CryptoKey | null;
  onAlbumUpdated?: () => void;
}

export const AlbumDetailView: React.FC<AlbumDetailViewProps> = ({
  albumId,
  onBack,
  allMedia,
  vaultKey,
  onAlbumUpdated,
}) => {
  const [album, setAlbum] = useState<AlbumDetailItem | null>(() => albumDetailCache.get(albumId) || null);
  const [loading, setLoading] = useState<boolean>(() => !albumDetailCache.has(albumId));
  const [error, setError] = useState<string | null>(null);

  // Layout mode: 'collage' or 'grid'
  const [viewMode, setViewMode] = useState<'collage' | 'grid'>('collage');

  // Lightbox & Slideshow state
  const [activeLightboxIndex, setActiveLightboxIndex] = useState<number | null>(null);
  const [isSlideshowRunning, setIsSlideshowRunning] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Photo management modals
  const [isAddPhotosOpen, setIsAddPhotosOpen] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());

  // Load album details with Stale-While-Revalidate caching
  const loadAlbumData = async () => {
    try {
      if (!albumDetailCache.has(albumId)) {
        setLoading(true);
      }
      setError(null);
      const res = await api.getAlbum(albumId);
      albumDetailCache.set(albumId, res.album);
      setAlbum(res.album);
    } catch (err: any) {
      console.error('Failed to load album:', err);
      if (!albumDetailCache.has(albumId)) {
        setError(err.message || 'Failed to load album');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlbumData();
  }, [albumId]);

  // Slideshow timer
  useEffect(() => {
    if (!isSlideshowRunning || !album || album.files.length === 0) return;
    const interval = setInterval(() => {
      setActiveLightboxIndex((prev) => {
        if (prev === null) return 0;
        return (prev + 1) % album.files.length;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [isSlideshowRunning, album]);

  // Format album dates
  const formatAlbumDates = () => {
    if (!album) return null;
    const start = album.startDate ? new Date(album.startDate) : null;
    const end = album.endDate ? new Date(album.endDate) : null;

    if (start && end) {
      const diffTime = Math.abs(end.getTime() - start.getTime());
      const diffDays = Math.max(1, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
      const startStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      const endStr = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      return `${startStr} – ${endStr} • ${diffDays} Days`;
    }
    if (start) {
      return start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return null;
  };

  // Toggle favorite on an item
  const handleToggleItemFavorite = async (item: FileItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await api.toggleFavorite(item._id);
      setAlbum((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          files: prev.files.map((f) =>
            f._id === item._id ? { ...f, isFavorite: !f.isFavorite } : f
          ),
        };
      });
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
    }
  };

  // Toggle album pinned status
  const handleTogglePin = async () => {
    if (!album) return;
    try {
      const nextPin = !album.isPinned;
      await api.updateAlbum(album._id, { isPinned: nextPin });
      setAlbum((prev) => (prev ? { ...prev, isPinned: nextPin } : null));
      onAlbumUpdated?.();
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  // Add photos to album
  const handleAddPhotos = async () => {
    if (!album || selectedToAdd.size === 0) return;
    try {
      await api.addPhotosToAlbum(album._id, Array.from(selectedToAdd));
      setIsAddPhotosOpen(false);
      setSelectedToAdd(new Set());
      await loadAlbumData();
      onAlbumUpdated?.();
    } catch (err) {
      console.error('Failed to add photos:', err);
    }
  };

  // Remove photo from album
  const handleRemovePhoto = async (fileId: string) => {
    if (!album) return;
    try {
      await api.removePhotosFromAlbum(album._id, [fileId]);
      setAlbum((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          files: prev.files.filter((f) => f._id !== fileId),
          fileCount: Math.max(0, prev.fileCount - 1),
        };
      });
      if (activeLightboxIndex !== null) {
        setActiveLightboxIndex(null);
      }
      onAlbumUpdated?.();
    } catch (err) {
      console.error('Failed to remove photo:', err);
    }
  };

  // Delete album
  const handleDeleteAlbum = async () => {
    if (!album) return;
    if (!window.confirm(`Are you sure you want to delete "${album.title}"? Your original photos will remain safe.`)) return;
    try {
      await api.deleteAlbum(album._id);
      onAlbumUpdated?.();
      onBack();
    } catch (err) {
      console.error('Failed to delete album:', err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[500px] flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
        <span className="text-xs text-neutral-400">Loading album...</span>
      </div>
    );
  }

  if (error || !album) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-red-400 mb-4">{error || 'Album not found'}</p>
        <button
          onClick={onBack}
          className="px-4 py-2 rounded-xl bg-neutral-800 text-xs text-neutral-200 hover:bg-neutral-700"
        >
          Return to Albums
        </button>
      </div>
    );
  }

  const coverUrl = album.coverFile?._id
    ? getPreviewUrl(album.coverFile._id)
    : album.files.length > 0
    ? getPreviewUrl(album.files[0]._id)
    : null;

  const currentLightboxItem =
    activeLightboxIndex !== null && album.files[activeLightboxIndex]
      ? album.files[activeLightboxIndex]
      : null;

  return (
    <div className="w-full space-y-8 animate-fadeIn pb-16">
      {/* Top Floating Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-neutral-900/80 hover:bg-neutral-800 border border-white/10 text-xs font-semibold text-neutral-200 backdrop-blur-md transition-all shadow-md group"
        >
          <ChevronLeft className="w-4 h-4 text-purple-400 group-hover:-translate-x-0.5 transition-transform" />
          <span>Back to Albums</span>
        </button>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (album.files.length > 0) {
                setActiveLightboxIndex(0);
                setIsSlideshowRunning(true);
              }
            }}
            disabled={album.files.length === 0}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-purple-600/20 hover:bg-purple-600/30 border border-purple-500/40 text-xs font-semibold text-purple-300 transition-all disabled:opacity-40"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>Play Slideshow</span>
          </button>

          <button
            onClick={() => setIsAddPhotosOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-xs font-semibold text-white shadow-lg shadow-purple-500/25 transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Photos</span>
          </button>
        </div>
      </div>

      {/* Cinematic Hero Cover Banner */}
      <div className="relative rounded-3xl overflow-hidden min-h-[340px] md:min-h-[420px] flex flex-col justify-end p-6 md:p-10 border border-white/10 shadow-2xl bg-neutral-950">
        {/* Ambient Cover Art */}
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={album.title}
            style={{ transform: 'translateZ(0)' }}
            className="absolute inset-0 w-full h-full object-cover object-center brightness-75"
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-purple-900/50 via-neutral-900 to-indigo-950" />
        )}

        {/* Deep Vignette Overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent" />

        {/* Banner Content */}
        <div className="relative z-10 max-w-3xl space-y-3">
          {album.destination?.name && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-xs font-medium text-white shadow-lg">
              <MapPin className="w-3.5 h-3.5 text-purple-400" />
              <span>{album.destination.name}</span>
            </div>
          )}

          <h1 className="text-3xl md:text-5xl font-black text-white tracking-tight leading-tight drop-shadow-lg">
            {album.title}
          </h1>

          {album.description && (
            <p className="text-sm md:text-base text-neutral-300 font-normal leading-relaxed line-clamp-2 drop-shadow">
              {album.description}
            </p>
          )}

          {/* Stats Bar */}
          <div className="flex flex-wrap items-center gap-3 pt-3 text-xs text-neutral-300">
            {formatAlbumDates() && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10">
                <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                <span>{formatAlbumDates()}</span>
              </div>
            )}

            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10">
              <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
              <span>
                {album.files.length} {album.files.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            {album.totalSizeBytes > 0 && (
              <div className="px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10">
                <span>{formatBytes(album.totalSizeBytes)}</span>
              </div>
            )}

            {/* Contributor devices */}
            {album.contributors && album.contributors.length > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/10">
                <span className="text-[11px] text-neutral-400">Captured on:</span>
                <span className="font-semibold text-white">
                  {album.contributors.map((c) => c.deviceName).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Pin & Delete corner actions */}
        <div className="absolute top-6 right-6 flex items-center gap-2 z-10">
          <button
            onClick={handleTogglePin}
            title={album.isPinned ? 'Unpin album' : 'Pin album'}
            className={`p-2.5 rounded-full backdrop-blur-md border transition-all ${
              album.isPinned
                ? 'bg-purple-600/80 border-purple-400 text-white shadow-lg shadow-purple-500/20'
                : 'bg-black/50 border-white/20 text-white/70 hover:text-white hover:bg-black/70'
            }`}
          >
            <Pin className="w-4 h-4 fill-current" />
          </button>

          <button
            onClick={handleDeleteAlbum}
            title="Delete Album"
            className="p-2.5 rounded-full bg-black/50 border border-white/20 text-neutral-300 hover:text-red-400 hover:bg-black/70 backdrop-blur-md transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Grid Controls: Layout Toggle */}
      <div className="flex items-center justify-between pt-2">
        <h2 className="text-lg font-bold text-white tracking-tight">
          Visual Memories ({album.files.length})
        </h2>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-neutral-900 border border-white/10">
          <button
            onClick={() => setViewMode('collage')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              viewMode === 'collage'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Columns className="w-3.5 h-3.5" />
            <span>Magazine</span>
          </button>
          <button
            onClick={() => setViewMode('grid')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              viewMode === 'grid'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            <span>Uniform Grid</span>
          </button>
        </div>
      </div>

      {/* Media Rendering */}
      {album.files.length === 0 ? (
        <div className="py-20 text-center rounded-3xl border border-dashed border-white/10 bg-neutral-900/30">
          <ImageIcon className="w-12 h-12 text-neutral-600 mx-auto mb-3" />
          <h3 className="text-base font-semibold text-neutral-200">No photos in this album yet</h3>
          <p className="text-xs text-neutral-400 mt-1 mb-4">
            Curate your favorite travel moments into this album.
          </p>
          <button
            onClick={() => setIsAddPhotosOpen(true)}
            className="px-4 py-2 rounded-xl bg-purple-600 text-xs font-semibold text-white hover:bg-purple-500 shadow-md"
          >
            Add Photos Now
          </button>
        </div>
      ) : viewMode === 'collage' ? (
        <EditorialCollageGrid
          files={album.files}
          onItemClick={(file, idx) => {
            setActiveLightboxIndex(idx);
            setIsSlideshowRunning(false);
          }}
          onToggleFavorite={handleToggleItemFavorite}
        />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
          {album.files.map((file, idx) => {
            const thumbUrl =
              file.metadata?.thumbnail && file.metadata.thumbnail.startsWith('data:image/')
                ? file.metadata.thumbnail
                : api.getThumbnailUrl(file._id);

            return (
              <div
                key={file._id}
                onClick={() => {
                  setActiveLightboxIndex(idx);
                  setIsSlideshowRunning(false);
                }}
                style={{ contentVisibility: 'auto', containIntrinsicSize: '160px' }}
                className="group relative aspect-square rounded-2xl overflow-hidden cursor-pointer bg-neutral-900 border border-white/10 hover:border-purple-500/50 transition-all select-none"
              >
                <img
                  src={thumbUrl}
                  alt={file.filename}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {isVideoFile(file.mimeType || file.filename) && (
                  <div className="absolute top-2 left-2 p-1.5 rounded-full bg-black/60 text-purple-400">
                    <Play className="w-3 h-3 fill-current" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add Photos Modal */}
      {isAddPhotosOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl bg-neutral-900 border border-white/15 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
              <h3 className="text-base font-bold text-white">Add Photos to "{album.title}"</h3>
              <button
                onClick={() => setIsAddPhotosOpen(false)}
                className="p-1 rounded-lg text-neutral-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <p className="text-xs text-neutral-400 mb-3">
                Select media items from your gallery to add to this album:
              </p>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 max-h-[350px] overflow-y-auto">
                {allMedia
                  .filter((m) => !album.files.some((f) => f._id === m._id))
                  .map((m) => {
                    const isSelected = selectedToAdd.has(m._id);
                    const thumbUrl =
                      m.metadata?.thumbnail && m.metadata.thumbnail.startsWith('data:image/')
                        ? m.metadata.thumbnail
                        : api.getThumbnailUrl(m._id);

                    return (
                      <div
                        key={m._id}
                        onClick={() => {
                          setSelectedToAdd((prev) => {
                            const next = new Set(prev);
                            if (next.has(m._id)) next.delete(m._id);
                            else next.add(m._id);
                            return next;
                          });
                        }}
                        style={{ contentVisibility: 'auto', containIntrinsicSize: '120px' }}
                        className={`relative aspect-square rounded-xl overflow-hidden cursor-pointer border transition-all ${
                          isSelected
                            ? 'border-purple-500 ring-2 ring-purple-500/60'
                            : 'border-white/10 opacity-70 hover:opacity-100'
                        }`}
                      >
                        <img
                          src={thumbUrl}
                          alt={m.filename}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />
                        <div
                          className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-md flex items-center justify-center ${
                            isSelected ? 'bg-purple-600 text-white' : 'bg-black/50 text-transparent'
                          }`}
                        >
                          ✓
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/10 bg-neutral-900/60">
              <span className="text-xs text-neutral-400">
                {selectedToAdd.size} items selected
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAddPhotosOpen(false)}
                  className="px-3.5 py-1.5 text-xs text-neutral-300 hover:bg-white/10 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddPhotos}
                  disabled={selectedToAdd.size === 0}
                  className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-xs font-semibold text-white disabled:opacity-50"
                >
                  Add Selected
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Lightbox & Slideshow */}
      {currentLightboxItem &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur-xl animate-fadeIn">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-black/80 to-transparent z-20">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-white drop-shadow">
                  {currentLightboxItem.filename}
                </span>
                <span className="text-xs text-neutral-400">
                  {activeLightboxIndex! + 1} of {album.files.length}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsSlideshowRunning(!isSlideshowRunning)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                    isSlideshowRunning
                      ? 'bg-purple-600 border-purple-400 text-white'
                      : 'bg-black/50 border-white/20 text-neutral-300 hover:text-white'
                  }`}
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isSlideshowRunning ? 'Pause' : 'Slideshow'}</span>
                </button>

                <button
                  onClick={() => setZoomLevel((z) => Math.min(z + 0.25, 3))}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/80 text-neutral-300 hover:text-white border border-white/10"
                >
                  <ZoomIn className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setZoomLevel((z) => Math.max(z - 0.25, 0.5))}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/80 text-neutral-300 hover:text-white border border-white/10"
                >
                  <ZoomOut className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setRotation((r) => (r + 90) % 360)}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/80 text-neutral-300 hover:text-white border border-white/10"
                >
                  <RotateCw className="w-4 h-4" />
                </button>

                <button
                  onClick={() => handleRemovePhoto(currentLightboxItem._id)}
                  title="Remove from album"
                  className="p-2 rounded-full bg-black/50 hover:bg-red-500/20 text-neutral-300 hover:text-red-400 border border-white/10"
                >
                  <Trash2 className="w-4 h-4" />
                </button>

                <button
                  onClick={() => {
                    setActiveLightboxIndex(null);
                    setIsSlideshowRunning(false);
                  }}
                  className="p-2 rounded-full bg-black/50 hover:bg-black/80 text-neutral-300 hover:text-white border border-white/10 ml-2"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Main Stage View */}
            <div className="flex-1 relative flex items-center justify-center p-4 overflow-hidden select-none">
              {/* Prev Button */}
              {activeLightboxIndex! > 0 && (
                <button
                  onClick={() => {
                    setActiveLightboxIndex(activeLightboxIndex! - 1);
                    setZoomLevel(1);
                    setRotation(0);
                  }}
                  className="absolute left-6 z-20 p-3 rounded-full bg-black/60 hover:bg-black border border-white/20 text-white transition-all shadow-xl"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              )}

              {/* Media rendering: video player or image */}
              {isVideoFile(currentLightboxItem.mimeType || currentLightboxItem.filename) ? (
                <div className="w-full max-w-5xl max-h-[85vh]">
                  <ModernVideoPlayer
                    src={getStreamUrl(currentLightboxItem._id)}
                    filename={currentLightboxItem.filename}
                    poster={getPreviewUrl(currentLightboxItem._id)}
                  />
                </div>
              ) : (
                <img
                  src={getStreamUrl(currentLightboxItem._id)}
                  alt={currentLightboxItem.filename}
                  style={{
                    transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                    transition: 'transform 0.2s ease-out',
                  }}
                  className="max-h-[82vh] max-w-[92vw] object-contain shadow-2xl rounded-lg"
                />
              )}

              {/* Next Button */}
              {activeLightboxIndex! < album.files.length - 1 && (
                <button
                  onClick={() => {
                    setActiveLightboxIndex(activeLightboxIndex! + 1);
                    setZoomLevel(1);
                    setRotation(0);
                  }}
                  className="absolute right-6 z-20 p-3 rounded-full bg-black/60 hover:bg-black border border-white/20 text-white transition-all shadow-xl"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
