import React, { useState, useMemo, useCallback } from 'react';
import { FileItem } from '../../types.js';
import { Play, Heart, Check } from 'lucide-react';
import { getPreviewUrl } from '../../utils/format.js';
import { api } from '../../services/api.js';
import { mediaCache, isVideoFile } from '../../services/media-cache.js';

interface EditorialCollageGridProps {
  files: FileItem[];
  selectedIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  onItemClick: (item: FileItem, index: number) => void;
  onToggleFavorite?: (item: FileItem, e: React.MouseEvent) => void;
}

// Ultra-fast 120 FPS virtualized tile
const CollageTile = React.memo<{
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

  // Instant 0ms thumbnail from metadata or cache (same as Timeline!)
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

  // Varied editorial aspect ratios without expensive grid-flow backtracking
  const aspectClass = useMemo(() => {
    const pattern = index % 5;
    switch (pattern) {
      case 0:
        return 'aspect-[4/5]'; // Tall portrait hero
      case 2:
        return 'aspect-[16/10]'; // Wide landscape
      default:
        return 'aspect-square'; // Balanced square
    }
  }, [index]);

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

  return (
    <div
      onClick={onClick}
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '240px',
        transform: 'translateZ(0)',
      }}
      className={`group relative break-inside-avoid mb-3.5 rounded-2xl overflow-hidden cursor-pointer bg-[#121217] border transition-transform duration-100 active:scale-95 select-none ${aspectClass} ${
        isSelected
          ? 'border-purple-500 ring-2 ring-purple-500/80 shadow-lg shadow-purple-500/20'
          : 'border-[#202028] hover:border-white/30'
      }`}
    >
      {/* Fast, lightweight media image */}
      {!loadError ? (
        <img
          src={activeSrc}
          alt={file.filename}
          loading="lazy"
          decoding="async"
          style={{ imageOrientation: 'from-image' }}
          className="w-full h-full object-cover"
          onError={() => {
            if (!fallbackUrl) {
              setFallbackUrl(getPreviewUrl(file._id));
            } else {
              setLoadError(true);
            }
          }}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-neutral-900 text-neutral-600">
          <span className="text-xs">Unavailable</span>
        </div>
      )}

      {/* Subtle hover gradient */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none" />

      {/* Video Indicator (solid background to prevent GPU blur stalls) */}
      {isVideo && (
        <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-full bg-black/80 border border-white/20 flex items-center gap-1.5 shadow pointer-events-none z-10">
          <Play className="w-2.5 h-2.5 text-purple-400 fill-current" />
          <span className="text-[9px] font-bold text-white tracking-wider uppercase">
            Video
          </span>
        </div>
      )}

      {/* Multi-Selection Checkbox */}
      {onToggleSelect && (
        <div
          onClick={handleSelectClick}
          className={`absolute top-2.5 right-2.5 w-6 h-6 rounded-lg flex items-center justify-center transition-all z-20 ${
            isSelected
              ? 'bg-purple-600 border border-purple-400 text-white shadow-md'
              : 'bg-black/60 border border-white/20 text-transparent opacity-0 group-hover:opacity-100 hover:border-white'
          }`}
        >
          <Check className={`w-3.5 h-3.5 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
        </div>
      )}

      {/* Bottom Meta Bar on Hover */}
      <div className="absolute bottom-0 inset-x-0 p-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-10 pointer-events-none">
        <span className="text-xs text-neutral-200 font-medium truncate max-w-[70%] drop-shadow">
          {file.filename}
        </span>

        {onToggleFavorite && (
          <button
            onClick={handleFavClick}
            className={`p-1.5 rounded-full border pointer-events-auto transition-all ${
              file.isFavorite
                ? 'bg-rose-600/90 border-rose-400 text-white'
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
    <div className="columns-2 sm:columns-3 md:columns-4 lg:columns-5 gap-3.5 [column-fill:_balance]">
      {files.map((file, idx) => (
        <CollageTile
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
