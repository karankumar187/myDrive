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

// Memoized tile to prevent re-rendering unchanged photos
const CollageTile = React.memo<{
  file: FileItem;
  index: number;
  isSelected: boolean;
  onToggleSelect?: (id: string) => void;
  onClick: () => void;
  onToggleFavorite?: (item: FileItem, e: React.MouseEvent) => void;
}>(({ file, index, isSelected, onToggleSelect, onClick, onToggleFavorite }) => {
  const isVideo = isVideoFile(file.mimeType || file.filename);
  const [highResLoaded, setHighResLoaded] = useState(false);

  // 1. Instant 0ms thumbnail from metadata or cache
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

  // 2. High-res preview URL (2048px WebP) for crisp viewing
  const previewUrl = useMemo(() => getPreviewUrl(file._id), [file._id]);

  // Layout span class
  const spanClass = useMemo(() => {
    const pattern = index % 6;
    switch (pattern) {
      case 0:
        return 'md:col-span-1 md:row-span-2 min-h-[360px] md:min-h-[480px]';
      case 3:
        return 'md:col-span-2 min-h-[240px] md:min-h-[290px]';
      default:
        return 'col-span-1 min-h-[220px] md:min-h-[230px]';
    }
  }, [index]);

  return (
    <div
      onClick={onClick}
      style={{ contentVisibility: 'auto', containIntrinsicSize: '240px' }}
      className={`group relative rounded-2xl overflow-hidden cursor-pointer bg-neutral-900 border transition-all duration-300 ease-out select-none ${spanClass} ${
        isSelected
          ? 'border-purple-500 ring-2 ring-purple-500/50 shadow-lg shadow-purple-500/20'
          : 'border-white/[0.07] hover:border-white/30 hover:shadow-xl hover:shadow-black/60'
      }`}
    >
      {/* 1. Base Layer: Instant Low-Latency Thumbnail */}
      <img
        src={thumbUrl}
        alt={file.filename}
        loading="lazy"
        decoding="async"
        className={`absolute inset-0 w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-105 ${
          highResLoaded ? 'opacity-0' : 'opacity-100'
        }`}
      />

      {/* 2. Top Layer: High-Res WebP Preview that fades in seamlessly once ready */}
      <img
        src={previewUrl}
        alt={file.filename}
        loading="lazy"
        decoding="async"
        onLoad={() => setHighResLoaded(true)}
        className={`absolute inset-0 w-full h-full object-cover transition-all duration-500 ease-out group-hover:scale-105 ${
          highResLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Subtle Gradient Overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

      {/* Video Indicator Pill */}
      {isVideo && (
        <div className="absolute top-3 left-3 px-2 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center gap-1.5 shadow-md z-10">
          <Play className="w-3 h-3 text-purple-400 fill-current" />
          <span className="text-[10px] font-semibold text-white tracking-wider uppercase">
            Video
          </span>
        </div>
      )}

      {/* Multi-Selection Checkbox */}
      {onToggleSelect && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(file._id);
          }}
          className={`absolute top-3 right-3 w-6 h-6 rounded-lg flex items-center justify-center transition-all z-20 ${
            isSelected
              ? 'bg-purple-600 border border-purple-400 text-white shadow-md'
              : 'bg-black/50 border border-white/20 text-transparent opacity-0 group-hover:opacity-100 hover:border-white'
          }`}
        >
          <Check className={`w-3.5 h-3.5 ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
        </div>
      )}

      {/* Bottom Meta Bar on Hover */}
      <div className="absolute bottom-0 inset-x-0 p-3 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10">
        <span className="text-xs text-neutral-200 font-medium truncate max-w-[70%] drop-shadow-md">
          {file.filename}
        </span>

        {onToggleFavorite && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(file, e);
            }}
            className={`p-1.5 rounded-full backdrop-blur-md border transition-all ${
              file.isFavorite
                ? 'bg-rose-600/80 border-rose-400 text-white'
                : 'bg-black/50 border-white/20 text-white/70 hover:text-white hover:bg-black/70'
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
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3.5 md:gap-4 auto-rows-[220px] grid-flow-dense">
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
