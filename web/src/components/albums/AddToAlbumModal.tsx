import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { AlbumItem } from '../../types.js';
import {
  X,
  Plus,
  Search,
  Image as ImageIcon,
  Check,
  Loader2,
  FolderPlus,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { getPreviewUrl } from '../../utils/format.js';

interface AddToAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFileIds: string[];
  onSuccess: (albumTitle: string) => void;
  onCreateNewAlbum: () => void;
}

export const AddToAlbumModal: React.FC<AddToAlbumModalProps> = ({
  isOpen,
  onClose,
  selectedFileIds,
  onSuccess,
  onCreateNewAlbum,
}) => {
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addingToId, setAddingToId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const fetchAlbums = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await api.listAlbums();
        setAlbums(res.albums || []);
      } catch (err: any) {
        console.error('Failed to fetch albums:', err);
        setError('Failed to load albums');
      } finally {
        setLoading(false);
      }
    };
    fetchAlbums();
  }, [isOpen]);

  const filteredAlbums = useMemo(() => {
    if (!searchQuery.trim()) return albums;
    const q = searchQuery.toLowerCase();
    return albums.filter((a) => a.title.toLowerCase().includes(q));
  }, [albums, searchQuery]);

  const handleSelectAlbum = async (album: AlbumItem) => {
    try {
      setAddingToId(album._id);
      setError(null);
      await api.addPhotosToAlbum(album._id, selectedFileIds);
      onSuccess(album.title);
      onClose();
    } catch (err: any) {
      console.error('Failed to add photos to album:', err);
      setError(err.message || 'Failed to add photos to album');
    } finally {
      setAddingToId(null);
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-md rounded-3xl bg-neutral-900 border border-white/15 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-neutral-900/60">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Add to Album</h3>
            <p className="text-xs text-neutral-400">
              {selectedFileIds.length} {selectedFileIds.length === 1 ? 'item' : 'items'} selected
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-neutral-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-5 flex-1 overflow-y-auto space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {error}
            </div>
          )}

          {/* Option: Create New Album */}
          <button
            onClick={() => {
              onClose();
              onCreateNewAlbum();
            }}
            className="w-full p-3.5 rounded-2xl bg-purple-600/15 hover:bg-purple-600/25 border border-purple-500/40 text-purple-300 flex items-center justify-between group transition-all"
          >
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-600/30 border border-purple-400/40 flex items-center justify-center text-purple-300 group-hover:scale-105 transition-transform">
                <Plus className="w-5 h-5" />
              </div>
              <div className="text-left">
                <span className="text-sm font-semibold text-white block">Create New Album</span>
                <span className="text-[11px] text-neutral-400">Start a fresh collection with these items</span>
              </div>
            </div>
          </button>

          {/* Existing Albums Divider */}
          <div className="pt-2">
            <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider block mb-2">
              Existing Albums
            </span>

            {/* Search Filter */}
            {albums.length > 3 && (
              <div className="relative mb-3">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter albums..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-neutral-800/80 border border-white/10 text-xs text-white placeholder-neutral-500 outline-none focus:border-purple-500"
                />
              </div>
            )}

            {/* Albums List */}
            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2">
                <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                <span className="text-xs text-neutral-400">Loading albums...</span>
              </div>
            ) : filteredAlbums.length === 0 ? (
              <div className="py-10 text-center text-xs text-neutral-500">
                {searchQuery ? 'No matching albums found.' : 'No existing albums yet.'}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                {filteredAlbums.map((album) => {
                  const coverUrl = album.coverFile?._id
                    ? getPreviewUrl(album.coverFile._id)
                    : null;
                  const isAdding = addingToId === album._id;

                  return (
                    <button
                      key={album._id}
                      onClick={() => handleSelectAlbum(album)}
                      disabled={isAdding}
                      className="w-full p-2.5 rounded-xl bg-neutral-800/50 hover:bg-neutral-800 border border-white/5 hover:border-white/20 flex items-center justify-between text-left transition-all disabled:opacity-50 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {/* Thumbnail Cover */}
                        <div className="w-11 h-11 rounded-lg overflow-hidden bg-neutral-900 border border-white/10 shrink-0">
                          {coverUrl ? (
                            <img
                              src={coverUrl}
                              alt={album.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-neutral-500">
                              <ImageIcon className="w-5 h-5" />
                            </div>
                          )}
                        </div>

                        {/* Title & Count */}
                        <div className="min-w-0">
                          <h4 className="text-xs font-semibold text-white truncate max-w-[200px]">
                            {album.title}
                          </h4>
                          <span className="text-[11px] text-neutral-400">
                            {album.fileCount} {album.fileCount === 1 ? 'item' : 'items'}
                          </span>
                        </div>
                      </div>

                      {/* Action Icon */}
                      <div className="w-7 h-7 rounded-lg bg-white/5 group-hover:bg-purple-600/30 group-hover:text-purple-300 border border-white/10 flex items-center justify-center text-neutral-400 transition-colors">
                        {isAdding ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FolderPlus className="w-3.5 h-3.5" />
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-white/10 bg-neutral-900/60 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs text-neutral-300 hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
