import React, { useState, useMemo } from 'react';
import { AlbumItem } from '../../types.js';
import {
  MapPin,
  Calendar,
  Image as ImageIcon,
  Film,
  Smartphone,
  Laptop,
  Camera,
  Heart,
  MoreVertical,
  Pin,
  Trash2,
  Edit2,
  Sparkles,
} from 'lucide-react';
import { getPreviewUrl, formatBytes } from '../../utils/format.js';
import { api } from '../../services/api.js';
import { mediaCache } from '../../services/media-cache.js';

interface AlbumCardProps {
  album: AlbumItem;
  isFeatured?: boolean;
  onClick: () => void;
  onToggleFavorite?: (e: React.MouseEvent) => void;
  onTogglePin?: (e: React.MouseEvent) => void;
  onEdit?: (e: React.MouseEvent) => void;
  onDelete?: (e: React.MouseEvent) => void;
}

export const AlbumCard: React.FC<AlbumCardProps> = ({
  album,
  isFeatured = false,
  onClick,
  onToggleFavorite,
  onTogglePin,
  onEdit,
  onDelete,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  // Instant 0ms thumbnail from metadata or cache
  const thumbUrl = useMemo(() => {
    if (album.coverFile?.metadata?.thumbnail && album.coverFile.metadata.thumbnail.startsWith('data:image/')) {
      return album.coverFile.metadata.thumbnail;
    }
    if (album.coverFile?._id) {
      return mediaCache.getThumbnail(album.coverFile._id) || api.getThumbnailUrl(album.coverFile._id);
    }
    return null;
  }, [album.coverFile]);

  const activeSrc = fallbackUrl || thumbUrl;

  // Format dates
  const formatAlbumDates = () => {
    if (!album.startDate && !album.endDate) return null;
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

  const albumDateStr = formatAlbumDates();

  const getDeviceIcon = (platform?: string) => {
    const p = (platform || '').toLowerCase();
    if (p.includes('iphone') || p.includes('android') || p.includes('mobile')) {
      return <Smartphone className="w-3 h-3 text-purple-300" />;
    }
    if (p.includes('mac') || p.includes('windows') || p.includes('desktop')) {
      return <Laptop className="w-3 h-3 text-blue-300" />;
    }
    return <Camera className="w-3 h-3 text-emerald-300" />;
  };

  return (
    <div
      onClick={onClick}
      className={`group relative overflow-hidden rounded-[26px] cursor-pointer transition-all duration-300 ease-out border border-white/[0.08] hover:border-purple-500/40 hover:shadow-2xl hover:shadow-purple-500/10 ${
        isFeatured
          ? 'w-full h-[400px] md:h-[460px]'
          : 'w-full h-[320px] sm:h-[350px]'
      }`}
    >
      {/* Background Cover Image */}
      <div className="absolute inset-0 bg-neutral-900 overflow-hidden" style={{ transform: 'translateZ(0)' }}>
        {activeSrc && !imageError ? (
          <img
            src={activeSrc}
            alt={album.title}
            loading="lazy"
            decoding="async"
            style={{ imageOrientation: 'from-image' }}
            onError={() => {
              if (!fallbackUrl && album.coverFile?._id) {
                setFallbackUrl(getPreviewUrl(album.coverFile._id));
              } else {
                setImageError(true);
              }
            }}
            className="w-full h-full object-cover transition-transform duration-300 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-purple-900/40 via-neutral-900 to-indigo-950/60 flex items-center justify-center">
            <ImageIcon className="w-16 h-16 text-white/20" />
          </div>
        )}

        {/* Ambient Gradient Shadows & Vignette */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/30 pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-transparent pointer-events-none" />
      </div>

      {/* Top Floating Glass Badges */}
      <div className="absolute top-4 inset-x-4 flex items-center justify-between z-10">
        {album.destination?.name ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/15 text-xs font-medium text-white shadow-lg">
            <MapPin className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="truncate max-w-[180px] sm:max-w-[240px]">
              {album.destination.name}
            </span>
          </div>
        ) : (
          <div />
        )}

        {/* Action controls (Pin, Favorite, More Menu) */}
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          {onTogglePin && (
            <button
              onClick={onTogglePin}
              title={album.isPinned ? 'Unpin album' : 'Pin album'}
              className={`p-2 rounded-full backdrop-blur-md border transition-all ${
                album.isPinned
                  ? 'bg-purple-600/80 border-purple-400 text-white'
                  : 'bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'
              }`}
            >
              <Pin className="w-3.5 h-3.5 fill-current" />
            </button>
          )}

          {onToggleFavorite && (
            <button
              onClick={onToggleFavorite}
              title={album.isFavorite ? 'Remove from favorites' : 'Favorite album'}
              className={`p-2 rounded-full backdrop-blur-md border transition-all ${
                album.isFavorite
                  ? 'bg-rose-600/80 border-rose-400 text-white'
                  : 'bg-black/40 border-white/10 text-white/70 hover:text-white hover:bg-black/60'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${album.isFavorite ? 'fill-current' : ''}`} />
            </button>
          )}

          {(onEdit || onDelete) && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-md border border-white/10 text-white/70 hover:text-white transition-all"
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>

              {menuOpen && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div className="absolute right-0 mt-1.5 w-36 rounded-xl bg-neutral-900/95 backdrop-blur-xl border border-white/15 shadow-2xl py-1 z-30 overflow-hidden text-xs">
                    {onEdit && (
                      <button
                        onClick={(e) => {
                          setMenuOpen(false);
                          onEdit(e);
                        }}
                        className="w-full px-3 py-2 text-left text-neutral-200 hover:bg-white/10 flex items-center gap-2 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5 text-neutral-400" />
                        Edit Details
                      </button>
                    )}
                    {onDelete && (
                      <button
                        onClick={(e) => {
                          setMenuOpen(false);
                          onDelete(e);
                        }}
                        className="w-full px-3 py-2 text-left text-red-400 hover:bg-red-500/10 flex items-center gap-2 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete Album
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Content Narrative Info */}
      <div className="absolute bottom-0 inset-x-0 p-5 md:p-6 z-10 flex flex-col justify-end">
        {/* Title */}
        <h3
          className={`font-bold text-white tracking-tight leading-snug line-clamp-1 mb-1.5 drop-shadow-md ${
            isFeatured ? 'text-2xl sm:text-3xl' : 'text-xl'
          }`}
        >
          {album.title}
        </h3>

        {/* Date Span */}
        {albumDateStr && (
          <div className="flex items-center gap-1.5 text-xs text-neutral-300/90 mb-3 font-medium">
            <Calendar className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
            <span>{albumDateStr}</span>
          </div>
        )}

        {/* Bottom Bar: Stats Pill + Device Contributor Avatars */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-white/10">
          {/* Media Count Pill */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.08] backdrop-blur-md text-[11px] font-medium text-neutral-200 border border-white/10">
            <ImageIcon className="w-3 h-3 text-purple-400" />
            <span>
              {album.fileCount} {album.fileCount === 1 ? 'item' : 'items'}
            </span>
          </div>

          {/* Overlapping Contributor Devices Avatars */}
          {album.contributors && album.contributors.length > 0 && (
            <div className="flex items-center -space-x-1.5">
              {album.contributors.slice(0, 3).map((dev, idx) => (
                <div
                  key={dev.deviceId || idx}
                  title={`${dev.deviceName} (${dev.platform})`}
                  className="w-6 h-6 rounded-full bg-neutral-900 border border-white/30 flex items-center justify-center shadow-md text-[10px] text-white"
                >
                  {getDeviceIcon(dev.platform)}
                </div>
              ))}
              {album.contributors.length > 3 && (
                <div className="w-6 h-6 rounded-full bg-neutral-800 border border-white/30 flex items-center justify-center text-[9px] font-semibold text-neutral-300">
                  +{album.contributors.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
