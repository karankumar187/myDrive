import React from 'react';
import { FileItem } from '../types.js';
import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import { api } from '../services/api.js';

interface Props {
  trashedFiles: FileItem[];
  onRefresh: () => void;
}

export const TrashBinView: React.FC<Props> = ({ trashedFiles, onRefresh }) => {
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

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

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Recycle Bin (Trash)</h2>
        <p className="text-xs text-zinc-400">
          Files deleted from the web or synced devices are preserved safely here for 30 days before permanent purging.
        </p>
      </div>

      <div className="p-4 bg-amber-950/30 border border-amber-800/40 rounded-2xl text-xs text-amber-300 flex items-center space-x-2.5">
        <AlertTriangle className="w-4 h-4 flex-shrink-0 text-amber-400" />
        <span>
          Files in Trash are still safely preserved on your Google Drive accounts until you explicitly choose &quot;Delete Permanently&quot;.
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
