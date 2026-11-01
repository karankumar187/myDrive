import React, { useState, useEffect, useMemo } from 'react';
import { FileItem, AlbumItem } from '../../types.js';
import {
  X,
  MapPin,
  Calendar,
  Image as ImageIcon,
  Check,
  Search,
  Sparkles,
  Loader2,
  CheckSquare,
  Square,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { getPreviewUrl } from '../../utils/format.js';
import { isVideoFile } from '../../services/media-cache.js';

interface AlbumCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (album: AlbumItem) => void;
  allMedia: FileItem[];
  initialSelectedIds?: string[];
  initialSuggestion?: {
    suggestedTitle?: string;
    startDate?: string | Date;
    endDate?: string | Date;
    sampleFileIds?: string[];
  };
}

export const AlbumCreateModal: React.FC<AlbumCreateModalProps> = ({
  isOpen,
  onClose,
  onCreated,
  allMedia,
  initialSelectedIds = [],
  initialSuggestion,
}) => {
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [coverFileId, setCoverFileId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync initial inputs or suggestion
  useEffect(() => {
    if (initialSuggestion) {
      if (initialSuggestion.suggestedTitle) setTitle(initialSuggestion.suggestedTitle);
      if (initialSuggestion.startDate) {
        setStartDate(new Date(initialSuggestion.startDate).toISOString().slice(0, 10));
      }
      if (initialSuggestion.endDate) {
        setEndDate(new Date(initialSuggestion.endDate).toISOString().slice(0, 10));
      }
      if (initialSuggestion.sampleFileIds && initialSuggestion.sampleFileIds.length > 0) {
        setSelectedFileIds(new Set(initialSuggestion.sampleFileIds));
        setCoverFileId(initialSuggestion.sampleFileIds[0]);
      }
    } else if (initialSelectedIds.length > 0) {
      setSelectedFileIds(new Set(initialSelectedIds));
      setCoverFileId(initialSelectedIds[0]);
    }
  }, [initialSuggestion, initialSelectedIds]);

  // Filter media for photo picker
  const filteredMedia = useMemo(() => {
    if (!searchQuery.trim()) return allMedia;
    const q = searchQuery.toLowerCase();
    return allMedia.filter((f) => f.filename.toLowerCase().includes(q));
  }, [allMedia, searchQuery]);

  const toggleFile = (id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        if (coverFileId === id) {
          const remaining = Array.from(next);
          setCoverFileId(remaining.length > 0 ? remaining[0] : null);
        }
      } else {
        next.add(id);
        if (!coverFileId) setCoverFileId(id);
      }
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      filteredMedia.forEach((f) => next.add(f._id));
      if (!coverFileId && filteredMedia.length > 0) {
        setCoverFileId(filteredMedia[0]._id);
      }
      return next;
    });
  };

  const deselectAllFiltered = () => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      filteredMedia.forEach((f) => next.delete(f._id));
      if (coverFileId && !next.has(coverFileId)) {
        const remaining = Array.from(next);
        setCoverFileId(remaining.length > 0 ? remaining[0] : null);
      }
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Trip/Album title is required');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);

      const fileIdsArray = Array.from(selectedFileIds);
      const res = await api.createAlbum({
        title: title.trim(),
        destination: { name: destination.trim() },
        description: description.trim(),
        startDate: startDate ? new Date(startDate).toISOString() : null,
        endDate: endDate ? new Date(endDate).toISOString() : null,
        fileIds: fileIdsArray,
        coverFileId: coverFileId || (fileIdsArray.length > 0 ? fileIdsArray[0] : undefined),
      });

      onCreated(res.album);
      onClose();
    } catch (err: any) {
      console.error('Failed to create album:', err);
      setError(err.message || 'Failed to create album');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col rounded-3xl bg-neutral-900 border border-white/15 shadow-2xl overflow-hidden text-neutral-100">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-neutral-900/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-purple-600/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Create Trip Album</h2>
              <p className="text-xs text-neutral-400">Curate photos into a narrative collection</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Core Info Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                Trip / Album Title <span className="text-purple-400">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Kyoto Autumn Expedition"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800/80 border border-white/10 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-sm text-white placeholder-neutral-500 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                Destination / Location
              </label>
              <div className="relative">
                <MapPin className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3" />
                <input
                  type="text"
                  placeholder="e.g. Kyoto, Japan"
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-neutral-800/80 border border-white/10 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-sm text-white placeholder-neutral-500 outline-none transition-all"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-neutral-800/80 border border-white/10 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-sm text-neutral-200 outline-none transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-300 mb-1.5">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-neutral-800/80 border border-white/10 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-sm text-neutral-200 outline-none transition-all"
              />
            </div>
          </div>

          {/* Photo Picker Section */}
          <div className="pt-3 border-t border-white/10">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3.5">
              <div>
                <span className="text-xs font-semibold text-white tracking-wide uppercase">
                  Select Memories ({selectedFileIds.size} selected)
                </span>
                <p className="text-[11px] text-neutral-400">
                  Pick photos to include. Hover a photo to set it as the primary cover.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAllFiltered}
                  className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-300 transition-colors"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={deselectAllFiltered}
                  className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs text-neutral-400 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Search media */}
            <div className="relative mb-3">
              <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Filter by filename..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-neutral-800/60 border border-white/10 text-xs text-neutral-200 placeholder-neutral-500 outline-none focus:border-purple-500"
              />
            </div>

            {/* Media Thumbnails Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2.5 max-h-[300px] overflow-y-auto p-1 rounded-xl bg-neutral-950/40 border border-white/5">
              {filteredMedia.length === 0 ? (
                <div className="col-span-full py-12 text-center text-xs text-neutral-500">
                  No media items available to select.
                </div>
              ) : (
                filteredMedia.map((file) => {
                  const isSelected = selectedFileIds.has(file._id);
                  const isCover = coverFileId === file._id;
                  const previewUrl = getPreviewUrl(file._id);

                  return (
                    <div
                      key={file._id}
                      onClick={() => toggleFile(file._id)}
                      className={`group relative aspect-square rounded-xl overflow-hidden cursor-pointer border transition-all ${
                        isSelected
                          ? 'border-purple-500 ring-2 ring-purple-500/60'
                          : 'border-white/10 hover:border-white/30 opacity-70 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={previewUrl}
                        alt={file.filename}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />

                      {/* Check badge */}
                      <div
                        className={`absolute top-1.5 right-1.5 w-5 h-5 rounded-md flex items-center justify-center transition-all ${
                          isSelected
                            ? 'bg-purple-600 text-white'
                            : 'bg-black/50 text-transparent group-hover:text-white/40'
                        }`}
                      >
                        <Check className="w-3 h-3" />
                      </div>

                      {/* Cover badge or Set as Cover button */}
                      {isSelected && (
                        <div className="absolute bottom-1 inset-x-1 flex justify-center z-10">
                          {isCover ? (
                            <span className="px-1.5 py-0.5 rounded-md bg-purple-600/90 backdrop-blur-md text-[9px] font-semibold text-white uppercase tracking-wider shadow">
                              Cover
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setCoverFileId(file._id);
                              }}
                              className="px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[9px] text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-black transition-opacity"
                            >
                              Make Cover
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </form>

        {/* Footer actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-white/10 bg-neutral-900/80">
          <span className="text-xs text-neutral-400">
            {selectedFileIds.size} media items included
          </span>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl text-xs font-medium text-neutral-300 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !title.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-xs font-semibold text-white shadow-lg shadow-purple-500/25 disabled:opacity-50 transition-all"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Trip Album'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
