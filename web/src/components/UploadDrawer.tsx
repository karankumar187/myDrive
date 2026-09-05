import React, { useState, useEffect } from 'react';
import { uploadService, UploadTask } from '../services/UploadService.js';
import { 
  ChevronUp, 
  ChevronDown, 
  X, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  FileText, 
  Film, 
  Image as ImageIcon 
} from 'lucide-react';

export const UploadDrawer: React.FC = () => {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    return uploadService.subscribe(setTasks);
  }, []);

  if (tasks.length === 0) return null;

  const activeCount = tasks.filter((t) => t.status === 'queued' || t.status === 'processing' || t.status === 'uploading').length;
  const completedCount = tasks.filter((t) => t.status === 'completed' || t.status === 'duplicate').length;
  const failedCount = tasks.filter((t) => t.status === 'failed').length;

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-purple-400 shrink-0" />;
    if (mimeType.startsWith('video/')) return <Film className="w-4 h-4 text-cyan-400 shrink-0" />;
    return <FileText className="w-4 h-4 text-zinc-400 shrink-0" />;
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 w-[92vw] max-w-sm sm:w-96 rounded-2xl bg-[#13131a] border border-[#272736] shadow-2xl overflow-hidden transition-all duration-300">
      {/* Drawer Header */}
      <div 
        className="flex items-center justify-between px-4 py-3 bg-[#181824] border-b border-[#272736] cursor-pointer select-none"
        onClick={() => setIsMinimized(!isMinimized)}
      >
        <div className="flex items-center space-x-2.5 overflow-hidden">
          {activeCount > 0 ? (
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
          ) : failedCount > 0 ? (
            <span className="w-2.5 h-2.5 rounded-full bg-red-400 shrink-0" />
          ) : (
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
          )}

          <div className="flex flex-col">
            <span className="text-xs font-bold text-white truncate">
              {activeCount > 0
                ? `Uploading ${activeCount} item${activeCount > 1 ? 's' : ''}`
                : `${completedCount} upload${completedCount > 1 ? 's' : ''} complete`}
            </span>
            <span className="text-[10px] text-zinc-400 truncate">
              {activeCount > 0 ? 'Background upload running…' : 'All uploads completed'}
            </span>
          </div>
        </div>

        <div className="flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition"
            title={isMinimized ? 'Expand' : 'Minimize'}
          >
            {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={() => uploadService.clearCompleted()}
            className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-white/5 transition"
            title="Clear list"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Drawer Body (Task List) */}
      {!isMinimized && (
        <div className="max-h-72 overflow-y-auto divide-y divide-[#222230] p-2 space-y-1">
          {tasks.map((task) => (
            <div key={task.id} className="p-2 rounded-xl hover:bg-white/[0.02] transition space-y-1.5">
              <div className="flex items-center justify-between space-x-2">
                <div className="flex items-center space-x-2 min-w-0">
                  {getFileIcon(task.file.type)}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-white truncate">{task.file.name}</p>
                    <p className="text-[10px] text-zinc-400 truncate">
                      {formatBytes(task.file.size)}
                      {task.targetFolderName ? ` • In ${task.targetFolderName}` : ''}
                    </p>
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  {task.status === 'completed' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  )}
                  {task.status === 'duplicate' && (
                    <span title="Linked instantly without bytes">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                    </span>
                  )}
                  {task.status === 'failed' && (
                    <AlertCircle className="w-4 h-4 text-red-400" />
                  )}
                  {(task.status === 'queued' || task.status === 'processing' || task.status === 'uploading') && (
                    <span className="text-[11px] font-semibold text-cyan-400">
                      {task.progress}%
                    </span>
                  )}
                </div>
              </div>

              {/* Individual task progress bar */}
              {(task.status === 'uploading' || task.status === 'processing') && (
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-cyan-400 via-sky-500 to-blue-500 transition-all duration-200"
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
              )}

              {task.message && task.status !== 'completed' && (
                <p className={`text-[10px] truncate ${task.status === 'failed' ? 'text-red-400' : 'text-zinc-400'}`}>
                  {task.message}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
