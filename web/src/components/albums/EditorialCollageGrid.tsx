import React, { useState, useMemo, useCallback } from 'react';
import { FileItem } from '../../types.js';
import { Play, Heart, Check, Sparkles, Image as ImageIcon } from 'lucide-react';
import { getPreviewUrl, formatDate } from '../../utils/format.js';
import { api } from '../../services/api.js';
import { mediaCache, isVideoFile } from '../../services/media-cache.js';

interface EditorialCollageGridProps {
  files: FileItem[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onItemClick: (item: FileItem, index: number) => void;
  onToggleFavorite?: (item: FileItem, e: React.MouseEvent) => void;
}

// Ultra-fast 120 FPS virtualized editorial tile
const EditorialTile = React.memo<{
  file: FileItem;
  index: number;
  isSelected: boolean;
  onToggleSelect?: (id: string) => void;
  onClick: () => void;
  onToggleFavorite?: (item: FileItem, e: React.MouseEvent) => void;
}>(({ file, index, isSelected, onToggleSelect, onClick, onToggleFavorite }) => {
  const isVideo = isVideoFile(file.mimeType || file.filename);
  const [loadError, setLoadError] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  // Instant 0ms thumbnail from metadata or cache
  const thumbUrl = useMemo(() => {
    if (file.metadata?.thumbnail && file.metadata.thumbnail.startsWith('data:image/')) {
      return file.metadata.thumbnail;
    }
    return (
      mediaCache.getThumbnail(file._id) ||
      mediaCache.get(file._id) ||
      api.getThumbnailUrl(file._id)
    );
  }, [file._id, file.metadata?.thumbnail]);

  const activeSrc = fallbackUrl || thumbUrl;

  // Magazine style cadence pattern (0 to 7)
  const pattern = index % 8;

  // Formatted date or year
  const dateStr = useMemo(() => {
    if (!file.createdAt) return null;
    try {
      const d = new Date(file.createdAt);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    } catch {
      return null;
    }
  }, [file.createdAt]);

  const handleSelectClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleSelect?.(file._id);
    },
    [onToggleSelect, file._id]
  );

