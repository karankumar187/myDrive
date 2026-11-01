import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlbumDetailItem, AlbumItem, FileItem } from '../../types.js';
import {
  X,
  MapPin,
  Calendar,
  Image as ImageIcon,
  Check,
  Loader2,
  Sparkles,
  Palette,
  FileText,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { mediaCache } from '../../services/media-cache.js';

interface AlbumEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  album: AlbumDetailItem | AlbumItem;
  files?: FileItem[];
  onSaved: (updatedAlbum: Partial<AlbumDetailItem>) => void;
}

const THEME_GRADIENTS = [
  { id: 'violet', label: 'Deep Violet', value: 'from-purple-900/60 via-indigo-950/40 to-black', bg: 'bg-purple-950' },
  { id: 'sunset', label: 'Sunset Glow', value: 'from-rose-900/60 via-orange-950/40 to-black', bg: 'bg-rose-950' },
  { id: 'ocean', label: 'Midnight Blue', value: 'from-blue-900/60 via-cyan-950/40 to-black', bg: 'bg-blue-950' },
  { id: 'emerald', label: 'Emerald Forest', value: 'from-emerald-900/60 via-teal-950/40 to-black', bg: 'bg-emerald-950' },
  { id: 'obsidian', label: 'Obsidian Night', value: 'from-neutral-900 via-neutral-950 to-black', bg: 'bg-neutral-900' },
];

