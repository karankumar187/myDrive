import React, { useState, useEffect } from 'react';
import { FileItem } from '../types.js';
import { Film, Calendar, Download, ShieldCheck, Lock, X, Loader2 } from 'lucide-react';
import { VaultCryptoService } from '../services/vault-crypto.js';

interface Props {
  media: FileItem[];
  vaultKey: CryptoKey | null;
}

interface LoadedMediaState {
  item: FileItem;
  displayUrl: string | null;
  isEncrypted: boolean;
  needsKey: boolean;
}

export const GalleryTimelineView: React.FC<Props> = ({ media, vaultKey }) => {
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Media Timeline</h2>
          <p className="text-xs text-slate-500">{media.length} photos and videos across all pooled accounts</p>
        </div>
        {vaultKey ? (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <ShieldCheck className="w-3.5 h-3.5 mr-1" />
            Zero-Knowledge Decryption Active
          </span>
        ) : (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
            <Lock className="w-3.5 h-3.5 mr-1" />
            Unlock Vault to View E2EE Media
          </span>
        )}
      </div>

      {media.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-400">
          <Calendar className="w-12 h-12 mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-medium text-slate-700">No photos or videos backed up yet</p>
          <p className="text-xs text-slate-400 mt-1">
            Upload photos in Folder Explorer or back up from Android/iPhone to view your gallery here.
          </p>
        </div>
      ) : (
        Object.entries(groupedMedia).map(([groupTitle, items]) => (
          <div key={groupTitle} className="space-y-3">
            <h3 className="text-sm font-bold text-slate-700 sticky top-0 bg-slate-50/90 backdrop-blur py-1 z-10 flex items-center space-x-2">
              <Calendar className="w-4 h-4 text-blue-500" />
              <span>{groupTitle}</span>
              <span className="text-xs font-normal text-slate-400">({items.length})</span>
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
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
          <button
            onClick={() => setSelectedMedia(null)}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white rounded-full bg-white/10 hover:bg-white/20 transition"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="max-w-4xl max-h-[85vh] w-full flex flex-col items-center">
            {selectedMedia.needsKey ? (
              <div className="p-12 text-center text-white space-y-3">
                <Lock className="w-12 h-12 text-emerald-400 mx-auto" />
                <h4 className="text-base font-bold">This media is encrypted with AES-256-GCM</h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Please click &quot;Unlock E2EE Vault&quot; in the bottom-left sidebar and enter your Master Passphrase to view this photo.
                </p>
              </div>
            ) : selectedMedia.item.mimeType.startsWith('video/') ? (
              <video
                controls
                autoPlay
                src={selectedMedia.displayUrl || ''}
                className="max-h-[75vh] max-w-full rounded-lg shadow-2xl"
              />
            ) : selectedMedia.displayUrl ? (
              <img
                src={selectedMedia.displayUrl}
                alt={selectedMedia.item.filename}
                className="max-h-[75vh] max-w-full object-contain rounded-lg shadow-2xl"
              />
            ) : (
              <div className="p-8 text-white flex items-center space-x-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Loading media...</span>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between w-full text-white text-xs px-2">
              <div>
                <p className="font-semibold text-sm">{selectedMedia.item.filename}</p>
                <p className="text-slate-400">
                  Added on {new Date(selectedMedia.item.createdAt).toLocaleString()} •{' '}
                  {(selectedMedia.item.sizeBytes / (1024 * 1024)).toFixed(1)} MB
                  {selectedMedia.isEncrypted && ' • E2EE Encrypted'}
                </p>
              </div>

              {selectedMedia.displayUrl && (
                <a
                  href={selectedMedia.displayUrl}
                  download={selectedMedia.item.filename}
                  className="flex items-center space-x-1 px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-white font-medium transition"
                >
                  <Download className="w-4 h-4" />
                  <span>Download</span>
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Individual Media Card with Client-Side On-the-Fly Decryption
const MediaCard: React.FC<{
  item: FileItem;
  vaultKey: CryptoKey | null;
  onSelect: (loaded: LoadedMediaState) => void;
}> = ({ item, vaultKey, onSelect }) => {
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    const load = async () => {
      const token = localStorage.getItem('drive_token') || '';
      const version = item.versions?.[item.versions.length - 1];
      const encrypted = !!version?.isEncrypted;
      setIsEncrypted(encrypted);

      if (encrypted) {
        if (!vaultKey) {
          setNeedsKey(true);
          setLoading(false);
          return;
        }

        try {
          // Fetch encrypted ciphertext
          const res = await fetch(`/api/v1/files/${item._id}/stream?token=${encodeURIComponent(token)}`);
          if (!res.ok) throw new Error('Fetch failed');
          const ciphertext = await res.arrayBuffer();

          if (version?.iv) {
            const decrypted = await VaultCryptoService.decryptBuffer(ciphertext, version.iv, vaultKey);
            if (active) {
              objectUrl = URL.createObjectURL(new Blob([decrypted], { type: item.mimeType }));
              setDisplayUrl(objectUrl);
              setNeedsKey(false);
            }
          }
        } catch (err) {
          console.error('Decryption error for', item.filename, err);
          if (active) setNeedsKey(true);
        }
      } else {
        // Plain unencrypted file with authenticated token
        setDisplayUrl(`/api/v1/files/${item._id}/stream?token=${encodeURIComponent(token)}`);
      }

      if (active) setLoading(false);
    };

    load();

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [item._id, item.versions, vaultKey]);

  const isVideo = item.mimeType.startsWith('video/');

  return (
    <div
      onClick={() => onSelect({ item, displayUrl, isEncrypted, needsKey })}
      className="group relative aspect-square bg-slate-200 rounded-xl overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition"
    >
      {loading ? (
        <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin text-slate-300" />
        </div>
      ) : needsKey ? (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-emerald-400 p-2 text-center">
          <Lock className="w-8 h-8 mb-1" />
          <span className="text-[10px] text-slate-300">E2EE Encrypted</span>
        </div>
      ) : isVideo ? (
        <div className="w-full h-full flex items-center justify-center bg-slate-800 text-white">
          <Film className="w-10 h-10 opacity-75 group-hover:scale-110 transition duration-300" />
        </div>
      ) : displayUrl ? (
        <img
          src={displayUrl}
          alt={item.filename}
          className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-slate-100 text-slate-400">
          <Film className="w-8 h-8 text-slate-300" />
        </div>
      )}

      {/* Overlay info */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition p-2 flex flex-col justify-end text-white text-[11px]">
        <p className="font-medium truncate">{item.filename}</p>
        <p className="text-[10px] text-slate-300">
          {item.sourceDeviceIds.length > 0 ? 'On phone & cloud' : 'Cloud only'}
          {isEncrypted && ' • Encrypted'}
        </p>
      </div>

      {/* Video indicator badge */}
      {isVideo && (
        <div className="absolute top-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded flex items-center space-x-1">
          <Film className="w-3 h-3" />
          <span>VIDEO</span>
        </div>
      )}

      {/* Encrypted indicator badge */}
      {isEncrypted && (
        <div className="absolute top-2 left-2 bg-emerald-600/80 text-white text-[10px] px-1.5 py-0.5 rounded flex items-center space-x-1">
          <ShieldCheck className="w-3 h-3" />
          <span>E2EE</span>
        </div>
      )}
    </div>
  );
};