  const handleFavClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleFavorite?.(file, e);
    },
    [onToggleFavorite, file]
  );

  // Number badge formatted e.g. "№ 01"
  const formattedIndex = `№ ${String(index + 1).padStart(2, '0')}`;

  // Pattern 5 is a stylish Matte Polaroid / Gallery Print Card
  if (pattern === 5) {
    return (
      <div
        onClick={onClick}
        style={{
          contentVisibility: 'auto',
          containIntrinsicSize: '280px',
          transform: 'translateZ(0)',
        }}
        className={`group relative break-inside-avoid mb-4 rounded-3xl p-2.5 pb-4 bg-neutral-900/90 border transition-all duration-200 cursor-pointer select-none shadow-xl ${
          isSelected
            ? 'border-purple-500 ring-2 ring-purple-500/80 shadow-purple-500/20'
            : 'border-white/10 hover:border-white/30 hover:shadow-2xl'
        }`}
      >
        {/* Photo Container */}
        <div className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-neutral-950">
          {!loadError ? (
            <img
              src={activeSrc}
              alt={file.filename}
              loading="lazy"
              decoding="async"
              style={{ imageOrientation: 'from-image' }}
              className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
              onError={() => {
                if (!fallbackUrl) setFallbackUrl(getPreviewUrl(file._id));
                else setLoadError(true);
              }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-600">
              <span className="text-xs">Unavailable</span>
            </div>
          )}

          {/* Top Plate Badge */}
          <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-[9px] font-mono font-bold text-neutral-300">
            {formattedIndex}
          </div>

          {/* Video Indicator */}
          {isVideo && (
            <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-black/80 border border-white/20 flex items-center gap-1">
              <Play className="w-2.5 h-2.5 text-purple-400 fill-current" />
              <span className="text-[9px] font-bold text-white uppercase">Video</span>
            </div>
          )}

          {/* Selection Checkbox */}
          {onToggleSelect && (
            <div
              onClick={handleSelectClick}
              className={`absolute top-2 right-2 w-6 h-6 rounded-lg flex items-center justify-center transition-all z-20 ${
                isSelected
                  ? 'bg-purple-600 border border-purple-400 text-white shadow'
                  : 'bg-black/60 border border-white/20 text-transparent opacity-0 group-hover:opacity-100 hover:border-white'
              }`}
            >
              <Check className={`w-3.5 h-3.5 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
            </div>
          )}
        </div>

        {/* Gallery Print Caption Bar */}
        <div className="mt-2.5 px-1 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <p className="text-xs font-semibold text-neutral-200 truncate tracking-tight">
              {file.filename}
            </p>
            {dateStr && (
              <p className="text-[10px] text-neutral-400 font-mono tracking-wider uppercase">
                {dateStr}
              </p>
            )}
          </div>

          {onToggleFavorite && (
            <button
              onClick={handleFavClick}
              className={`p-1.5 rounded-full border transition-all ${
                file.isFavorite
                  ? 'bg-rose-600/90 border-rose-400 text-white'
                  : 'bg-black/40 border-white/10 text-white/60 hover:text-white hover:bg-black'
              }`}
            >
              <Heart className={`w-3.5 h-3.5 ${file.isFavorite ? 'fill-current' : ''}`} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Proportions according to editorial rhythm
  let aspectClass = 'aspect-[4/5]';
  let isHeroStory = false;
  let isPanoramic = false;
  let isTallStory = false;

  switch (pattern) {
    case 0:
      aspectClass = 'aspect-[3/4]';
      isHeroStory = true;
      break;
    case 2:
      aspectClass = 'aspect-[16/10]';
      isPanoramic = true;
      break;
    case 4:
      aspectClass = 'aspect-[9/16]';
      isTallStory = true;
      break;
    case 6:
      aspectClass = 'aspect-[4/3]';
      break;
    case 1:
    case 7:
      aspectClass = 'aspect-[4/5]';
      break;
    case 3:
    default:
      aspectClass = 'aspect-square';
      break;
  }

  return (
    <div
      onClick={onClick}
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '240px',
        transform: 'translateZ(0)',
      }}
      className={`group relative break-inside-avoid mb-4 rounded-3xl overflow-hidden cursor-pointer bg-[#111116] border transition-all duration-200 select-none ${aspectClass} ${
        isSelected
          ? 'border-purple-500 ring-2 ring-purple-500/80 shadow-xl shadow-purple-500/25'
          : isHeroStory
          ? 'border-purple-500/30 hover:border-purple-400/60 shadow-lg'
          : 'border-white/10 hover:border-white/30 hover:shadow-xl'
      }`}
    >
      {/* Media Image with smooth hover scale */}
      {!loadError ? (
        <img
          src={activeSrc}
          alt={file.filename}
          loading="lazy"
          decoding="async"
          style={{ imageOrientation: 'from-image' }}
          className="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          onError={() => {
            if (!fallbackUrl) setFallbackUrl(getPreviewUrl(file._id));
            else setLoadError(true);
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-600">
          <span className="text-xs">Unavailable</span>
        </div>
      )}

      {/* Deep Editorial Gradient Overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/30 opacity-40 group-hover:opacity-85 transition-opacity duration-200 pointer-events-none" />

      {/* Top Left: Editorial Sequence Number & Badges */}
      <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10 pointer-events-none">
        <div className="px-2 py-0.5 rounded-full bg-black/60 backdrop-blur-md border border-white/20 text-[10px] font-mono font-bold text-neutral-200 shadow-md">
          {formattedIndex}
        </div>

        {isHeroStory && (
          <div className="px-2 py-0.5 rounded-full bg-purple-600/80 backdrop-blur-md border border-purple-400/40 text-[9px] font-bold text-white tracking-widest uppercase flex items-center gap-1 shadow-md">
            <Sparkles className="w-2.5 h-2.5" />
            <span>Featured</span>
          </div>
        )}

        {isPanoramic && (
          <div className="px-2 py-0.5 rounded-full bg-indigo-600/75 backdrop-blur-md border border-indigo-400/40 text-[9px] font-bold text-white tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-opacity">
            Panorama
          </div>
        )}

        {isTallStory && (
          <div className="px-2 py-0.5 rounded-full bg-pink-600/75 backdrop-blur-md border border-pink-400/40 text-[9px] font-bold text-white tracking-widest uppercase opacity-0 group-hover:opacity-100 transition-opacity">
            Story
          </div>
        )}
      </div>

      {/* Video Indicator */}
      {isVideo && (
        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-black/80 border border-white/20 flex items-center gap-1 shadow pointer-events-none z-10">
          <Play className="w-2.5 h-2.5 text-purple-400 fill-current" />
          <span className="text-[9px] font-bold text-white uppercase">Video</span>
        </div>
      )}

      {/* Multi-Selection Checkbox */}
      {onToggleSelect && (
        <div
          onClick={handleSelectClick}
          className={`absolute top-3 right-3 w-6 h-6 rounded-xl flex items-center justify-center transition-all z-20 ${
            isSelected
              ? 'bg-purple-600 border border-purple-400 text-white shadow-md'
              : 'bg-black/60 border border-white/20 text-transparent opacity-0 group-hover:opacity-100 hover:border-white'
          }`}
        >
          <Check className={`w-3.5 h-3.5 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
        </div>
      )}

      {/* Bottom Editorial Caption & Metadata */}
      <div className="absolute bottom-0 inset-x-0 p-3.5 flex items-end justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-200 z-10">
        <div className="min-w-0 pr-2 pointer-events-none">
          <p className="text-xs font-semibold text-white truncate drop-shadow-md tracking-tight">
            {file.filename}
          </p>
          {dateStr && (
            <p className="text-[10px] text-neutral-300 font-mono tracking-wider uppercase drop-shadow">
              {dateStr}
            </p>
          )}
        </div>

        {onToggleFavorite && (
          <button
            onClick={handleFavClick}
            className={`p-2 rounded-full border pointer-events-auto transition-all ${
              file.isFavorite
                ? 'bg-rose-600/90 border-rose-400 text-white shadow-md'
                : 'bg-black/70 border-white/20 text-white/70 hover:text-white hover:bg-black'
            }`}
          >
            <Heart className={`w-3.5 h-3.5 ${file.isFavorite ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>
    </div>
  );
});

export const EditorialCollageGrid: React.FC<EditorialCollageGridProps> = ({
  files,
  selectedIds = new Set(),
  onToggleSelect,
  onItemClick,
  onToggleFavorite,
}) => {
  return (
    <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-4 [column-fill:_balance]">
      {files.map((file, idx) => (
        <EditorialTile
          key={file._id}
          file={file}
          index={idx}
          isSelected={selectedIds.has(file._id)}
          onToggleSelect={onToggleSelect}
          onClick={() => onItemClick(file, idx)}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  );
};