export const AlbumEditModal: React.FC<AlbumEditModalProps> = ({
  isOpen,
  onClose,
  album,
  files = [],
  onSaved,
}) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCoverId, setSelectedCoverId] = useState<string | null>(null);
  const [themeGradient, setThemeGradient] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state whenever modal opens or album changes
  useEffect(() => {
    if (!isOpen || !album) return;
    setTitle(album.title || '');
    setDescription(album.description || '');
    setDestinationName(album.destination?.name || '');
    setSelectedCoverId(album.coverFile?._id || (album as any).coverFileId || null);
    setThemeGradient(album.themeGradient || THEME_GRADIENTS[0].value);

    // Format ISO date strings to YYYY-MM-DD for date inputs
    if (album.startDate) {
      try {
        setStartDate(new Date(album.startDate).toISOString().split('T')[0]);
      } catch {
        setStartDate('');
      }
    } else {
      setStartDate('');
    }

    if (album.endDate) {
      try {
        setEndDate(new Date(album.endDate).toISOString().split('T')[0]);
      } catch {
        setEndDate('');
      }
    } else {
      setEndDate('');
    }

    setError(null);
  }, [isOpen, album]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Album title is required');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const payload: any = {
        title: title.trim(),
        description: description.trim(),
        destination: {
          name: destinationName.trim(),
          latitude: album.destination?.latitude || null,
          longitude: album.destination?.longitude || null,
        },
        themeGradient,
      };

      if (selectedCoverId) {
        payload.coverFileId = selectedCoverId;
      }
      if (startDate) {
        payload.startDate = new Date(startDate).toISOString();
      } else {
        payload.startDate = null;
      }
      if (endDate) {
        payload.endDate = new Date(endDate).toISOString();
      } else {
        payload.endDate = null;
      }

      await api.updateAlbum(album._id, payload);

      // Construct partial updated item
      const updatedCover = files.find((f) => f._id === selectedCoverId) || album.coverFile;
      onSaved({
        title: payload.title,
        description: payload.description,
        destination: payload.destination,
        coverFile: updatedCover,
        startDate: payload.startDate,
        endDate: payload.endDate,
        themeGradient: payload.themeGradient,
      });

      onClose();
    } catch (err: any) {
      console.error('Failed to update album details:', err);
      setError(err.message || 'Failed to update album');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-xl rounded-3xl bg-neutral-900 border border-white/15 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-neutral-900/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">Edit Album Details</h3>
              <p className="text-xs text-neutral-400">Update title, destination, cover photo, and style</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="p-6 flex-1 overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
              Album Title <span className="text-purple-400">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Summer in Kyoto, Swiss Alps, Family Reunion"
              className="w-full px-3.5 py-2.5 rounded-xl bg-neutral-800/80 border border-white/10 text-white placeholder-neutral-500 text-sm outline-none focus:border-purple-500 transition-colors"
            />
          </div>

          {/* Destination */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5 mb-1.5">
              <MapPin className="w-3.5 h-3.5 text-purple-400" />
              <span>Location / Destination</span>
            </label>
            <input
              type="text"
              value={destinationName}
              onChange={(e) => setDestinationName(e.target.value)}
              placeholder="e.g., Kyoto, Japan or Amalfi Coast"
              className="w-full px-3.5 py-2 rounded-xl bg-neutral-800/80 border border-white/10 text-white placeholder-neutral-500 text-xs outline-none focus:border-purple-500 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5 mb-1.5">
              <FileText className="w-3.5 h-3.5 text-purple-400" />
              <span>Description / Notes</span>
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add memorable highlights, stories or notes..."
              className="w-full px-3.5 py-2 rounded-xl bg-neutral-800/80 border border-white/10 text-white placeholder-neutral-500 text-xs outline-none focus:border-purple-500 transition-colors resize-none"
            />
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5 mb-1.5">
                <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                <span>Start Date</span>
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-neutral-800/80 border border-white/10 text-white text-xs outline-none focus:border-purple-500"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5 mb-1.5">
                <Calendar className="w-3.5 h-3.5 text-neutral-400" />
                <span>End Date</span>
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-neutral-800/80 border border-white/10 text-white text-xs outline-none focus:border-purple-500"
              />
            </div>
          </div>

          {/* Theme Gradient */}
          <div>
            <label className="text-xs font-semibold text-neutral-300 flex items-center gap-1.5 mb-2">
              <Palette className="w-3.5 h-3.5 text-purple-400" />
              <span>Ambient Theme Gradient</span>
            </label>
            <div className="grid grid-cols-5 gap-2">
              {THEME_GRADIENTS.map((tg) => (
                <button
                  key={tg.id}
                  type="button"
                  onClick={() => setThemeGradient(tg.value)}
                  className={`p-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                    themeGradient === tg.value
                      ? 'border-purple-500 bg-purple-500/20 shadow-md ring-1 ring-purple-500'
                      : 'border-white/10 bg-neutral-800/60 hover:border-white/30'
                  }`}
                >
                  <div className={`w-6 h-6 rounded-lg ${tg.bg} border border-white/20`} />
                  <span className="text-[10px] text-neutral-300 truncate w-full text-center">
                    {tg.label.split(' ')[0]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Cover Photo Selector */}
          {files.length > 0 && (
            <div>
              <label className="text-xs font-semibold text-neutral-300 flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
                  <span>Choose Cover Photo</span>
                </span>
                <span className="text-[11px] text-neutral-400">Click to set cover</span>
              </label>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 max-h-48 overflow-y-auto p-1 bg-neutral-950/40 rounded-2xl border border-white/10">
                {files.map((file) => {
                  const isSelected = selectedCoverId === file._id;
                  const thumb =
                    file.metadata?.thumbnail && file.metadata.thumbnail.startsWith('data:image/')
                      ? file.metadata.thumbnail
                      : mediaCache.getThumbnail(file._id) || api.getThumbnailUrl(file._id);

                  return (
                    <div
                      key={file._id}
                      onClick={() => setSelectedCoverId(file._id)}
                      className={`relative aspect-square rounded-xl overflow-hidden cursor-pointer border transition-all ${
                        isSelected
                          ? 'border-purple-500 ring-2 ring-purple-500/80 shadow-lg shadow-purple-500/30 scale-95'
                          : 'border-white/10 hover:border-white/40 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img
                        src={thumb}
                        alt={file.filename}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                      {isSelected && (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-purple-600 border border-purple-300 flex items-center justify-center text-white shadow">
                          <Check className="w-3 h-3 stroke-[3]" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-semibold transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim()}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-purple-500/25 disabled:opacity-50 transition flex items-center gap-1.5"
            >
              {saving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Changes</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
};
