import React, { useState, useEffect, useRef } from 'react';
import { FileItem } from '../types.js';
import { Film, Calendar, Download, ShieldCheck, Lock, X, Loader2, Image as ImageIcon, Play } from 'lucide-react';
import { VaultCryptoService } from '../services/vault-crypto.js';
import { mediaCache, mediaQueue } from '../services/media-cache.js';

interface Props {
  media: FileItem[];
  vaultKey: CryptoKey | null;
  onOpenVault?: () => void;
}

interface LoadedMediaState {
  item: FileItem;
  displayUrl: string | null;
  isEncrypted: boolean;
  needsKey: boolean;
  error?: string | null;
}

const getStreamUrl = (fileId: string) => {
  const token = localStorage.getItem('drive_token') || '';
  const rawApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
  return `${rawApiUrl}/api/v1/files/${fileId}/stream?token=${encodeURIComponent(token)}`;
};

export const GalleryTimelineView: React.FC<Props> = ({ media, vaultKey, onOpenVault }) => {
  const [selectedMedia, setSelectedMedia] = useState<LoadedMediaState | null>(null);

  // Group media by Month & Year
  const groupedMedia = media.reduce((acc, item) => {
    const date = new Date(item.metadata?.takenAt || item.createdAt);
    const monthYear = date.toLocaleString('default', { month: 'long', year: 'numeric' });
    if (!acc[monthYear]) acc[monthYear] = [];
    acc[monthYear].push(item);
    return acc;
  }, {} as Record<string, FileItem[]>);

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#111114] p-5 rounded-2xl border border-[#222227] shadow-lg">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <ImageIcon className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">Media Timeline</h2>
          </div>
          <p className="text-xs text-zinc-400">{media.length} photos and videos across all pooled accounts</p>
        </div>
        {vaultKey ? (
          <button
            onClick={onOpenVault}
            className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-950/40 hover:bg-purple-900/40 text-purple-300 border border-purple-800/40 shadow-glow-purple transition active:scale-95"
            title="Zero-Knowledge Encryption Active - Click to manage"
          >
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5 text-purple-400" />
            Zero-Knowledge Decryption Active
          </button>
        ) : (
          <button
            onClick={onOpenVault}
            className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-[#181820] hover:bg-[#22222b] text-zinc-300 border border-[#272736] hover:border-purple-500/40 transition active:scale-95"
            title="Vault is locked - Click to enter Master Passphrase"
          >
            <Lock className="w-3.5 h-3.5 mr-1.5 text-amber-400" />
            Unlock Vault to View E2EE Media
          </button>
        )}
      </div>

      {media.length === 0 ? (
        <div className="bg-[#111114] rounded-2xl border border-[#222227] p-16 text-center space-y-2">
          <Calendar className="w-12 h-12 mx-auto text-zinc-700" />
          <p className="text-sm font-semibold text-zinc-200">No photos or videos backed up yet</p>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            Upload photos in Folder Explorer or back up from Android/iPhone to view your gallery here.
          </p>
        </div>
      ) : (
        Object.entries(groupedMedia).map(([groupTitle, items]) => (
          <div key={groupTitle} className="space-y-3">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider sticky top-0 bg-[#08080a]/90 backdrop-blur py-1.5 z-10 flex items-center space-x-2">
              <Calendar className="w-3.5 h-3.5 text-purple-400" />
              <span className="text-zinc-200">{groupTitle}</span>
              <span className="text-zinc-600">({items.length})</span>
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {items.map((item) => (
                <MediaCard
                  key={item._id}
                  item={item}
                  vaultKey={vaultKey}
                  onSelect={(loaded) => setSelectedMedia(loaded)}
                />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Lightbox Modal */}
      {selectedMedia && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={() => setSelectedMedia(null)}
        >
          <button
            onClick={() => setSelectedMedia(null)}
            className="absolute top-4 right-4 z-50 p-2 text-zinc-400 hover:text-white rounded-full bg-zinc-800/80 hover:bg-zinc-700 transition"
          >
            <X className="w-6 h-6" />
          </button>

          <div
            className="max-w-4xl max-h-[85vh] w-full flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {selectedMedia.needsKey ? (
              <div className="p-8 text-center bg-[#16161d] border border-purple-500/30 rounded-2xl max-w-md space-y-3 shadow-glow-purple">
                <div className="w-12 h-12 rounded-full bg-purple-950/60 border border-purple-800/50 flex items-center justify-center mx-auto text-purple-400">
                  <Lock className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-white">This media is encrypted with AES-256-GCM</h4>
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Please click &quot;Vault Locked&quot; in the top navigation bar and enter your Master Passphrase to decrypt and view this photo.
                </p>
              </div>
            ) : selectedMedia.error ? (
              <div className="p-8 text-center bg-[#16161d] border border-red-500/30 rounded-2xl max-w-md space-y-3">
                <h4 className="text-sm font-bold text-red-400">Unable to Load Media</h4>
                <p className="text-xs text-zinc-400">{selectedMedia.error}</p>
                <a
                  href={getStreamUrl(selectedMedia.item._id)}
                  download={selectedMedia.item.filename}
                  className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-full transition"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download File Directly</span>
                </a>
              </div>
            ) : selectedMedia.item.mimeType.startsWith('video/') ? (
              <LightboxVideoPlayer
                item={selectedMedia.item}
                vaultKey={vaultKey}
                initialThumb={selectedMedia.displayUrl}
              />
            ) : selectedMedia.displayUrl ? (
              <img
                src={selectedMedia.displayUrl}
                alt={selectedMedia.item.filename}
                className="max-h-[75vh] max-w-full object-contain rounded-2xl shadow-2xl"
              />
            ) : (
              <div className="p-8 text-white flex items-center space-x-2">
                <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
                <span className="text-xs text-zinc-400">Loading media...</span>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between w-full text-xs px-2">
              <div className="space-y-0.5">
                <p className="font-semibold text-white truncate max-w-[280px] sm:max-w-md">
                  {selectedMedia.item.filename}
                </p>
                <p className="text-zinc-500 text-[11px]">
                  Added on {new Date(selectedMedia.item.createdAt).toLocaleDateString()} •{' '}
                  {(selectedMedia.item.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                  {selectedMedia.isEncrypted && ' • E2EE Encrypted'}
                </p>
              </div>

              <a
                href={getStreamUrl(selectedMedia.item._id)}
                download={selectedMedia.item.filename}
                className="flex items-center space-x-1 px-3.5 py-1.5 bg-[#1a1a24] hover:bg-purple-600 border border-[#282838] hover:border-purple-500 text-zinc-200 hover:text-white rounded-full font-medium transition active:scale-95"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Helper to extract first frame from a video URL/Blob
function extractFrameFromVideoUrl(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.crossOrigin = 'anonymous';
      video.src = `${src}#t=0.2`;

      const cleanUp = () => {
        video.remove();
      };

      video.onloadeddata = () => {
        try {
          video.currentTime = Math.min(0.2, (video.duration || 1) / 2);
        } catch {
          cleanUp();
          resolve(null);
        }
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          const maxDim = 320;
          let w = video.videoWidth || 320;
          let h = video.videoHeight || 240;
          if (w > maxDim) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          }
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, w, h);
            const thumbData = canvas.toDataURL('image/jpeg', 0.75);
            cleanUp();
            resolve(thumbData);
            return;
          }
        } catch {}
        cleanUp();
        resolve(null);
      };

      video.onerror = () => {
        cleanUp();
        resolve(null);
      };

      setTimeout(() => {
        cleanUp();
        resolve(null);
      }, 4000);
    } catch {
      resolve(null);
    }
  });
}

// Lightbox Video Player that decrypts/streams on demand when clicked
const LightboxVideoPlayer: React.FC<{
  item: FileItem;
  vaultKey: CryptoKey | null;
  initialThumb?: string | null;
}> = ({ item, vaultKey, initialThumb }) => {
  const [videoUrl, setVideoUrl] = useState<string | null>(() => {
    const mem = mediaCache.get(item._id);
    return mem && !mem.startsWith('data:image') ? mem : null;
  });
  const [loading, setLoading] = useState(!videoUrl);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (videoUrl) return;

    let active = true;
    const version = item.versions?.[item.versions.length - 1];
    const encrypted = !!version?.isEncrypted;

    if (encrypted && !vaultKey) {
      setError('Master Passphrase required to decrypt this video');
      setLoading(false);
      return;
    }

    const loadVideo = async () => {
      try {
        const streamUrl = getStreamUrl(item._id);
        if (!encrypted) {
          if (active) {
            setVideoUrl(streamUrl);
            setLoading(false);
          }
          return;
        }

        const res = await fetch(streamUrl);
        if (!res.ok) throw new Error(`Stream error HTTP ${res.status}`);
        const ciphertext = await res.arrayBuffer();

        if (!version?.iv) throw new Error('Missing encryption IV');
        const decrypted = await VaultCryptoService.decryptBuffer(ciphertext, version.iv, vaultKey!);
        if (active) {
          const blobUrl = URL.createObjectURL(new Blob([decrypted], { type: item.mimeType || 'video/mp4' }));
          mediaCache.set(item._id, blobUrl);
          setVideoUrl(blobUrl);
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err.message || 'Failed to decrypt video');
          setLoading(false);
        }
      }
    };

    loadVideo();
    return () => {
      active = false;
    };
  }, [item._id, item.mimeType, item.versions, vaultKey, videoUrl]);

  if (error) {
    return (
      <div className="p-8 text-center bg-[#16161d] border border-red-500/30 rounded-2xl max-w-md space-y-3">
        <h4 className="text-sm font-bold text-red-400">Unable to Play Video</h4>
        <p className="text-xs text-zinc-400">{error}</p>
        <a
          href={getStreamUrl(item._id)}
          download={item.filename}
          className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-full transition"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Download File</span>
        </a>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="relative flex flex-col items-center justify-center p-12 bg-[#121218] rounded-2xl border border-[#22222a] min-w-[320px] sm:min-w-[480px] overflow-hidden">
        {initialThumb && (
          <img
            src={initialThumb}
            alt={item.filename}
            className="absolute inset-0 w-full h-full object-cover opacity-20 rounded-2xl blur-sm"
          />
        )}
        <div className="relative z-10 flex flex-col items-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          <p className="text-xs font-semibold text-zinc-200">Decrypting video for playback...</p>
          <p className="text-[11px] text-zinc-500">{(item.sizeBytes / (1024 * 1024)).toFixed(1)} MB • Zero-Knowledge E2EE</p>
        </div>
      </div>
    );
  }

  return (
    <video
      controls
      autoPlay
      src={videoUrl || ''}
      className="max-h-[75vh] max-w-full rounded-2xl shadow-2xl"
    />
  );
};

// Video Thumbnail Component that displays the first frame image
const VideoThumbnail: React.FC<{ src: string; alt: string }> = ({ src, alt }) => {
  return (
    <div className="relative w-full h-full bg-[#13131a] overflow-hidden flex items-center justify-center">
      <img
        src={src}
        alt={alt}
        className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
        loading="lazy"
      />

      {/* Center Play Button Overlay */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm border border-white/20 flex items-center justify-center text-white shadow-lg group-hover:scale-110 group-hover:bg-purple-600/90 group-hover:border-purple-400 transition duration-300">
          <Play className="w-4 h-4 fill-white ml-0.5" />
        </div>
      </div>
    </div>
  );
};

// Individual Media Card with Client-Side Decryption & Persistent Thumbnail Caching
const MediaCard: React.FC<{
  item: FileItem;
  vaultKey: CryptoKey | null;
  onSelect: (loaded: LoadedMediaState) => void;
}> = ({ item, vaultKey, onSelect }) => {
  const isVideo = item.mimeType.startsWith('video/');
  const [displayUrl, setDisplayUrl] = useState<string | null>(() => {
    if (isVideo) {
      return item.metadata?.thumbnail || mediaCache.getThumbnail(item._id);
    }
    return mediaCache.get(item._id) || null;
  });
  const [loading, setLoading] = useState(!displayUrl);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (displayUrl) {
      setLoading(false);
      return;
    }

    let active = true;

    const load = async () => {
      // 1. Instant check for video thumbnail in metadata or cache/localStorage (0ms)
      if (isVideo) {
        const cachedThumb = item.metadata?.thumbnail || mediaCache.getThumbnail(item._id);
        if (cachedThumb) {
          if (active) {
            setDisplayUrl(cachedThumb);
            setLoading(false);
          }
          return;
        }
      }

      // 2. Instant in-memory cache hit (0ms)
      const cachedUrl = mediaCache.get(item._id);
      if (cachedUrl) {
        if (active) {
          setDisplayUrl(cachedUrl);
          setLoading(false);
        }
        return;
      }

      const version = item.versions?.[item.versions.length - 1];
      const encrypted = !!version?.isEncrypted;
      setIsEncrypted(encrypted);

      if (encrypted && !vaultKey) {
        if (active) {
          setNeedsKey(true);
          setLoading(false);
        }
        return;
      }

      const streamUrl = getStreamUrl(item._id);

      // 3. For videos without thumbnail, process in controlled concurrency queue (max 2)
      if (isVideo) {
        try {
          await mediaQueue.enqueue(async () => {
            if (!active) return;
            let videoBlobUrl = streamUrl;

            if (encrypted && vaultKey && version?.iv) {
              const res = await fetch(streamUrl);
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const ciphertext = await res.arrayBuffer();
              const decrypted = await VaultCryptoService.decryptBuffer(ciphertext, version.iv, vaultKey);
              const blob = new Blob([decrypted], { type: item.mimeType || 'video/mp4' });
              videoBlobUrl = URL.createObjectURL(blob);
              mediaCache.set(item._id, videoBlobUrl);
            }

            const thumbData = await extractFrameFromVideoUrl(videoBlobUrl);
            if (thumbData) {
              mediaCache.saveThumbnail(item._id, thumbData);
              if (active) {
                setDisplayUrl(thumbData);
                setNeedsKey(false);
              }
            } else if (active) {
              setDisplayUrl(videoBlobUrl);
            }
          });
        } catch (err: any) {
          console.error('Failed to load video thumbnail:', item.filename, err);
          if (active) setError(err.message || 'Failed to load video');
        } finally {
          if (active) setLoading(false);
        }
        return;
      }

      // 4. For photos: fetch & decrypt
      try {
        const res = await fetch(streamUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        let objectUrl: string;
        if (encrypted && vaultKey) {
          const ciphertext = await res.arrayBuffer();
          if (version?.iv) {
            const decrypted = await VaultCryptoService.decryptBuffer(ciphertext, version.iv, vaultKey);
            if (active) {
              objectUrl = URL.createObjectURL(new Blob([decrypted], { type: item.mimeType }));
              mediaCache.set(item._id, objectUrl);
              setDisplayUrl(objectUrl);
              setNeedsKey(false);
            }
          }
        } else {
          const blob = await res.blob();
          if (active) {
            objectUrl = URL.createObjectURL(blob);
            mediaCache.set(item._id, objectUrl);
            setDisplayUrl(objectUrl);
          }
        }
      } catch (err: any) {
        console.error('Failed to load gallery item:', item.filename, err);
        if (active) setError(err.message || 'Failed to load');
      } finally {
        if (active) setLoading(false);
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [item._id, item.versions, item.mimeType, vaultKey, displayUrl, isVideo]);

  return (
    <div
      onClick={() => onSelect({ item, displayUrl, isEncrypted, needsKey, error })}
      className="group relative aspect-square bg-[#111114] border border-[#222227] hover:border-purple-500/50 rounded-2xl overflow-hidden cursor-pointer shadow-md transition duration-300"
    >
      {loading ? (
        <div className="w-full h-full flex items-center justify-center bg-[#141419] text-zinc-500">
          <Loader2 className="w-5 h-5 animate-spin text-purple-400" />
        </div>
      ) : needsKey ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-[#13131a] text-purple-400 p-2 text-center space-y-1">
          <Lock className="w-6 h-6" />
          <span className="text-[10px] text-zinc-400 font-medium">Locked E2EE</span>
        </div>
      ) : isVideo && displayUrl ? (
        <VideoThumbnail src={displayUrl} alt={item.filename} />
      ) : isVideo ? (
        <div className="w-full h-full flex items-center justify-center bg-[#13131a] text-zinc-300">
          <Film className="w-8 h-8 text-purple-400 group-hover:scale-110 transition duration-300" />
        </div>
      ) : displayUrl ? (
        <img
          src={displayUrl}
          alt={item.filename}
          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-[#141419] text-zinc-500">
          <ImageIcon className="w-6 h-6 text-zinc-600" />
        </div>
      )}

      {/* Overlay info */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition p-2.5 flex flex-col justify-end text-white text-[11px]">
        <p className="font-semibold truncate">{item.filename}</p>
        <p className="text-[10px] text-zinc-400">
          {item.sourceDeviceIds.length > 0 ? 'On phone & cloud' : 'Cloud only'}
          {isEncrypted && ' • Encrypted'}
        </p>
      </div>

      {/* Video indicator badge */}
      {isVideo && (
        <div className="absolute top-2 right-2 bg-black/70 border border-white/10 text-white text-[9px] px-1.5 py-0.5 rounded-full flex items-center space-x-1 backdrop-blur-sm">
          <Film className="w-2.5 h-2.5" />
          <span>VIDEO</span>
        </div>
      )}

      {/* Encrypted indicator badge */}
      {isEncrypted && (
        <div className="absolute top-2 left-2 bg-purple-950/80 border border-purple-800/60 text-purple-300 text-[9px] px-1.5 py-0.5 rounded-full flex items-center space-x-1 shadow-glow-purple backdrop-blur-sm">
          <ShieldCheck className="w-2.5 h-2.5 text-purple-400" />
          <span>E2EE</span>
        </div>
      )}
    </div>
  );
};
