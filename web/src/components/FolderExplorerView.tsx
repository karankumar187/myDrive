import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FileItem, FolderItem, BreadcrumbItem, DeviceItem } from '../types.js';
import {
  Folder,
  File,
  Upload,
  Trash2,
  Download,
  FileText,
  Image as ImageIcon,
  Film,
  ShieldCheck,
  ChevronRight,
  FolderPlus,
  ChevronLeft,
  Clock,
  X,
  Loader2,
  Lock,
  Smartphone,
  Send,
  Check,
  MoreVertical,
  Pencil,
  Heart,
  HeartOff,
  Eye,
  Info,
  FolderInput,
  FolderOpen,
  CheckSquare,
  Square,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from 'lucide-react';
import { api, startGlobalLoading, subscribeToProgress, GlobalProgressState } from '../services/api.js';
import { VaultCryptoService } from '../services/vault-crypto.js';
import { mediaCache, generateThumbnailFromVideoFile } from '../services/media-cache.js';
import { formatBytes, getStreamUrl } from '../utils/format.js';

interface Props {
  files: FileItem[];
  recentFiles: FileItem[];
  folders: FolderItem[];
  currentFolderId: string | null;
  currentFolder: FolderItem | null;
  breadcrumbs: BreadcrumbItem[];
  onSelectFolder: (id: string | null) => void;
  onRefresh: () => void;
  vaultKey: CryptoKey | null;
  onOpenVault?: () => void;
}

export const FolderExplorerView: React.FC<Props> = ({
  files,
  recentFiles,
  folders,
  currentFolderId,
  currentFolder,
  breadcrumbs,
  onSelectFolder,
  onRefresh,
  vaultKey,
  onOpenVault,
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderModal, setShowFolderModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);
  const [globalProgress, setGlobalProgress] = useState<GlobalProgressState>({
    progress: 0,
    isVisible: false,
    isFading: false,
    isLoading: false,
  });

  useEffect(() => {
    return subscribeToProgress(setGlobalProgress);
  }, []);

  // File Preview state
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Force Download to Device state
  const [forceDownloadFile, setForceDownloadFile] = useState<FileItem | null>(null);
  const [forceDownloadFileIds, setForceDownloadFileIds] = useState<string[]>([]);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedTargetDeviceId, setSelectedTargetDeviceId] = useState<string>('');
  const [sendingForceDownload, setSendingForceDownload] = useState(false);

  // Multi-select state
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  // Context menu state (3-dot kebab for files)
  const [contextMenuFileId, setContextMenuFileId] = useState<string | null>(null);
  // Context menu state for folders
  const [contextMenuFolderId, setContextMenuFolderId] = useState<string | null>(null);

  // Rename modal state
  const [renameFile, setRenameFile] = useState<FileItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Rename folder modal state
  const [renameFolder, setRenameFolder] = useState<FolderItem | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [renamingFolder, setRenamingFolder] = useState(false);

  // Move to folder modal state
  const [moveFile, setMoveFile] = useState<FileItem | null>(null);
  const [moveFolders, setMoveFolders] = useState<FolderItem[]>([]);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [isBulkMove, setIsBulkMove] = useState(false);

  // File details modal state
  const [detailsFile, setDetailsFile] = useState<FileItem | null>(null);

  useEffect(() => {
    api.listDevices().then((res) => {
      if (res.devices) {
        setDevices(res.devices);
        if (res.devices.length > 0 && !selectedTargetDeviceId) {
          setSelectedTargetDeviceId(res.devices[0].deviceId);
        }
      }
    }).catch(() => {});
  }, []);

  // Close context menus when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      setContextMenuFileId(null);
      setContextMenuFolderId(null);
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  // Load folders list for move modal
  useEffect(() => {
    if (moveFile || isBulkMove) {
      api.listFolders().then((res) => {
        setMoveFolders(res.folders || []);
      }).catch(() => {});
    }
  }, [moveFile, isBulkMove]);

  const handleExecuteForceDownload = async () => {
    const fileIds = forceDownloadFileIds.length > 0 ? forceDownloadFileIds : (forceDownloadFile ? [forceDownloadFile._id] : []);
    if (fileIds.length === 0 || !selectedTargetDeviceId) return;
    setSendingForceDownload(true);
    try {
      await api.forceDownloadToDevice(selectedTargetDeviceId, fileIds);
      alert(`Force download dispatched! Device will automatically download ${fileIds.length} file(s).`);
      setForceDownloadFile(null);
      setForceDownloadFileIds([]);
    } catch (err: any) {
      alert(err.message || 'Failed to dispatch force download');
    } finally {
      setSendingForceDownload(false);
    }
  };

  // Selection helpers
  const toggleFileSelection = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const selectAllFiles = () => {
    setSelectedFileIds(new Set(files.map((f) => f._id)));
  };

  const deselectAllFiles = () => {
    setSelectedFileIds(new Set());
  };

  const exitSelectionMode = () => {
    setIsSelectionMode(false);
    setSelectedFileIds(new Set());
  };

  // Rename handler
  const handleRename = async () => {
    if (!renameFile || !renameValue.trim()) return;
    setRenaming(true);
    try {
      await api.renameFile(renameFile._id, renameValue.trim());
      setRenameFile(null);
      setRenameValue('');
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to rename file');
    } finally {
      setRenaming(false);
    }
  };

  // Move handler
  const handleMove = async () => {
    setMoving(true);
    try {
      if (isBulkMove) {
        await api.bulkAction('move', Array.from(selectedFileIds), moveTargetFolderId);
        exitSelectionMode();
      } else if (moveFile) {
        await api.moveFile(moveFile._id, moveTargetFolderId);
      }
      setMoveFile(null);
      setIsBulkMove(false);
      setMoveTargetFolderId(null);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to move file(s)');
    } finally {
      setMoving(false);
    }
  };

  // Favorite handler
  const handleToggleFavorite = async (file: FileItem) => {
    try {
      await api.toggleFavorite(file._id, !file.isFavorite);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to toggle favorite');
    }
  };

  // Bulk actions
  const handleBulkFavorite = async () => {
    try {
      await api.bulkAction('favorite', Array.from(selectedFileIds));
      exitSelectionMode();
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to favorite files');
    }
  };

  const handleBulkTrash = async () => {
    if (!confirm(`Move ${selectedFileIds.size} selected file(s) to Trash?`)) return;
    try {
      await api.bulkAction('trash', Array.from(selectedFileIds));
      exitSelectionMode();
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to trash files');
    }
  };

  const handleBulkSendToDevice = () => {
    setForceDownloadFileIds(Array.from(selectedFileIds));
    setForceDownloadFile(null);
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-purple-400" />;
    if (mimeType.startsWith('video/')) return <Film className="w-4 h-4 text-red-400" />;
    if (mimeType.includes('pdf') || mimeType.includes('document'))
      return <FileText className="w-4 h-4 text-blue-400" />;
    return <File className="w-4 h-4 text-zinc-400" />;
  };

  const isPreviewable = (mimeType: string) => {
    return (
      mimeType.startsWith('image/') ||
      mimeType.startsWith('video/') ||
      mimeType.includes('pdf') ||
      mimeType === 'application/pdf'
    );
  };

  // Open file preview - fetch, decrypt if needed, and display
  const handleFileClick = useCallback(async (file: FileItem) => {
    if (!isPreviewable(file.mimeType)) {
      window.open(getStreamUrl(file._id), '_blank');
      return;
    }

    setPreviewFile(file);
    setPreviewError(null);

    const cachedUrl = mediaCache.get(file._id);
    if (cachedUrl) {
      setPreviewUrl(cachedUrl);
      setPreviewLoading(false);
      return;
    }

    setPreviewLoading(true);
    setPreviewUrl(null);
    const stopLoading = startGlobalLoading();

    const isEncrypted = file.versions && file.versions.length > 0 && file.versions[0].isEncrypted;

    try {
      const response = await fetch(getStreamUrl(file._id));
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || `Server returned ${response.status}`);
      }

      let url: string;
      if (isEncrypted && vaultKey) {
        try {
          const encryptedBuffer = await response.arrayBuffer();
          const ivHex = file.versions![0].iv || '';
          const decryptedBuffer = await VaultCryptoService.decryptBuffer(encryptedBuffer, ivHex, vaultKey);
          const blob = new Blob([decryptedBuffer], { type: file.mimeType });
          url = URL.createObjectURL(blob);
        } catch (_decryptErr) {
          const blob = await response.blob();
          url = URL.createObjectURL(blob);
        }
      } else {
        const blob = await response.blob();
        url = URL.createObjectURL(blob);
      }

      mediaCache.set(file._id, url);
      setPreviewUrl(url);
    } catch (err: any) {
      console.error('File load failed:', err);
      setPreviewError(err.message || 'Failed to load file preview');
    } finally {
      stopLoading();
      setPreviewLoading(false);
    }
  }, [vaultKey]);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewError(null);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewFile) {
        closePreview();
      }
      if (e.key === 'Escape' && isSelectionMode) {
        exitSelectionMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewFile, closePreview, isSelectionMode]);

  // Prevent browser default file drop navigation
  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    const handleWindowDrop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); };
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  const uploadFiles = async (selectedFiles: FileList | File[]) => {
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploading(true);
    setUploadMessage(null);

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      try {
        setUploadMessage(`Processing ${file.name}...`);

        let videoThumb: string | null = null;
        if (file.type.startsWith('video/')) {
          setUploadMessage(`Extracting preview frame for ${file.name}...`);
          try {
            videoThumb = await generateThumbnailFromVideoFile(file);
          } catch {
            // ignore thumbnail failure
          }
        }

        const buffer = await file.arrayBuffer();
        const contentHash = await VaultCryptoService.calculateSha256(buffer);

        setUploadMessage(`Allocating storage pool for ${file.name}...`);
        const initResult = await api.initiateUpload({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          contentHash,
          folderId: currentFolderId,
          isEncrypted: false,
        });

        if (initResult.isDuplicate) {
          setUploadMessage(`✨ ${file.name} is an exact duplicate! Linked instantly without uploading bytes.`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        setUploadMessage(`Uploading to ${initResult.targetAccountEmail}...`);
        const uploadUrl = initResult.uploadSessionUrl.startsWith('http')
          ? initResult.uploadSessionUrl
          : `${import.meta.env.VITE_API_URL || ''}${initResult.uploadSessionUrl}`;

        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: buffer,
        });

        if (!putRes.ok && putRes.status !== 200 && putRes.status !== 201) {
          throw new Error(`Upload stream failed: ${putRes.statusText}`);
        }

        let realProviderFileId = initResult.driveOpaqueName || `file_${Date.now()}`;
        try {
          const putJson = await putRes.json();
          if (putJson && putJson.id) {
            realProviderFileId = putJson.id;
          }
        } catch {
          // keep opaque name
        }

        const completeRes = await api.completeUpload({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          contentHash,
          storageAccountId: initResult.storageAccountId,
          providerFileId: realProviderFileId,
          folderId: currentFolderId,
          isEncrypted: false,
          metadata: videoThumb ? { thumbnail: videoThumb } : undefined,
        });

        if (videoThumb && completeRes?.file?._id) {
          mediaCache.saveThumbnail(completeRes.file._id, videoThumb);
        }

        setUploadMessage(`✅ Successfully backed up ${file.name}`);
      } catch (err: any) {
        alert(`Failed to upload ${file.name}: ${err.message}`);
      }
    }

    setUploading(false);
    onRefresh();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) { setIsDragging(false); dragCounter.current = 0; }
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false); dragCounter.current = 0;
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    try {
      await api.createFolder(newFolderName.trim(), currentFolderId);
      setNewFolderName('');
      setShowFolderModal(false);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleRenameFolder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!renameFolder || !renameFolderName.trim()) return;
    try {
      setRenamingFolder(true);
      await api.renameFolder(renameFolder._id, renameFolderName.trim());
      setRenameFolder(null);
      setRenameFolderName('');
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to rename folder');
    } finally {
      setRenamingFolder(false);
    }
  };

  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!confirm(`Are you sure you want to move folder "${folderName}" and all its files to Trash?`)) return;
    try {
      await api.deleteFolder(folderId);
      if (currentFolderId === folderId) onSelectFolder(currentFolder?.parentFolderId || null);
      onRefresh();
    } catch (err: any) {
      alert(err.message || 'Failed to delete folder');
    }
  };

  const handleTrashFile = async (id: string, name: string) => {
    if (!confirm(`Move "${name}" to Trash? (Preserved in cloud for 30 days)`)) return;
    try {
      await api.moveToTrash(id);
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleGoBack = () => {
    if (!currentFolderId) return;
    onSelectFolder(currentFolder?.parentFolderId || null);
  };

  // ─── 3-Dot Kebab Dropdown for Files ─────────────────────────────────────
  const FileKebabMenu: React.FC<{ file: FileItem; isNearBottom?: boolean }> = ({ file, isNearBottom }) => {
    const isOpen = contextMenuFileId === file._id;
    return (
      <div className="relative inline-block text-left">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setContextMenuFileId(isOpen ? null : file._id);
            setContextMenuFolderId(null);
          }}
          className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-[#22222b] transition"
          title="More actions"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {isOpen && (
          <div
            className={`absolute right-0 ${
              isNearBottom ? 'bottom-8 slide-in-from-bottom-2' : 'top-8 slide-in-from-top-2'
            } z-50 w-52 bg-[#18181f] border border-[#2a2a36] rounded-xl shadow-2xl py-1.5 animate-in fade-in`}
            onClick={(e) => e.stopPropagation()}
          >
            {isPreviewable(file.mimeType) && (
              <button
                onClick={() => { setContextMenuFileId(null); handleFileClick(file); }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
              >
                <Eye className="w-3.5 h-3.5 text-purple-400" />
                <span>Preview</span>
              </button>
            )}
            <a
              href={getStreamUrl(file._id)}
              target="_blank"
              rel="noreferrer"
              download={file.filename}
              onClick={() => setContextMenuFileId(null)}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
            >
              <Download className="w-3.5 h-3.5 text-blue-400" />
              <span>Download</span>
            </a>
            <div className="border-t border-[#222230] my-1" />
            <button
              onClick={() => { setContextMenuFileId(null); setRenameFile(file); setRenameValue(file.filename); }}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
            >
              <Pencil className="w-3.5 h-3.5 text-amber-400" />
              <span>Rename</span>
            </button>
            <button
              onClick={() => { setContextMenuFileId(null); setMoveFile(file); setMoveTargetFolderId(file.folderId || null); }}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
            >
              <FolderInput className="w-3.5 h-3.5 text-cyan-400" />
              <span>Move to Folder</span>
            </button>
            <button
              onClick={() => { setContextMenuFileId(null); handleToggleFavorite(file); }}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
            >
              {file.isFavorite ? (
                <><HeartOff className="w-3.5 h-3.5 text-pink-400" /><span>Unfavorite</span></>
              ) : (
                <><Heart className="w-3.5 h-3.5 text-pink-400" /><span>Favorite</span></>
              )}
            </button>
            {devices.length > 0 && (
              <button
                onClick={() => { setContextMenuFileId(null); setForceDownloadFile(file); setForceDownloadFileIds([]); }}
                className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
              >
                <Smartphone className="w-3.5 h-3.5 text-green-400" />
                <span>Send to Device</span>
              </button>
            )}
            <div className="border-t border-[#222230] my-1" />
            <button
              onClick={() => { setContextMenuFileId(null); setDetailsFile(file); }}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
            >
              <Info className="w-3.5 h-3.5 text-zinc-400" />
              <span>File Details</span>
            </button>
            <button
              onClick={() => { setContextMenuFileId(null); handleTrashFile(file._id, file.filename); }}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-red-950/30 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Move to Trash</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  // ─── 3-Dot Kebab Dropdown for Folders ───────────────────────────────────
  const FolderKebabMenu: React.FC<{ folder: FolderItem }> = ({ folder }) => {
    const isOpen = contextMenuFolderId === folder._id;
    return (
      <div className="relative inline-block">
        <button
          onClick={(e) => {
            e.stopPropagation();
            setContextMenuFolderId(isOpen ? null : folder._id);
            setContextMenuFileId(null);
          }}
          className="p-1 text-zinc-500 hover:text-white hover:bg-[#22222b] rounded-lg transition opacity-0 group-hover:opacity-100 flex-shrink-0 ml-1"
          title="More actions"
        >
          <MoreVertical className="w-3.5 h-3.5" />
        </button>
        {isOpen && (
          <div
            className="absolute right-0 top-7 z-50 w-44 bg-[#18181f] border border-[#2a2a36] rounded-xl shadow-2xl py-1.5 animate-in fade-in slide-in-from-top-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => { setContextMenuFolderId(null); onSelectFolder(folder._id); }}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
            >
              <FolderOpen className="w-3.5 h-3.5 text-purple-400" />
              <span>Open Folder</span>
            </button>
            <button
              onClick={() => {
                setContextMenuFolderId(null);
                setRenameFolder(folder);
                setRenameFolderName(folder.name);
              }}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-zinc-300 hover:bg-[#22222b] hover:text-white transition"
            >
              <Pencil className="w-3.5 h-3.5 text-amber-400" />
              <span>Rename Folder</span>
            </button>
            <div className="border-t border-[#222230] my-1" />
            <button
              onClick={() => { setContextMenuFolderId(null); handleDeleteFolder(folder._id, folder.name); }}
              className="w-full flex items-center space-x-2.5 px-3.5 py-2 text-xs text-red-400 hover:bg-red-950/30 transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete Folder</span>
            </button>
          </div>
        )}
      </div>
    );
  };

  // Reusable file row renderer
  const renderFileRow = (
    file: FileItem,
    showSources: boolean = true,
    index: number = 0,
    total: number = 1
  ) => {
    const isNearBottom = total > 1 && index >= Math.max(1, total - 2);
    return (
      <tr
        key={file._id}
        className={`hover:bg-[#15151a] transition group ${selectedFileIds.has(file._id) ? 'bg-purple-950/20 hover:bg-purple-950/30' : ''}`}
      >
        {isSelectionMode && (
          <td className="py-3 pl-4 pr-1 w-8">
            <button
              onClick={(e) => { e.stopPropagation(); toggleFileSelection(file._id); }}
              className="text-zinc-500 hover:text-purple-400 transition"
            >
              {selectedFileIds.has(file._id) ? (
                <CheckSquare className="w-4 h-4 text-purple-400" />
              ) : (
                <Square className="w-4 h-4" />
              )}
            </button>
          </td>
        )}
        <td
          className="py-3 px-4 flex items-center space-x-3 cursor-pointer"
          onClick={() => {
            if (isSelectionMode) {
              toggleFileSelection(file._id);
            } else {
              handleFileClick(file);
            }
          }}
        >
          {getFileIcon(file.mimeType)}
          <span className={`font-semibold text-zinc-200 group-hover:text-purple-300 transition truncate max-w-[280px] ${isPreviewable(file.mimeType) ? 'hover:underline' : ''}`}>
            {file.filename}
          </span>
          {file.isFavorite && (
            <Heart className="w-3 h-3 text-pink-400 fill-pink-400 flex-shrink-0" />
          )}
          {isPreviewable(file.mimeType) && (
            <span className="text-[10px] text-zinc-600 group-hover:text-purple-500 transition">
              {file.mimeType.startsWith('image/') ? '🖼' : file.mimeType.includes('pdf') ? '📄' : '▶'}
            </span>
          )}
        </td>
        <td className="py-3 px-4 text-zinc-400">{formatBytes(file.sizeBytes)}</td>
        {showSources && (
          <td className="py-3 px-4">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#1a1a22] text-zinc-400 border border-[#272733]">
              {file.sourceDeviceIds.length > 0
                ? `${file.sourceDeviceIds.length} device(s)`
                : 'Cloud only'}
            </span>
          </td>
        )}
        <td className="py-3 px-4 text-zinc-500">
          {showSources
            ? new Date(file.createdAt).toLocaleDateString()
            : new Date(file.createdAt).toLocaleString()}
        </td>
        <td className="py-3 px-4 text-right">
          <FileKebabMenu file={file} isNearBottom={isNearBottom} />
        </td>
      </tr>
    );
  };

  return (
    <div
      className="space-y-5 relative min-h-[400px]"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Full Drag & Drop Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-8 border-4 border-dashed border-purple-500 rounded-3xl m-4 pointer-events-none shadow-glow-purple">
          <div className="w-20 h-20 rounded-full bg-purple-900/80 border border-purple-500/50 flex items-center justify-center text-purple-400 mb-4 animate-bounce">
            <Upload className="w-10 h-10" />
          </div>
          <h3 className="text-xl font-bold text-white">Drop files or videos to upload</h3>
          <p className="text-sm text-zinc-300 mt-2">
            Uploading directly to <span className="text-purple-400 font-semibold">{currentFolder ? currentFolder.name : 'My Drive'}</span>
          </p>
        </div>
      )}

      {/* Top Action & Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#111114] p-4 rounded-2xl border border-[#222227] shadow-lg">
        <div className="flex items-center space-x-2.5 overflow-x-auto py-0.5">
          {currentFolderId && (
            <button
              onClick={handleGoBack}
              className="w-7 h-7 rounded-full bg-[#181820] hover:bg-[#22222b] border border-[#272736] hover:border-purple-500/50 flex items-center justify-center text-zinc-300 hover:text-white transition active:scale-95 shadow-sm flex-shrink-0"
              title="Back / Up"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          )}

          <div className="flex items-center flex-wrap gap-1 text-xs font-semibold">
            {breadcrumbs.map((crumb, idx) => {
              const isLast = idx === breadcrumbs.length - 1;
              return (
                <React.Fragment key={crumb.id || 'root'}>
                  {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />}
                  <button
                    onClick={() => onSelectFolder(crumb.id)}
                    className={`px-2.5 py-1 rounded-lg transition truncate max-w-[160px] ${
                      isLast
                        ? 'bg-[#181822] text-purple-300 font-bold border border-[#272738]'
                        : 'text-zinc-400 hover:text-white hover:bg-[#18181f]'
                    }`}
                  >
                    {crumb.name}
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <div className="flex items-center space-x-2 flex-shrink-0">
          {!isSelectionMode && (
            <button
              onClick={() => setIsSelectionMode(true)}
              className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-300 bg-[#18181e] hover:bg-[#22222a] border border-[#272733] rounded-full transition active:scale-95"
              title="Select files"
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>Select</span>
            </button>
          )}

          <button
            onClick={() => setShowFolderModal(true)}
            className="flex items-center space-x-1.5 px-3.5 py-1.5 text-xs font-semibold text-zinc-300 bg-[#18181e] hover:bg-[#22222a] border border-[#272733] rounded-full transition active:scale-95"
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>New Folder</span>
          </button>

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center space-x-1.5 px-4 py-1.5 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 hover:from-purple-500 hover:to-violet-400 rounded-full shadow-glow-purple transition active:scale-95 disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload</span>
          </button>

          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
        </div>
      </div>

      {uploadMessage && (
        <div className="p-3 bg-purple-950/30 text-purple-300 text-xs font-medium rounded-xl border border-purple-800/40 flex items-center space-x-2 shadow-glow-purple">
          <span>{uploadMessage}</span>
        </div>
      )}

      {/* Current Folder Title & Stats */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center space-x-2">
          <Folder className="w-5 h-5 text-purple-400" />
          <h3 className="text-base font-bold text-white">
            {currentFolder ? currentFolder.name : 'My Drive'}
          </h3>
          <span className="text-xs text-zinc-500">
            ({folders.length} folders, {files.length} files)
          </span>
        </div>

        {currentFolderId && currentFolder && (
          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                setRenameFolder(currentFolder);
                setRenameFolderName(currentFolder.name);
              }}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold text-zinc-400 hover:text-amber-400 bg-[#16161c] hover:bg-amber-950/30 border border-[#272733] hover:border-amber-800/40 transition active:scale-95"
              title="Rename this folder"
            >
              <Pencil className="w-3.5 h-3.5 text-amber-400" />
              <span>Rename</span>
            </button>
            <button
              onClick={() => handleDeleteFolder(currentFolder._id, currentFolder.name)}
              className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold text-zinc-400 hover:text-red-400 bg-[#16161c] hover:bg-red-950/30 border border-[#272733] hover:border-red-800/40 transition active:scale-95"
              title="Move this folder and its files to Trash"
            >
              <Trash2 className="w-3.5 h-3.5 text-red-400" />
              <span>Delete Folder</span>
            </button>
          </div>
        )}
      </div>

      {/* Folders Section */}
      {folders.length > 0 && (
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {folders.map((folder) => (
              <div
                key={folder._id}
                onClick={() => onSelectFolder(folder._id)}
                className="flex items-center justify-between p-3.5 bg-[#111114] hover:bg-[#18181f] border border-[#222227] hover:border-purple-500/40 rounded-2xl cursor-pointer transition shadow-sm group"
              >
                <div className="flex items-center space-x-2.5 min-w-0">
                  <Folder className="w-4 h-4 text-purple-400 flex-shrink-0 group-hover:scale-110 transition" />
                  <span className="text-xs font-semibold text-zinc-200 truncate">{folder.name}</span>
                </div>
                <FolderKebabMenu folder={folder} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files Table */}
      <div className="bg-[#111114] rounded-2xl border border-[#222227] shadow-lg">
        {files.length === 0 && folders.length === 0 && !(!currentFolderId && recentFiles.length > 0) ? (
          <div className="p-16 text-center text-zinc-500 space-y-2">
            <Folder className="w-12 h-12 mx-auto text-zinc-700" />
            <p className="text-sm font-semibold text-zinc-300">This folder is empty</p>
            <p className="text-xs text-zinc-500">Upload files or create subfolders to get started</p>
          </div>
        ) : files.length > 0 ? (
          <div className="overflow-x-auto min-h-[340px] pb-16">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#141418] border-b border-[#222227] text-zinc-400 uppercase font-semibold text-[10px] tracking-wider rounded-t-2xl">
                <tr>
                  {isSelectionMode && (
                    <th className="py-3 pl-4 pr-1 w-8">
                      <button
                        onClick={() => {
                          if (selectedFileIds.size === files.length) deselectAllFiles();
                          else selectAllFiles();
                        }}
                        className="text-zinc-500 hover:text-purple-400 transition"
                      >
                        {selectedFileIds.size === files.length && files.length > 0 ? (
                          <CheckSquare className="w-4 h-4 text-purple-400" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                    </th>
                  )}
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Sources</th>
                  <th className="py-3 px-4">Date Added</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181f]">
                {files.map((file, idx) => renderFileRow(file, true, idx, files.length))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* Recent Files (Root only) */}
      {!currentFolderId && recentFiles.length > 0 && (
        <div className="space-y-3 pt-3">
          <div className="flex items-center space-x-2 px-1">
            <Clock className="w-4 h-4 text-purple-400" />
            <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Recently Added Files</h4>
            <span className="text-[11px] text-zinc-500">({recentFiles.length})</span>
          </div>
          <div className="bg-[#111114] rounded-2xl border border-[#222227] shadow-lg">
            <div className="overflow-x-auto min-h-[340px] pb-16">
              <table className="w-full text-left text-xs">
                <thead className="bg-[#141418] border-b border-[#222227] text-zinc-400 uppercase font-semibold text-[10px] tracking-wider rounded-t-2xl">
                  <tr>
                    {isSelectionMode && <th className="py-3 pl-4 pr-1 w-8"></th>}
                    <th className="py-3 px-4">Name</th>
                    <th className="py-3 px-4">Size</th>
                    <th className="py-3 px-4">Date Added</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#18181f]">
                  {recentFiles.map((file, idx) => renderFileRow(file, false, idx, recentFiles.length))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ======== MULTI-SELECT FLOATING ACTION BAR ======== */}
      {isSelectionMode && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center space-x-2 px-4 py-2.5 bg-[#1a1a28] border border-purple-500/40 rounded-2xl shadow-2xl shadow-purple-900/30 backdrop-blur-md">
          <span className="text-xs font-bold text-purple-300 mr-2">
            {selectedFileIds.size} selected
          </span>
          <button
            onClick={() => { if (selectedFileIds.size === files.length) deselectAllFiles(); else selectAllFiles(); }}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#22222b] transition"
            title={selectedFileIds.size === files.length ? 'Deselect All' : 'Select All'}
          >
            {selectedFileIds.size === files.length && files.length > 0 ? <XCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          </button>
          <div className="w-px h-5 bg-[#333]" />
          <button onClick={handleBulkFavorite} disabled={selectedFileIds.size === 0} className="p-2 rounded-lg text-zinc-400 hover:text-pink-400 hover:bg-pink-950/30 transition disabled:opacity-30" title="Favorite selected">
            <Heart className="w-4 h-4" />
          </button>
          <button onClick={() => { setIsBulkMove(true); setMoveFile(null); setMoveTargetFolderId(null); }} disabled={selectedFileIds.size === 0} className="p-2 rounded-lg text-zinc-400 hover:text-cyan-400 hover:bg-cyan-950/30 transition disabled:opacity-30" title="Move to folder">
            <FolderInput className="w-4 h-4" />
          </button>
          {devices.length > 0 && (
            <button onClick={handleBulkSendToDevice} disabled={selectedFileIds.size === 0} className="p-2 rounded-lg text-zinc-400 hover:text-green-400 hover:bg-green-950/30 transition disabled:opacity-30" title="Send to device">
              <Smartphone className="w-4 h-4" />
            </button>
          )}
          <button onClick={handleBulkTrash} disabled={selectedFileIds.size === 0} className="p-2 rounded-lg text-zinc-400 hover:text-red-400 hover:bg-red-950/30 transition disabled:opacity-30" title="Move to trash">
            <Trash2 className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-[#333]" />
          <button onClick={exitSelectionMode} className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-[#22222b] transition" title="Cancel selection">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ======== FILE PREVIEW LIGHTBOX ======== */}
      {previewFile && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={closePreview}>
          {previewLoading && (
            <div
              className="absolute top-0 left-0 right-0 h-[3px] overflow-hidden bg-purple-950/20 z-50 pointer-events-none transition-opacity duration-300"
              style={{ opacity: globalProgress.isFading ? 0 : 1 }}
            >
              <div
                className="h-full bg-gradient-to-r from-purple-500 via-indigo-400 to-purple-400 single-progress-bar"
                style={{
                  width: `${globalProgress.progress}%`,
                }}
              />
            </div>
          )}
          <button onClick={closePreview} className="absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-white transition">
            <X className="w-5 h-5" />
          </button>
          <div className="absolute top-4 left-4 z-50 flex items-center space-x-3 max-w-[60%]">
            <span className="text-sm font-semibold text-white truncate">{previewFile.filename}</span>
            <span className="text-xs text-zinc-400">{formatBytes(previewFile.sizeBytes)}</span>
          </div>
          <a href={getStreamUrl(previewFile._id)} download={previewFile.filename} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="absolute top-4 right-16 z-50 w-10 h-10 rounded-full bg-zinc-800/80 hover:bg-purple-700 flex items-center justify-center text-white transition" title="Download">
            <Download className="w-5 h-5" />
          </a>
          <div className="max-w-[90vw] max-h-[85vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {previewLoading ? (
              <div className="flex flex-col items-center space-y-3">
                <Loader2 className="w-10 h-10 text-purple-400 animate-spin" />
                <span className="text-sm text-zinc-400">Decrypting file...</span>
              </div>
            ) : previewError ? (
              <div className="max-w-md p-6 bg-[#16161d] border border-purple-500/30 rounded-2xl text-center space-y-3 shadow-glow-purple">
                <div className="w-12 h-12 rounded-full bg-purple-950/60 border border-purple-800/50 flex items-center justify-center mx-auto text-purple-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h4 className="text-sm font-bold text-white">Preview Unavailable</h4>
                <p className="text-xs text-zinc-300 leading-relaxed">{previewError}</p>
                <div className="pt-2">
                  <a href={getStreamUrl(previewFile._id)} download={previewFile.filename} className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-full transition">
                    <Download className="w-3.5 h-3.5" />
                    <span>Download File Directly</span>
                  </a>
                </div>
              </div>
            ) : previewUrl ? (
              previewFile.mimeType.startsWith('image/') ? (
                <img src={previewUrl} alt={previewFile.filename} className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl" onError={() => setPreviewError('Unable to display image. The file may be corrupt or encrypted without a valid key.')} />
              ) : previewFile.mimeType.startsWith('video/') ? (
                <video src={previewUrl} controls autoPlay className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl" onError={() => setPreviewError('Unable to play video format in this browser.')}>
                  Your browser does not support the video tag.
                </video>
              ) : previewFile.mimeType.includes('pdf') || previewFile.filename.toLowerCase().endsWith('.pdf') ? (
                <div className="w-[85vw] max-w-5xl h-[82vh] rounded-2xl overflow-hidden bg-[#18181f] border border-[#272733] shadow-2xl flex flex-col">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-[#141418] border-b border-[#272733]">
                    <div className="flex items-center space-x-2 text-xs text-zinc-300">
                      <span>📄</span>
                      <span className="font-semibold truncate max-w-md">{previewFile.filename}</span>
                    </div>
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center space-x-1 px-3 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 hover:text-purple-300 border border-purple-500/30 rounded-lg text-xs font-medium transition"
                    >
                      <span>Open in New Tab</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                  <iframe
                    src={previewUrl}
                    title={previewFile.filename}
                    className="w-full h-full border-0 bg-white"
                  />
                </div>
              ) : null
            ) : (
              <div className="text-zinc-400 text-sm">Unable to load preview</div>
            )}
          </div>
        </div>
      )}

      {/* ======== NEW FOLDER MODAL ======== */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#111114] border border-[#222227] rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="font-bold text-white text-base">Create New Folder</h3>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="e.g. Travel 2026" className="w-full px-3.5 py-2.5 bg-[#18181f] border border-[#272733] rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500" autoFocus />
              <div className="flex justify-end space-x-2 pt-1">
                <button type="button" onClick={() => setShowFolderModal(false)} className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-[#18181f] rounded-full transition">Cancel</button>
                <button type="submit" className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 rounded-full shadow-glow-purple hover:from-purple-500 hover:to-violet-400 transition">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======== RENAME FOLDER MODAL ======== */}
      {renameFolder && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#111114] border border-[#222227] rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-amber-600/20 text-amber-400 border border-amber-500/30">
                <Pencil className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-white text-base">Rename Folder</h3>
            </div>
            <form onSubmit={handleRenameFolder} className="space-y-4">
              <input
                type="text"
                value={renameFolderName}
                onChange={(e) => setRenameFolderName(e.target.value)}
                placeholder="Folder name"
                className="w-full px-3.5 py-2.5 bg-[#18181f] border border-[#272733] rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setRenameFolder(null); setRenameFolderName(''); }}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-[#18181f] rounded-full transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={renamingFolder || !renameFolderName.trim() || renameFolderName.trim() === renameFolder.name}
                  className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-amber-600 to-orange-500 rounded-full shadow hover:from-amber-500 hover:to-orange-400 transition disabled:opacity-50"
                >
                  {renamingFolder ? 'Renaming...' : 'Rename'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======== RENAME FILE MODAL ======== */}
      {renameFile && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#111114] border border-[#222227] rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-amber-600/20 text-amber-400 border border-amber-500/30">
                <Pencil className="w-4 h-4" />
              </div>
              <h3 className="font-bold text-white text-base">Rename File</h3>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); handleRename(); }} className="space-y-4">
              <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} className="w-full px-3.5 py-2.5 bg-[#18181f] border border-[#272733] rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500" autoFocus />
              <div className="flex justify-end space-x-2 pt-1">
                <button type="button" onClick={() => { setRenameFile(null); setRenameValue(''); }} className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-[#18181f] rounded-full transition">Cancel</button>
                <button type="submit" disabled={renaming || !renameValue.trim()} className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-amber-600 to-orange-500 rounded-full shadow hover:from-amber-500 hover:to-orange-400 transition disabled:opacity-50">
                  {renaming ? 'Renaming...' : 'Rename'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ======== MOVE TO FOLDER MODAL ======== */}
      {(moveFile || isBulkMove) && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#111114] border border-[#222227] rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center space-x-2.5">
              <div className="p-2 rounded-xl bg-cyan-600/20 text-cyan-400 border border-cyan-500/30">
                <FolderInput className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-white text-base">Move to Folder</h3>
                <p className="text-[11px] text-zinc-400">
                  {isBulkMove ? `Moving ${selectedFileIds.size} file(s)` : `Moving "${moveFile?.filename}"`}
                </p>
              </div>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              <div onClick={() => setMoveTargetFolderId(null)} className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition ${moveTargetFolderId === null ? 'bg-purple-950/40 border-purple-500 text-white' : 'bg-[#121219] border-[#222230] text-zinc-300 hover:border-zinc-700'}`}>
                <div className="flex items-center space-x-3">
                  <Folder className="w-4 h-4 text-purple-400" />
                  <span className="text-xs font-semibold">My Drive (Root)</span>
                </div>
                {moveTargetFolderId === null && <Check className="w-4 h-4 text-purple-400" />}
              </div>
              {moveFolders.map((f) => (
                <div key={f._id} onClick={() => setMoveTargetFolderId(f._id)} className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition ${moveTargetFolderId === f._id ? 'bg-purple-950/40 border-purple-500 text-white' : 'bg-[#121219] border-[#222230] text-zinc-300 hover:border-zinc-700'}`}>
                  <div className="flex items-center space-x-3">
                    <Folder className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold">{f.name}</span>
                  </div>
                  {moveTargetFolderId === f._id && <Check className="w-4 h-4 text-purple-400" />}
                </div>
              ))}
            </div>
            <div className="flex justify-end space-x-2 pt-1">
              <button onClick={() => { setMoveFile(null); setIsBulkMove(false); setMoveTargetFolderId(null); }} className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-[#18181f] rounded-full transition">Cancel</button>
              <button onClick={handleMove} disabled={moving} className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-cyan-600 to-blue-500 rounded-full shadow hover:from-cyan-500 hover:to-blue-400 transition disabled:opacity-50 flex items-center space-x-1.5">
                {moving ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Moving...</span></>) : (<><FolderInput className="w-3.5 h-3.5" /><span>Move Here</span></>)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======== FILE DETAILS MODAL ======== */}
      {detailsFile && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#111114] border border-[#222227] rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-zinc-700/40 text-zinc-300 border border-zinc-600/30">
                  <Info className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-white text-base">File Details</h3>
              </div>
              <button onClick={() => setDetailsFile(null)} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div className="bg-[#18181f] rounded-xl p-3 space-y-2.5 border border-[#272733]">
                <div className="flex justify-between"><span className="text-zinc-500">Filename</span><span className="text-white font-semibold truncate max-w-[60%] text-right">{detailsFile.filename}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Type</span><span className="text-zinc-300">{detailsFile.mimeType}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Size</span><span className="text-zinc-300">{formatBytes(detailsFile.sizeBytes)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Created</span><span className="text-zinc-300">{new Date(detailsFile.createdAt).toLocaleString()}</span></div>
                {detailsFile.metadata?.takenAt && (
                  <div className="flex justify-between"><span className="text-purple-400 font-semibold">Taken Date & Time</span><span className="text-purple-300 font-medium">{new Date(detailsFile.metadata.takenAt).toLocaleString()}</span></div>
                )}
                <div className="flex justify-between"><span className="text-zinc-500">Modified</span><span className="text-zinc-300">{new Date(detailsFile.updatedAt).toLocaleString()}</span></div>
              </div>
              <div className="bg-[#18181f] rounded-xl p-3 space-y-2.5 border border-[#272733]">
                <div className="flex justify-between"><span className="text-zinc-500">Favorite</span><span className={detailsFile.isFavorite ? 'text-pink-400' : 'text-zinc-500'}>{detailsFile.isFavorite ? '♥ Yes' : 'No'}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Encryption</span><span className={detailsFile.versions?.[0]?.isEncrypted ? 'text-purple-400' : 'text-zinc-400'}>{detailsFile.versions?.[0]?.isEncrypted ? '🔒 AES-256-GCM E2EE' : 'Standard'}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Version</span><span className="text-zinc-300">v{detailsFile.currentVersion}</span></div>
                <div className="flex justify-between"><span className="text-zinc-500">Sources</span><span className="text-zinc-300">{detailsFile.sourceDeviceIds.length > 0 ? `${detailsFile.sourceDeviceIds.length} device(s)` : 'Cloud upload'}</span></div>
                {detailsFile.folderName && <div className="flex justify-between"><span className="text-zinc-500">Folder</span><span className="text-zinc-300">{detailsFile.folderName}</span></div>}
                {detailsFile.storageAccountName && <div className="flex justify-between"><span className="text-zinc-500">Storage</span><span className="text-zinc-300">{detailsFile.storageAccountName}</span></div>}
              </div>
              {detailsFile.metadata && (detailsFile.metadata.width || detailsFile.metadata.duration) && (
                <div className="bg-[#18181f] rounded-xl p-3 space-y-2.5 border border-[#272733]">
                  {detailsFile.metadata.width && detailsFile.metadata.height && <div className="flex justify-between"><span className="text-zinc-500">Resolution</span><span className="text-zinc-300">{detailsFile.metadata.width} × {detailsFile.metadata.height}</span></div>}
                  {detailsFile.metadata.duration && <div className="flex justify-between"><span className="text-zinc-500">Duration</span><span className="text-zinc-300">{Math.floor(detailsFile.metadata.duration / 60)}:{String(Math.floor(detailsFile.metadata.duration % 60)).padStart(2, '0')}</span></div>}
                  {detailsFile.metadata.cameraMake && <div className="flex justify-between"><span className="text-zinc-500">Camera</span><span className="text-zinc-300">{detailsFile.metadata.cameraMake} {detailsFile.metadata.cameraModel || ''}</span></div>}
                  {detailsFile.metadata.takenAt && <div className="flex justify-between"><span className="text-zinc-500">Taken At</span><span className="text-zinc-300">{new Date(detailsFile.metadata.takenAt).toLocaleString()}</span></div>}
                </div>
              )}
              <div className="flex justify-between items-center pt-1">
                <span className="text-[10px] text-zinc-600 font-mono">{detailsFile._id}</span>
                <a href={getStreamUrl(detailsFile._id)} download={detailsFile.filename} className="inline-flex items-center space-x-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-full transition">
                  <Download className="w-3 h-3" />
                  <span>Download</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======== FORCE DOWNLOAD TO DEVICE MODAL ======== */}
      {(forceDownloadFile || forceDownloadFileIds.length > 0) && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#15151e] border border-[#2d2d3e] rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="p-2 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Send to Paired Device</h3>
                  <p className="text-[11px] text-zinc-400">Trigger automatic download on device</p>
                </div>
              </div>
              <button onClick={() => { setForceDownloadFile(null); setForceDownloadFileIds([]); }} className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="bg-[#101017] p-3 rounded-xl border border-[#20202d] text-xs text-zinc-300">
              <span className="text-zinc-500">{forceDownloadFileIds.length > 0 ? 'Files: ' : 'File: '}</span>
              <span className="font-semibold text-purple-300">{forceDownloadFileIds.length > 0 ? `${forceDownloadFileIds.length} selected file(s)` : forceDownloadFile?.filename}</span>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-semibold text-zinc-300">Select Target Device:</label>
              {devices.length === 0 ? (
                <p className="text-xs text-amber-400 bg-amber-950/20 p-3 rounded-xl border border-amber-800/30">No paired devices found. Pair an Android or mobile device first.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {devices.map((dev) => (
                    <div key={dev.deviceId} onClick={() => setSelectedTargetDeviceId(dev.deviceId)} className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between transition ${selectedTargetDeviceId === dev.deviceId ? 'bg-purple-950/40 border-purple-500 text-white' : 'bg-[#121219] border-[#222230] text-zinc-300 hover:border-zinc-700'}`}>
                      <div className="flex items-center space-x-3">
                        <Smartphone className="w-4 h-4 text-purple-400" />
                        <div>
                          <p className="text-xs font-semibold">{dev.deviceName}</p>
                          <p className="text-[10px] text-zinc-500 uppercase">{dev.deviceType} • {dev.status === 'online' ? 'Online' : 'Offline'}</p>
                        </div>
                      </div>
                      {selectedTargetDeviceId === dev.deviceId && <Check className="w-4 h-4 text-purple-400" />}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end space-x-3 pt-2">
              <button onClick={() => { setForceDownloadFile(null); setForceDownloadFileIds([]); }} className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition">Cancel</button>
              <button disabled={devices.length === 0 || !selectedTargetDeviceId || sendingForceDownload} onClick={handleExecuteForceDownload} className="px-4 py-2 text-xs font-semibold rounded-xl bg-purple-600 hover:bg-purple-500 text-white border border-purple-400/40 shadow-glow-purple disabled:opacity-40 transition flex items-center space-x-1.5 active:scale-95">
                {sendingForceDownload ? (<><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Dispatching...</span></>) : (<><Send className="w-3.5 h-3.5" /><span>Send Download Signal</span></>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
