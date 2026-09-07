import React, { useState, useEffect } from 'react';
import { FileItem } from '../types.js';
import {
  Trash2,
  RotateCcw,
  AlertTriangle,
  Loader2,
  Sparkles,
  Eye,
  X,
  Download,
  Film,
  Image as ImageIcon,
  FileText,
  Music,
  RotateCw,
  ExternalLink,
  File,
} from 'lucide-react';
import { api, subscribeToProgress, startGlobalLoading, GlobalProgressState } from '../services/api.js';
import { formatBytes, getStreamUrl } from '../utils/format.js';
import { ModernVideoPlayer } from './ModernVideoPlayer.js';

interface Props {
  trashedFiles: FileItem[];
  onRefresh: () => void;
}

export const TrashBinView: React.FC<Props> = ({ trashedFiles, onRefresh }) => {
  const [actionLoading, setActionLoading] = useState<'restore-all' | 'empty' | 'dedup' | null>(null);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewRotation, setPreviewRotation] = useState<number>(0);
  const [globalProgress, setGlobalProgress] = useState<GlobalProgressState>({
    progress: 0,
    isVisible: false,
    isFading: false,
    isLoading: false,
    colorType: 'trash',
  });

  useEffect(() => {
    return subscribeToProgress(setGlobalProgress);
  }, []);

  // Keyboard shortcut: Escape closes preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreviewFile(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleRestore = async (id: string) => {
    try {
      await api.restoreFromTrash(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handlePermanentDelete = async (id: string, name: string) => {
    if (!confirm(`Are you SURE you want to permanently purge "${name}" from Google Drive? This action CANNOT be undone.`)) {
      return;
    }
    try {
      await api.permanentDelete(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRestoreAll = async () => {
    if (trashedFiles.length === 0) return;
    if (!confirm(`Are you sure you want to recover all ${trashedFiles.length} file(s) from Trash?`)) {
      return;
    }
    const stop = startGlobalLoading('trash');
    try {
      setActionLoading('restore-all');
      await api.restoreAllTrash();
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to restore all files');
    } finally {
      stop();
      setActionLoading(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (trashedFiles.length === 0) return;
    if (!confirm(`Are you SURE you want to permanently delete ALL ${trashedFiles.length} file(s) from Google Drive? This action CANNOT be undone.`)) {
      return;
    }
    const stop = startGlobalLoading('trash');
    try {
      setActionLoading('empty');
      await api.emptyTrash();
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to empty trash');
    } finally {
      stop();
      setActionLoading(null);
    }
  };

  const handleDeduplicate = async () => {
    if (!confirm('Scan and remove any duplicate files across your cloud library? Only 1 unique copy of each file will be kept.')) {
      return;
    }
    try {
      setActionLoading('dedup');
      const res = await api.deduplicateFiles();
      alert(res.message || 'Deduplication complete!');
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to clean duplicates');
    } finally {
      setActionLoading(null);
    }
  };

  const isVideoFile = (file: FileItem) => {
    return file.mimeType.startsWith('video/') || /\.(mp4|mkv|mov|webm|3gp|avi|flv)$/i.test(file.filename);
  };

  const isImageFile = (file: FileItem) => {
    return file.mimeType.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|heic|bmp|svg)$/i.test(file.filename);
  };

  const isPdfFile = (file: FileItem) => {
    return file.mimeType.includes('pdf') || /\.pdf$/i.test(file.filename);
  };

  const isAudioFile = (file: FileItem) => {
    return file.mimeType.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(file.filename);
  };

  const renderFileIcon = (file: FileItem) => {
    if (isImageFile(file)) {
      return (
        <div className="w-8 h-8 rounded-lg bg-emerald-950/40 border border-emerald-800/40 overflow-hidden flex items-center justify-center flex-shrink-0">
          <img
            src={api.getThumbnailUrl(file._id)}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              // Replace broken thumbnail with icon
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          <ImageIcon className="w-4 h-4 text-emerald-400 absolute pointer-events-none -z-10" />
        </div>
      );
    }
    if (isVideoFile(file)) {
      return (
        <div className="w-8 h-8 rounded-lg bg-sky-950/40 border border-sky-800/40 flex items-center justify-center flex-shrink-0 text-sky-400">
          <Film className="w-4 h-4" />
        </div>
      );
    }
    if (isPdfFile(file)) {
      return (
        <div className="w-8 h-8 rounded-lg bg-rose-950/40 border border-rose-800/40 flex items-center justify-center flex-shrink-0 text-rose-400">
          <FileText className="w-4 h-4" />
        </div>
      );
    }
    if (isAudioFile(file)) {
      return (
        <div className="w-8 h-8 rounded-lg bg-purple-950/40 border border-purple-800/40 flex items-center justify-center flex-shrink-0 text-purple-400">
          <Music className="w-4 h-4" />
        </div>
      );
    }
    return (
      <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center flex-shrink-0 text-zinc-400">
        <File className="w-4 h-4" />
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Recycle Bin (Trash)</h2>
          <p className="text-xs text-zinc-400">
            Files deleted from the web or synced devices are preserved safely here for 30 days before permanent purging.
          </p>
        </div>

        <div className="flex items-center space-x-2.5 flex-shrink-0">
          <button
            onClick={handleDeduplicate}
            disabled={actionLoading !== null}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-blue-900/20"
            title="Scan and remove redundant duplicate files across your library"
          >
            {actionLoading === 'dedup' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-300" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{actionLoading === 'dedup' ? 'Cleaning...' : 'Clean Duplicates'}</span>
          </button>

          {trashedFiles.length > 0 && (
            <>
              <button
                onClick={handleRestoreAll}
                disabled={actionLoading !== null}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-purple-900/20"
                title="Restore all files back to your cloud drive"
              >
                {actionLoading === 'restore-all' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-300" />
                ) : (
                  <RotateCcw className="w-3.5 h-3.5" />
                )}
                <span>{actionLoading === 'restore-all' ? 'Restoring...' : `Recover All (${trashedFiles.length})`}</span>
              </button>

              <button
                onClick={handleEmptyTrash}
                disabled={actionLoading !== null}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/50 transition active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-red-950/20"
                title="Permanently delete all files in trash from Google Drive"
              >
                {actionLoading === 'empty' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-300" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                <span>{actionLoading === 'empty' ? 'Emptying...' : 'Empty Trash'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Single Running Progress Line during actions like Empty Trash (Rose/Red color) */}
      {globalProgress.isVisible && actionLoading !== null && (
        <div className="h-[3px] rounded-full overflow-hidden bg-rose-950/30 w-full relative">
          <div
            className="h-full single-progress-bar progress-trash"
            style={{
              width: `${globalProgress.progress}%`,
            }}
          />
        </div>
      )}

      <div className="p-4 bg-amber-950/30 border border-amber-800/40 rounded-2xl text-xs text-amber-300 flex items-center space-x-2.5">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400" />
        <span>
          Files in Trash are safely preserved on your Google Drive accounts until permanently purged. Click any item to preview or restore.
        </span>
      </div>

      <div className="bg-[#111114] rounded-2xl border border-[#222227] shadow-xl overflow-hidden">
        {trashedFiles.length === 0 ? (
          <div className="p-16 text-center text-zinc-500 space-y-2">
            <Trash2 className="w-10 h-10 mx-auto text-zinc-700" />
            <p className="text-sm font-semibold text-zinc-300">Recycle Bin is empty</p>
            <p className="text-xs text-zinc-500">No deleted items to restore or purge</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#141418] border-b border-[#222227] text-zinc-400 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Item</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Deleted At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181f]">
                {trashedFiles.map((file) => (
                  <tr
                    key={file._id}
                    className="hover:bg-[#15151a] transition cursor-pointer group"
                    onClick={() => {
                      setPreviewFile(file);
                      setPreviewRotation(0);
                    }}
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center space-x-3">
                        {renderFileIcon(file)}
                        <span className="font-semibold text-zinc-200 group-hover:text-white group-hover:underline transition truncate max-w-xs sm:max-w-md">
                          {file.filename}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-zinc-400 font-mono">{formatBytes(file.sizeBytes)}</td>
                    <td className="py-3 px-4 text-zinc-500">
                      {file.trashedAt ? new Date(file.trashedAt).toLocaleString() : 'Recently'}
                    </td>
                    <td
                      className="py-3 px-4 text-right space-x-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setPreviewFile(file);
                          setPreviewRotation(0);
                        }}
                        className="inline-flex items-center space-x-1 text-[#38BDF8] hover:text-[#38BDF8]/80 font-semibold transition"
                        title="Open and preview deleted item"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRestore(file._id)}
                        className="inline-flex items-center space-x-1 text-purple-400 hover:text-purple-300 font-semibold transition"
                        title="Restore to active drive"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restore</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePermanentDelete(file._id, file.filename)}
                        className="inline-flex items-center space-x-1 text-red-400/80 hover:text-red-400 font-semibold transition"
                        title="Permanently erase from Google Drive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Forever</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ======== TRASHED FILE PREVIEW MODAL ======== */}
      {previewFile && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-md"
          onClick={() => setPreviewFile(null)}
        >
          {/* Header Bar */}
          <div
            className="absolute top-4 left-4 right-4 z-50 flex items-center justify-between pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Left Title & Status */}
            <div className="flex items-center space-x-3 max-w-[50%] sm:max-w-[65%]">
              <span className="px-2.5 py-1 rounded-full bg-red-950/80 border border-red-800/60 text-red-300 text-[11px] font-semibold flex items-center space-x-1.5 flex-shrink-0 shadow-lg">
                <Trash2 className="w-3 h-3 text-red-400" />
                <span>In Trash</span>
              </span>
              <span className="text-sm font-semibold text-white truncate drop-shadow">
                {previewFile.filename}
              </span>
              <span className="text-xs text-zinc-400 hidden sm:inline font-mono">
                ({formatBytes(previewFile.sizeBytes)})
              </span>
            </div>

            {/* Right Actions: Rotate, Download, Restore, Delete Forever, Close */}
            <div className="flex items-center space-x-2">
              {isImageFile(previewFile) && (
                <button
                  type="button"
                  onClick={() => setPreviewRotation((r) => (r + 90) % 360)}
                  className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-white transition shadow-lg"
                  title="Rotate 90°"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              )}

              <a
                href={getStreamUrl(previewFile._id)}
                download={previewFile.filename}
                className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-white transition shadow-lg"
                title="Download file"
              >
                <Download className="w-4 h-4" />
              </a>

              <button
                type="button"
                onClick={async () => {
                  const id = previewFile._id;
                  setPreviewFile(null);
                  await handleRestore(id);
                }}
                className="px-3 py-2 rounded-xl bg-purple-600/30 hover:bg-purple-600/50 text-purple-200 border border-purple-500/40 text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg"
                title="Restore this item back to your cloud drive"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Restore</span>
              </button>

              <button
                type="button"
                onClick={async () => {
                  const id = previewFile._id;
                  const name = previewFile.filename;
                  setPreviewFile(null);
                  await handlePermanentDelete(id, name);
                }}
                className="px-3 py-2 rounded-xl bg-red-950/60 hover:bg-red-900/80 text-red-300 border border-red-800/60 text-xs font-semibold flex items-center space-x-1.5 transition shadow-lg"
                title="Permanently purge this file"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Purge</span>
              </button>

              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="p-2 rounded-xl bg-zinc-800/80 hover:bg-zinc-700 text-white transition shadow-lg"
                title="Close preview (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Main Preview Content Body */}
          <div
            className="w-full max-w-5xl max-h-[82vh] flex items-center justify-center p-2"
            onClick={(e) => e.stopPropagation()}
          >
            {isVideoFile(previewFile) ? (
              <div className="w-full max-h-[80vh] flex items-center justify-center">
                <ModernVideoPlayer
                  src={getStreamUrl(previewFile._id)}
                  filename={previewFile.filename}
                  autoPlay
                  className="w-full max-h-[78vh] shadow-2xl"
                  onDownload={() => {}}
                />
              </div>
            ) : isImageFile(previewFile) ? (
              <div className="relative flex items-center justify-center max-h-[78vh] max-w-full">
                <img
                  src={getStreamUrl(previewFile._id)}
                  alt={previewFile.filename}
                  style={{
                    transform: `rotate(${previewRotation}deg)`,
                    transition: 'transform 0.2s ease-out',
                  }}
                  className="max-h-[78vh] max-w-full object-contain rounded-2xl shadow-2xl"
                />
              </div>
            ) : isPdfFile(previewFile) ? (
              <div className="w-[90vw] max-w-4xl h-[78vh] rounded-2xl overflow-hidden bg-[#18181f] border border-[#272733] shadow-2xl flex flex-col">
                <div className="flex items-center justify-between px-4 py-2 bg-[#141418] border-b border-[#272733]">
                  <span className="text-xs text-zinc-300 font-semibold truncate max-w-md">
                    📄 {previewFile.filename}
                  </span>
                  <a
                    href={getStreamUrl(previewFile._id)}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center space-x-1 px-3 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 rounded-lg text-xs font-medium transition"
                  >
                    <span>Open in Tab</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
                <iframe
                  src={getStreamUrl(previewFile._id)}
                  title={previewFile.filename}
                  className="w-full h-full border-0 bg-white"
                />
              </div>
            ) : isAudioFile(previewFile) ? (
              <div className="p-8 bg-[#16161d] border border-zinc-800 rounded-3xl text-center space-y-5 max-w-md w-full shadow-2xl">
                <div className="w-16 h-16 rounded-2xl bg-[#38BDF8]/10 border border-[#38BDF8]/30 flex items-center justify-center mx-auto text-[#38BDF8]">
                  <Music className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white truncate">{previewFile.filename}</h4>
                  <p className="text-xs text-zinc-400 mt-1 font-mono">{formatBytes(previewFile.sizeBytes)}</p>
                </div>
                <audio
                  src={getStreamUrl(previewFile._id)}
                  controls
                  className="w-full rounded-xl"
                />
              </div>
            ) : (
              <div className="p-8 bg-[#16161d] border border-zinc-800 rounded-3xl text-center space-y-4 max-w-md w-full shadow-2xl">
                <div className="w-16 h-16 rounded-2xl bg-zinc-800/60 border border-zinc-700 flex items-center justify-center mx-auto text-zinc-300">
                  <FileText className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white truncate">{previewFile.filename}</h4>
                  <p className="text-xs text-zinc-400 mt-1">
                    {formatBytes(previewFile.sizeBytes)} · {previewFile.mimeType || 'Document'}
                  </p>
                </div>
                <div className="pt-2">
                  <a
                    href={getStreamUrl(previewFile._id)}
                    download={previewFile.filename}
                    className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-bold text-black bg-[#38BDF8] hover:bg-[#38BDF8]/90 rounded-xl transition shadow-lg"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download File</span>
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Trashed Notice Bar */}
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs text-zinc-400 flex items-center space-x-2 backdrop-blur-md shadow-2xl pointer-events-none"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span>This item is in the Recycle Bin. You can restore it or permanently purge it above.</span>
          </div>
        </div>
      )}
    </div>
  );
};
