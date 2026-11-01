import React, { useState, useEffect, useMemo } from 'react';
import { AlbumItem, FileItem } from '../../types.js';
import {
  Search,
  Plus,
  Sparkles,
  MapPin,
  Calendar,
  Filter,
  Loader2,
  Compass,
  X,
  Check,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { AlbumCard } from './AlbumCard.js';
import { AlbumCreateModal } from './AlbumCreateModal.js';
import { AlbumDetailView } from './AlbumDetailView.js';

interface AlbumsShowcaseViewProps {
  allMedia: FileItem[];
  vaultKey: CryptoKey | null;
  initialSelectedMediaIds?: string[];
}

export const AlbumsShowcaseView: React.FC<AlbumsShowcaseViewProps> = ({
  allMedia,
  vaultKey,
  initialSelectedMediaIds = [],
}) => {
  const [albums, setAlbums] = useState<AlbumItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected album to view details
  const [activeAlbumId, setActiveAlbumId] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDestination, setSelectedDestination] = useState<string>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');

  // Create Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // Load albums from backend
  const loadAlbums = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.listAlbums();
      setAlbums(res.albums || []);
    } catch (err: any) {
      console.error('Failed to load albums:', err);
      setError(err.message || 'Failed to load albums');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlbums();
  }, []);

  // Check if we should automatically open create modal with selected media
  useEffect(() => {
    if (initialSelectedMediaIds && initialSelectedMediaIds.length > 0) {
      setIsCreateModalOpen(true);
    }
  }, [initialSelectedMediaIds]);

  // Toggle favorite on an album
  const handleToggleAlbumFavorite = async (album: AlbumItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const nextFav = !album.isFavorite;
      await api.updateAlbum(album._id, { isFavorite: nextFav });
      setAlbums((prev) =>
        prev.map((a) => (a._id === album._id ? { ...a, isFavorite: nextFav } : a))
      );
    } catch (err) {
      console.error('Failed to toggle album favorite:', err);
    }
  };

  // Toggle pin on an album
  const handleToggleAlbumPin = async (album: AlbumItem, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const nextPin = !album.isPinned;
      await api.updateAlbum(album._id, { isPinned: nextPin });
      setAlbums((prev) =>
        prev.map((a) => (a._id === album._id ? { ...a, isPinned: nextPin } : a))
      );
    } catch (err) {
      console.error('Failed to toggle album pin:', err);
    }
  };

  // Delete an album
  const handleDeleteAlbum = async (album: AlbumItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Delete album "${album.title}"? Photos will not be deleted.`)) return;
    try {
      await api.deleteAlbum(album._id);
      setAlbums((prev) => prev.filter((a) => a._id !== album._id));
    } catch (err) {
      console.error('Failed to delete album:', err);
    }
  };

  // Compute unique destinations and years for filter dropdowns
  const uniqueDestinations = useMemo(() => {
    const set = new Set<string>();
    albums.forEach((a) => {
      if (a.destination?.name) set.add(a.destination.name);
    });
    return Array.from(set);
  }, [albums]);

  const uniqueYears = useMemo(() => {
    const set = new Set<string>();
    albums.forEach((a) => {
      if (a.startDate) {
        const yr = new Date(a.startDate).getFullYear().toString();
        set.add(yr);
      }
    });
    return Array.from(set);
  }, [albums]);

  // Filtered albums
  const filteredAlbums = useMemo(() => {
    return albums.filter((a) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = a.title.toLowerCase().includes(q);
        const matchDest = a.destination?.name?.toLowerCase().includes(q);
        const matchDesc = a.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchDest && !matchDesc) return false;
      }
      if (selectedDestination !== 'all') {
        if (a.destination?.name !== selectedDestination) return false;
      }
      if (selectedYear !== 'all') {
        if (!a.startDate) return false;
        const yr = new Date(a.startDate).getFullYear().toString();
        if (yr !== selectedYear) return false;
      }
      return true;
    });
  }, [albums, searchQuery, selectedDestination, selectedYear]);

  // Featured Hero Trip (first pinned album, or first album)
  const featuredAlbum = useMemo(() => {
    if (filteredAlbums.length === 0) return null;
    const pinned = filteredAlbums.find((a) => a.isPinned);
    return pinned || filteredAlbums[0];
  }, [filteredAlbums]);

  // Rest of the collection cards
  const remainingAlbums = useMemo(() => {
    if (!featuredAlbum) return [];
    return filteredAlbums.filter((a) => a._id !== featuredAlbum._id);
  }, [filteredAlbums, featuredAlbum]);

  // If viewing details of a specific album
  if (activeAlbumId) {
    return (
      <AlbumDetailView
        albumId={activeAlbumId}
        onBack={() => setActiveAlbumId(null)}
        allMedia={allMedia}
        vaultKey={vaultKey}
        onAlbumUpdated={loadAlbums}
      />
    );
  }

  return (
    <div className="w-full space-y-8 animate-fadeIn pb-16">
      {/* Top Header & Search / Action Row */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-neutral-400 absolute left-3.5 top-3" />
          <input
            type="text"
            placeholder="Search albums, destinations, or dates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-neutral-900/80 border border-white/10 focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-xs sm:text-sm text-white placeholder-neutral-500 outline-none backdrop-blur-md transition-all shadow-inner"
          />
        </div>

        {/* Filters and Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* Destination Filter */}
          {uniqueDestinations.length > 0 && (
            <select
              value={selectedDestination}
              onChange={(e) => setSelectedDestination(e.target.value)}
              className="px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-neutral-300 outline-none hover:border-white/25 transition-all"
            >
              <option value="all">All Destinations</option>
              {uniqueDestinations.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}

          {/* Year Filter */}
          {uniqueYears.length > 0 && (
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="px-3 py-2 rounded-xl bg-neutral-900 border border-white/10 text-xs text-neutral-300 outline-none hover:border-white/25 transition-all"
            >
              <option value="all">All Years</option>
              {uniqueYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          )}

          {/* Create Album Button */}
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-xs font-semibold text-white shadow-lg shadow-purple-500/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>New Album</span>
          </button>
        </div>
      </div>

      {/* Content Rendering */}
      {loading ? (
        <div className="py-28 flex flex-col items-center justify-center gap-3">
          <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
          <span className="text-xs text-neutral-400">Loading albums...</span>
        </div>
      ) : filteredAlbums.length === 0 ? (
        <div className="py-24 text-center rounded-3xl border border-dashed border-white/10 bg-neutral-900/30 max-w-xl mx-auto p-8">
          <div className="w-16 h-16 rounded-2xl bg-purple-600/10 border border-purple-500/20 flex items-center justify-center text-purple-400 mx-auto mb-4">
            <Compass className="w-8 h-8" />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No Albums Yet</h3>
          <p className="text-xs text-neutral-400 leading-relaxed mb-6">
            Organize and curate your photos and videos into custom albums.
          </p>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-xs font-semibold text-white shadow-lg shadow-purple-500/25 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>Create Your First Album</span>
          </button>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Featured Hero Album Card */}
          {featuredAlbum && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <span>Featured Album</span>
              </div>
              <AlbumCard
                album={featuredAlbum}
                isFeatured={true}
                onClick={() => setActiveAlbumId(featuredAlbum._id)}
                onToggleFavorite={(e) => handleToggleAlbumFavorite(featuredAlbum, e)}
                onTogglePin={(e) => handleToggleAlbumPin(featuredAlbum, e)}
                onDelete={(e) => handleDeleteAlbum(featuredAlbum, e)}
              />
            </div>
          )}

          {/* All Albums Grid */}
          {remainingAlbums.length > 0 && (
            <div className="space-y-4 pt-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base font-bold text-white tracking-tight">
                  All Albums ({remainingAlbums.length})
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {remainingAlbums.map((album) => (
                  <AlbumCard
                    key={album._id}
                    album={album}
                    isFeatured={false}
                    onClick={() => setActiveAlbumId(album._id)}
                    onToggleFavorite={(e) => handleToggleAlbumFavorite(album, e)}
                    onTogglePin={(e) => handleToggleAlbumPin(album, e)}
                    onDelete={(e) => handleDeleteAlbum(album, e)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Album Creation Modal */}
      <AlbumCreateModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreated={(newAlbum) => {
          setAlbums((prev) => [newAlbum, ...prev]);
          setActiveAlbumId(newAlbum._id);
        }}
        allMedia={allMedia}
        initialSelectedIds={initialSelectedMediaIds}
      />
    </div>
  );
};
