import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FileItem } from '../types.js';
import {
  api,
  subscribeToProgress,
  startGlobalLoading,
  GlobalProgressState,
} from '../services/api.js';
import { mediaCache, isVideoFile } from '../services/media-cache.js';
import { VaultCryptoService } from '../services/vault-crypto.js';
import { ModernVideoPlayer } from './ModernVideoPlayer.js';
import { getPreviewUrl, getStreamUrl, formatBytes, formatDate } from '../utils/format.js';
import {
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  MoreVertical,
  Info,
  Edit2,
  FolderInput,
  Share2,
  Smartphone,
  Trash2,
  Heart,
  Download,
  Image as ImageIcon,
  Film,
  Loader2,
  X,
  Check,
  Lock,
} from 'lucide-react';

export interface FullScreenViewerProps {
  mediaList: FileItem[];
  currentIndex: number;
  vaultKey: CryptoKey | null;
  onIndexChange: (idx: number) => void;
  onClose: () => void;
  onToggleFavorite?: () => void;
  onDelete?: () => void;
  onOpenDetails?: () => void;
  onOpenRename?: () => void;
  onOpenMove?: () => void;
  onMoveToVault?: () => void;
  onOpenForceDownload?: () => void;
  onLoadMore?: () => void;
}

// ----------------------------------------------------
// Full-Screen Photo & Video Viewer with Swipe, Zoom & 5-item Preload
// ----------------------------------------------------
export const FullScreenViewer: React.FC<FullScreenViewerProps> = ({
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
  onMoveToVault,
  onOpenForceDownload,
  onLoadMore,
}) => {
  const item = mediaList[currentIndex];
  if (!item) return null;

  const isVideo = isVideoFile(item.mimeType) || isVideoFile(item.filename);
  const [showControls, setShowControls] = useState(true);
  const [isOptionsOpen, setIsOptionsOpen] = useState(false);
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);

  // Decrypted or stream URL
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Optimistic UI: Derive current item's thumbnail to display instantaneously during left/right navigation
  const itemThumbnailUrl = useMemo(() => {
    if (item.metadata?.thumbnail && item.metadata.thumbnail.startsWith('data:image/')) {
      return item.metadata.thumbnail;
    }
    return mediaCache.getThumbnail(item._id) || mediaCache.get(item._id) || api.getThumbnailUrl(item._id);
  }, [item._id, item.metadata?.thumbnail]);

  const [globalProgress, setGlobalProgress] = useState<GlobalProgressState>({
    progress: 0,
    isVisible: false,
    isFading: false,
    isLoading: false,
    colorType: 'decrypt',
  });

  useEffect(() => {
    return subscribeToProgress(setGlobalProgress);
  }, []);

  // Lock body scroll on mobile Safari/iOS while viewing full screen
  useEffect(() => {
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = origOverflow;
    };
  }, []);

  useEffect(() => {
    if (loading || (!isVideo && !isImageLoaded)) {
      const stop = startGlobalLoading('decrypt');
      return () => stop();
    }
  }, [loading, isImageLoaded, isVideo]);

  // Touch gesture handling for mobile swipe left/right/down
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const handlePrev = () => {
    setScale(1);
    setRotation(0);
    if (currentIndex > 0) onIndexChange(currentIndex - 1);
  };

  const handleNext = () => {
    setScale(1);
    setRotation(0);
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

  // Preload adjacent images & thumbnails (next 5 and previous 5) for ultra-smooth photo transitions
  useEffect(() => {
    // Interleaved proximity order: +1, -1, +2, -2, +3, -3, +4, -4, +5, -5
    const offsets = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5];
    const indicesToPreload = offsets
      .map((offset) => currentIndex + offset)
      .filter((idx) => idx >= 0 && idx < mediaList.length);

    indicesToPreload.forEach((idx) => {
      const m = mediaList[idx];
      if (!m) return;
      const isMVideo = isVideoFile(m.mimeType) || isVideoFile(m.filename);

      // 1. Preload thumbnail immediately for instant placeholder display
      const thumbUrl =
        m.metadata?.thumbnail && m.metadata.thumbnail.startsWith('data:image/')
          ? m.metadata.thumbnail
          : mediaCache.getThumbnail(m._id) || api.getThumbnailUrl(m._id);
      if (thumbUrl && !thumbUrl.startsWith('data:')) {
        const tImg = new Image();
        tImg.src = thumbUrl;
      }

      // 2. Preload web-optimized preview image if not a video (~250KB WebP)
      if (!isMVideo) {
        const previewUrl = getPreviewUrl(m._id);
        const streamUrl = getStreamUrl(m._id);
        const fImg = new Image();
        fImg.src = previewUrl;

        // 3. Pre-decrypt into memory cache if vault key is active for immediate neighbors
        const distance = Math.abs(idx - currentIndex);
        if (vaultKey && distance <= 2 && !mediaCache.has(m._id)) {
          const version = m.versions?.[m.versions.length - 1];
          if (version?.isEncrypted && version?.iv) {
            fetch(streamUrl)
              .then((res) => {
                if (res.ok) return res.arrayBuffer();
                throw new Error('Preload fetch failed');
              })
              .then((ciphertext) => VaultCryptoService.decryptBuffer(ciphertext, version.iv!, vaultKey))
              .then((decrypted) => {
                const blobUrl = URL.createObjectURL(new Blob([decrypted], { type: m.mimeType }));
                mediaCache.set(m._id, blobUrl);
              })
              .catch(() => {});
          }
        }
      } else {
        // Pre-warm video cache on server for immediate neighbor videos (distance <= 2)
        const distance = Math.abs(idx - currentIndex);
        if (distance <= 2) {
          const vUrl = getStreamUrl(m._id);
          fetch(vUrl, { headers: { Range: 'bytes=0-1023' } }).catch(() => {});
        }
      }
    });

    // If viewer is approaching the end of loaded media (within 6 items), trigger infinite scroll
    if (currentIndex >= mediaList.length - 6 && onLoadMore) {
      onLoadMore();
    }
  }, [currentIndex, mediaList, vaultKey, onLoadMore]);

  // Load media stream / decrypt
  useEffect(() => {
    let active = true;
    setScale(1);
    setRotation(0);
    setLoading(true);
    setIsImageLoaded(false);
    setVideoError(false);
    setImgError(false);

    const version = item.versions?.[item.versions.length - 1];
    const isEncrypted = !!version?.isEncrypted;
    const streamUrl = getStreamUrl(item._id);
    const previewUrl = isVideo ? streamUrl : getPreviewUrl(item._id);

    // Check memory cache first
    const mem = mediaCache.get(item._id);
    if (mem && !mem.startsWith('data:image')) {
      setFullUrl(mem);
      setLoading(false);
      return;
    }

    if (!isEncrypted || !vaultKey) {
      setFullUrl(previewUrl);
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
            setFullUrl(previewUrl);
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
          setFullUrl(previewUrl);
          setLoading(false);
        }
      }
    };

    decryptMedia();
    return () => {
      active = false;
    };
  }, [item._id, item.mimeType, item.versions, isVideo, vaultKey]);

  // Dynamically upgrade to full uncompressed original stream when zooming in
  useEffect(() => {
    if (scale > 1.2 && !isVideo) {
      const version = item.versions?.[item.versions.length - 1];
      if (!version?.isEncrypted && !vaultKey) {
        const streamUrl = getStreamUrl(item._id);
        if (fullUrl && fullUrl !== streamUrl) {
          setFullUrl(streamUrl);
        }
      }
    }
  }, [scale, item._id, isVideo, fullUrl, item.versions, vaultKey]);

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

  const [isSharingDownloading, setIsSharingDownloading] = useState(false);
  const handleShare = async () => {
    const streamUrl = getStreamUrl(item._id);
    try {
      setIsSharingDownloading(true);
      if (typeof navigator !== 'undefined' && navigator.canShare) {
        try {
          const res = await fetch(streamUrl);
          if (res.ok) {
            const blob = await res.blob();
            const file = new File([blob], item.filename, {
              type: item.mimeType || blob.type || 'image/jpeg',
            });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({
                files: [file],
                title: item.filename,
              });
              return;
            }
          }
        } catch (_) {}
      }

      if (navigator.share) {
        await navigator.share({
          title: item.filename,
          url: streamUrl,
        });
      } else {
        await navigator.clipboard.writeText(streamUrl);
        alert('Direct media link copied to clipboard!');
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Share failed:', err);
      }
    } finally {
      setIsSharingDownloading(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-[#000000] z-[100] flex flex-col justify-between select-none overflow-hidden"
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
            className="h-full single-progress-bar progress-decrypt"
            style={{
              width: `${Math.max(14, globalProgress.progress)}%`,
            }}
          />
        </div>
      )}

      {/* Top Bar Controls with Safe Area Inset */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-gradient-to-b from-black via-black/80 to-transparent pt-[max(1rem,env(safe-area-inset-top,0px))] px-4 pb-3 flex items-center justify-between z-50 transition-opacity duration-200 ${
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
              <button
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="p-2 rounded-full hover:bg-white/10 transition text-white hover:text-purple-400"
                title="Rotate 90°"
              >
                <RotateCw className="w-5 h-5" />
              </button>
              {(scale !== 1 || rotation !== 0) && (
                <button
                  onClick={() => {
                    setScale(1);
                    setRotation(0);
                  }}
                  className="p-2 rounded-full hover:bg-white/10 transition text-purple-400"
                  title="Reset Zoom & Rotation"
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
                {onOpenDetails && (
                  <button
                    onClick={onOpenDetails}
                    className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-purple-950/40 hover:text-white"
                  >
                    <Info className="w-4 h-4 text-purple-400" />
                    <span>Photo Details</span>
                  </button>
                )}
                {onOpenRename && (
                  <button
                    onClick={onOpenRename}
                    className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-purple-950/40 hover:text-white"
                  >
                    <Edit2 className="w-4 h-4 text-blue-400" />
                    <span>Rename</span>
                  </button>
                )}
                {onOpenMove && (
                  <button
                    onClick={onOpenMove}
                    className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-purple-950/40 hover:text-white"
                  >
                    <FolderInput className="w-4 h-4 text-emerald-400" />
                    <span>Move to Folder</span>
                  </button>
                )}
                {onMoveToVault && !item.isVault && (
                  <button
                    onClick={() => {
                      setIsOptionsOpen(false);
                      onMoveToVault();
                    }}
                    className="w-full px-4 py-2.5 text-left flex items-center space-x-2 text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                  >
                    <Lock className="w-4 h-4 text-amber-400" />
                    <span>Move to Secret Vault</span>
                  </button>
                )}
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
                {onDelete && (
                  <button
                    onClick={onDelete}
                    className="w-full px-4 py-2.5 text-left flex items-center space-x-2 hover:bg-red-950/40 text-red-400"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete to Trash</span>
                  </button>
                )}
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

        {isVideo ? (
          fullUrl ? (
            <div className="w-[90vw] max-w-4xl max-h-[82vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
              <ModernVideoPlayer
                key={item._id}
                src={fullUrl}
                filename={item.filename}
                poster={itemThumbnailUrl || undefined}
                autoPlay
                className="w-full max-h-[80vh] shadow-2xl"
                onDownload={() => {}}
                onThumbnailExtracted={(thumb) => {
                  mediaCache.saveThumbnail(item._id, thumb);
                  api.updateThumbnail(item._id, thumb).catch(() => {});
                }}
              />
            </div>
          ) : (
            <div className="relative flex items-center justify-center max-h-[82vh] max-w-full">
              {itemThumbnailUrl ? (
                <img
                  src={itemThumbnailUrl}
                  alt="Video thumbnail"
                  className="max-h-[82vh] max-w-full object-contain rounded-xl filter blur-[1px] opacity-75"
                />
              ) : (
                <div className="w-48 h-48 flex items-center justify-center bg-zinc-900 rounded-xl">
                  <Film className="w-12 h-12 text-zinc-600 animate-pulse" />
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-14 h-14 rounded-full bg-black/60 backdrop-blur-md flex items-center justify-center border border-white/20">
                  <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                </div>
              </div>
            </div>
          )
        ) : !imgError ? (
          <div className="relative flex items-center justify-center max-h-[82vh] max-w-full w-full h-full">
            {/* Optimistic Thumbnail: Shown immediately on open or swipe left/right while full HD image loads */}
            {!isImageLoaded && (
              <img
                key={`thumb-${item._id}`}
                src={itemThumbnailUrl}
                alt={item.filename}
                style={{
                  transform: `scale(${scale}) rotate(${rotation}deg)`,
                  transition: 'transform 0.2s ease-out',
                }}
                className="max-h-[82vh] max-w-full object-contain rounded-xl filter blur-[1px] opacity-80 pointer-events-none select-none transition-all duration-300"
              />
            )}

            {/* High-Resolution Full Image: Preloaded or streaming; fades in seamlessly on load */}
            {fullUrl && (
              <img
                key={`full-${item._id}`}
                src={fullUrl}
                alt={item.filename}
                onLoad={() => {
                  setIsImageLoaded(true);
                  setLoading(false);
                }}
                onError={() => {
                  const streamUrl = getStreamUrl(item._id);
                  if (fullUrl && fullUrl !== streamUrl) {
                    setFullUrl(streamUrl);
                  } else {
                    setIsImageLoaded(false);
                    setLoading(false);
                    setImgError(true);
                  }
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setScale((s) => (s === 1 ? 2 : 1));
                }}
                style={{
                  transform: `scale(${scale}) rotate(${rotation}deg)`,
                  transition: 'transform 0.2s ease-out, opacity 0.3s ease-in',
                }}
                className={`max-h-[82vh] max-w-full object-contain rounded-xl shadow-2xl cursor-zoom-in ${
                  isImageLoaded ? 'opacity-100' : 'opacity-0 absolute inset-0 m-auto'
                }`}
              />
            )}
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

      {/* Bottom Action Bar with Safe Area Inset */}
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full bg-gradient-to-t from-black via-black/80 to-transparent pb-[max(1.25rem,env(safe-area-inset-bottom,0px))] pt-3 px-3 flex items-center justify-around sm:justify-center sm:space-x-12 z-50 transition-opacity duration-200 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Favorite */}
        {onToggleFavorite && (
          <button
            onClick={onToggleFavorite}
            className="flex flex-col items-center space-y-1 text-white hover:text-red-400 transition group active:scale-90"
          >
            <div className="p-2 rounded-full group-hover:bg-white/10">
              <Heart className={`w-5 h-5 ${item.isFavorite ? 'fill-red-500 text-red-500' : ''}`} />
            </div>
            <span className="text-[10px] text-zinc-400 group-hover:text-white">Favorite</span>
          </button>
        )}

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

        {/* Send to Device (Visible on Desktop / Tablets, in More Menu on Mobile) */}
        {onOpenForceDownload && (
          <button
            onClick={onOpenForceDownload}
            className="hidden sm:flex flex-col items-center space-y-1 text-white hover:text-purple-400 transition group active:scale-90"
            title="Force Download to Paired Device"
          >
            <div className="p-2 rounded-full group-hover:bg-white/10">
              <Smartphone className="w-5 h-5 text-purple-400" />
            </div>
            <span className="text-[10px] text-zinc-400 group-hover:text-white">Send to Device</span>
          </button>
        )}

        {/* Details */}
        {onOpenDetails && (
          <button
            onClick={onOpenDetails}
            className="flex flex-col items-center space-y-1 text-white hover:text-purple-400 transition group active:scale-90"
          >
            <div className="p-2 rounded-full group-hover:bg-white/10">
              <Info className="w-5 h-5" />
            </div>
            <span className="text-[10px] text-zinc-400 group-hover:text-white">Details</span>
          </button>
        )}

        {/* Delete */}
        {onDelete && (
          <button
            onClick={onDelete}
            className="flex flex-col items-center space-y-1 text-white hover:text-red-400 transition group active:scale-90"
          >
            <div className="p-2 rounded-full group-hover:bg-white/10">
              <Trash2 className="w-5 h-5" />
            </div>
            <span className="text-[10px] text-zinc-400 group-hover:text-white">Delete</span>
          </button>
        )}
      </div>
    </div>,
    document.body
  );
};

// ----------------------------------------------------
// Photo Details Modal
// ----------------------------------------------------
export const PhotoDetailsModal: React.FC<{ item: FileItem; onClose: () => void }> = ({ item, onClose }) => {
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
      : null);
  const backedUpFrom = item.sourceDeviceName || null;
  const storageAccount = item.storageAccountName || 'myDrive Cloud Storage';

  return createPortal(
    <div className="fixed inset-0 bg-black/85 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
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

          {location && (
            <div>
              <p className="text-zinc-500 font-semibold text-[11px]">Location</p>
              <p className="text-zinc-200 mt-0.5">{location}</p>
            </div>
          )}

          {backedUpFrom && (
            <div>
              <p className="text-zinc-500 font-semibold text-[11px]">Backed up from</p>
              <p className="text-zinc-200 mt-0.5">{backedUpFrom}</p>
            </div>
          )}

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
    </div>,
    document.body
  );
};
