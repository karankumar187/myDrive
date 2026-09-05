import React, { useState, useEffect } from 'react';
import { FileItem } from '../types.js';
import { Trash2, RotateCcw, AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { api, subscribeToProgress, GlobalProgressState } from '../services/api.js';
import { formatBytes } from '../utils/format.js';

interface Props {
  trashedFiles: FileItem[];
  onRefresh: () => void;
}

export const TrashBinView: React.FC<Props> = ({ trashedFiles, onRefresh }) => {
  const [actionLoading, setActionLoading] = useState<'restore-all' | 'empty' | 'dedup' | null>(null);
  const [globalProgress, setGlobalProgress] = useState<GlobalProgressState>({
    progress: 0,
    isVisible: false,
    isFading: false,
    isLoading: false,
  });

  useEffect(() => {
    return subscribeToProgress(setGlobalProgress);
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
    try {
      setActionLoading('restore-all');
      await api.restoreAllTrash();
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to restore all files');
    } finally {
      setActionLoading(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (trashedFiles.length === 0) return;
    if (!confirm(`Are you SURE you want to permanently delete ALL ${trashedFiles.length} file(s) from Google Drive? This action CANNOT be undone.`)) {
      return;
    }
    try {
      setActionLoading('empty');
      await api.emptyTrash();
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to empty trash');
    } finally {
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

      {/* Single Running Progress Line during actions like Empty Trash */}
      {globalProgress.isVisible && actionLoading !== null && (
        <div className="h-[3px] rounded-full overflow-hidden bg-purple-950/30 w-full relative">
          <div
            className="h-full bg-gradient-to-r from-purple-500 via-indigo-400 to-purple-400 single-progress-bar"
            style={{
              width: `${globalProgress.progress}%`,
            }}
          />
        </div>
      )}

      <div className="p-4 bg-amber-950/30 border border-amber-800/40 rounded-2xl text-xs text-amber-300 flex items-center space-x-2.5">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400" />
        <span>
          Files in Trash are still safely preserved on your Google Drive accounts until you explicitly choose &quot;Delete Permanently&quot; or &quot;Empty Trash&quot;.
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
                  <th className="py-3 px-4">Filename</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Deleted At</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181f]">
                {trashedFiles.map((file) => (
                  <tr key={file._id} className="hover:bg-[#15151a] transition">
                    <td className="py-3 px-4 font-semibold text-zinc-200">{file.filename}</td>
                    <td className="py-3 px-4 text-zinc-400">{formatBytes(file.sizeBytes)}</td>
                    <td className="py-3 px-4 text-zinc-500">
                      {file.trashedAt ? new Date(file.trashedAt).toLocaleString() : 'Recently'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-3">
                      <button
                        onClick={() => handleRestore(file._id)}
                        className="inline-flex items-center space-x-1 text-purple-400 hover:text-purple-300 font-semibold transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Restore</span>
                      </button>
                      <button
                        onClick={() => handlePermanentDelete(file._id, file.filename)}
                        className="inline-flex items-center space-x-1 text-red-400/80 hover:text-red-400 font-semibold transition"
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
    </div>
  );
};
