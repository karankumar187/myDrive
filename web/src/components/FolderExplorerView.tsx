import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FileItem, FolderItem, BreadcrumbItem } from '../types.js';
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
} from 'lucide-react';
import { api } from '../services/api.js';
import { VaultCryptoService } from '../services/vault-crypto.js';

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
}) => {
  const [uploading, setUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [showFolderModal, setShowFolderModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File Preview state
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <ImageIcon className="w-4 h-4 text-purple-400" />;
    if (mimeType.startsWith('video/')) return <Film className="w-4 h-4 text-red-400" />;
    if (mimeType.includes('pdf') || mimeType.includes('document'))
      return <FileText className="w-4 h-4 text-blue-400" />;
    return <File className="w-4 h-4 text-zinc-400" />;
  };

  const isPreviewable = (mimeType: string) => {
    return mimeType.startsWith('image/') || mimeType.startsWith('video/');
  };

  const getStreamUrl = (fileId: string) => {
    const token = localStorage.getItem('drive_token') || '';
    const rawApiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
    return `${rawApiUrl}/api/v1/files/${fileId}/stream?token=${encodeURIComponent(token)}`;
  };

  // Open file preview - fetch, decrypt if needed, and display
  const handleFileClick = useCallback(async (file: FileItem) => {
    if (!isPreviewable(file.mimeType)) {
      // For non-media files, just download
      window.open(getStreamUrl(file._id), '_blank');
      return;
    }

    setPreviewFile(file);
    setPreviewLoading(true);
    setPreviewUrl(null);
    setPreviewError(null);

    const isEncrypted = file.versions && file.versions.length > 0 && file.versions[0].isEncrypted;

    if (isEncrypted && !vaultKey) {
      setPreviewLoading(false);
      setPreviewError('🔒 This file was saved with Zero-Knowledge Encryption. Unlock your Vault (in the top bar) using your master passphrase to decrypt and view it.');
      return;
    }

    try {
      const response = await fetch(getStreamUrl(file._id));
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || `Server returned ${response.status}`);
      }

      if (isEncrypted && vaultKey) {
        const encryptedBuffer = await response.arrayBuffer();
        const ivHex = file.versions![0].iv || '';
        const decryptedBuffer = await VaultCryptoService.decryptBuffer(encryptedBuffer, ivHex, vaultKey);
        const blob = new Blob([decryptedBuffer], { type: file.mimeType });
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      } else {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setPreviewUrl(url);
      }
    } catch (err: any) {
      console.error('File load failed:', err);
      setPreviewError(err.message || 'Failed to load file preview');
    } finally {
      setPreviewLoading(false);
    }
  }, [vaultKey]);

  // Cleanup object URL on close
  const closePreview = useCallback(() => {
    if (previewUrl && previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewFile(null);
    setPreviewUrl(null);
    setPreviewError(null);
  }, [previewUrl]);

  // Close preview on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && previewFile) {
        closePreview();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewFile, closePreview]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles || selectedFiles.length === 0) return;

    setUploading(true);
    setUploadMessage(null);

    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      try {
        setUploadMessage(`Processing ${file.name}...`);
        const buffer = await file.arrayBuffer();

        // 1. Calculate raw SHA-256 hash for deduplication
        const contentHash = await VaultCryptoService.calculateSha256(buffer);

        // 2. Zero-Knowledge Encryption if vault unlocked
        let uploadPayloadBuffer = buffer;
        let isEncrypted = false;
        let ivHex: string | undefined;

        if (vaultKey) {
          setUploadMessage(`Encrypting ${file.name} with AES-256-GCM...`);
          const encrypted = await VaultCryptoService.encryptBuffer(buffer, vaultKey);
          uploadPayloadBuffer = await encrypted.encryptedBlob.arrayBuffer();
          isEncrypted = true;
          ivHex = encrypted.ivHex;
        }

        // 3. Initiate Upload
        setUploadMessage(`Allocating storage pool for ${file.name}...`);
        const initResult = await api.initiateUpload({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          contentHash,
          folderId: currentFolderId,
          isEncrypted,
        });

        if (initResult.isDuplicate) {
          setUploadMessage(`✨ ${file.name} is an exact duplicate! Linked instantly without uploading bytes.`);
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }

        // 4. Stream bytes to Google Drive resumable session
        setUploadMessage(`Uploading to ${initResult.targetAccountEmail}...`);
        const uploadUrl = initResult.uploadSessionUrl.startsWith('http')
          ? initResult.uploadSessionUrl
          : `${import.meta.env.VITE_API_URL || ''}${initResult.uploadSessionUrl}`;

        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': isEncrypted ? 'application/octet-stream' : file.type || 'application/octet-stream',
          },
          body: uploadPayloadBuffer,
        });

        if (!putRes.ok && putRes.status !== 200 && putRes.status !== 201) {
          throw new Error(`Upload stream failed: ${putRes.statusText}`);
        }

        // Parse real Google Drive file ID if returned by Google
        let realProviderFileId = initResult.driveOpaqueName || `file_${Date.now()}`;
        try {
          const putJson = await putRes.json();
          if (putJson && putJson.id) {
            realProviderFileId = putJson.id;
          }
        } catch {
          // If response body is empty or non-JSON (e.g. dev mock), keep opaque name
        }

        // 5. Finalize upload
        await api.completeUpload({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          contentHash,
          storageAccountId: initResult.storageAccountId,
          providerFileId: realProviderFileId,
          folderId: currentFolderId,
          isEncrypted,
          iv: ivHex,
        });

        setUploadMessage(`✅ Successfully backed up ${file.name}`);
      } catch (err: any) {
        alert(`Failed to upload ${file.name}: ${err.message}`);
      }
    }

    setUploading(false);
    onRefresh();
    if (fileInputRef.current) fileInputRef.current.value = '';
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

  const handleDeleteFolder = async (folderId: string, folderName: string) => {
    if (!confirm(`Are you sure you want to move folder "${folderName}" and all its files to Trash?`)) {
      return;
    }
    try {
      await api.deleteFolder(folderId);
      if (currentFolderId === folderId) {
        onSelectFolder(currentFolder?.parentFolderId || null);
      }
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

  // Reusable file row renderer
  const renderFileRow = (file: FileItem, showSources: boolean = true) => (
    <tr key={file._id} className="hover:bg-[#15151a] transition group">
      <td
        className="py-3 px-4 flex items-center space-x-3 cursor-pointer"
        onClick={() => handleFileClick(file)}
      >
        {getFileIcon(file.mimeType)}
        <span className={`font-semibold text-zinc-200 group-hover:text-purple-300 transition truncate max-w-[280px] ${isPreviewable(file.mimeType) ? 'hover:underline' : ''}`}>
          {file.filename}
        </span>
        {isPreviewable(file.mimeType) && (
          <span className="text-[10px] text-zinc-600 group-hover:text-purple-500 transition">
            {file.mimeType.startsWith('image/') ? '🖼' : '▶'}
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
      <td className="py-3 px-4 text-right space-x-2">
        <a
          href={getStreamUrl(file._id)}
          target="_blank"
          rel="noreferrer"
          download={file.filename}
          className="inline-p-1 text-zinc-400 hover:text-purple-400 transition"
          title="Download"
          onClick={(e) => e.stopPropagation()}
        >
          <Download className="w-4 h-4 inline" />
        </a>
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleTrashFile(file._id, file.filename);
          }}
          className="inline-p-1 text-zinc-500 hover:text-red-400 transition"
          title="Move to Trash"
        >
          <Trash2 className="w-4 h-4 inline" />
        </button>
      </td>
    </tr>
  );

  return (
    <div className="space-y-5">
      {/* Top Action & Navigation Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#111114] p-4 rounded-2xl border border-[#222227] shadow-lg">
        {/* Small full rounded < up button & Accurate Breadcrumb Trail */}
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

        {/* Right Actions */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {vaultKey && (
            <span className="inline-flex items-center px-2.5 py-1 text-[11px] font-semibold text-purple-300 bg-purple-950/40 border border-purple-800/40 rounded-full shadow-glow-purple">
              <ShieldCheck className="w-3 h-3 mr-1 text-purple-400" />
              E2EE Active
            </span>
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

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileUpload}
          />
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
          <button
            onClick={() => handleDeleteFolder(currentFolder._id, currentFolder.name)}
            className="flex items-center space-x-1.5 px-3 py-1 rounded-full text-xs font-semibold text-zinc-400 hover:text-red-400 bg-[#16161c] hover:bg-red-950/30 border border-[#272733] hover:border-red-800/40 transition active:scale-95"
            title="Move this folder and its files to Trash"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span>Delete Folder</span>
          </button>
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFolder(folder._id, folder.name);
                  }}
                  className="p-1 text-zinc-500 hover:text-red-400 hover:bg-red-950/40 rounded-lg transition opacity-0 group-hover:opacity-100 flex-shrink-0 ml-1"
                  title="Delete Folder"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Files Table (Inside Current Folder) */}
      <div className="bg-[#111114] rounded-2xl border border-[#222227] shadow-lg overflow-hidden">
        {files.length === 0 && folders.length === 0 && !(!currentFolderId && recentFiles.length > 0) ? (
          <div className="p-16 text-center text-zinc-500 space-y-2">
            <Folder className="w-12 h-12 mx-auto text-zinc-700" />
            <p className="text-sm font-semibold text-zinc-300">This folder is empty</p>
            <p className="text-xs text-zinc-500">Upload files or create subfolders to get started</p>
          </div>
        ) : files.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#141418] border-b border-[#222227] text-zinc-400 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Sources</th>
                  <th className="py-3 px-4">Date Added</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181f]">
                {files.map((file) => renderFileRow(file, true))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>

      {/* In My Drive root: Show Recent Added Files Across All Folders */}
      {!currentFolderId && recentFiles.length > 0 && (
        <div className="space-y-3 pt-3">
          <div className="flex items-center space-x-2 px-1">
            <Clock className="w-4 h-4 text-purple-400" />
            <h4 className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
              Recently Added Files
            </h4>
            <span className="text-[11px] text-zinc-500">({recentFiles.length})</span>
          </div>

          <div className="bg-[#111114] rounded-2xl border border-[#222227] shadow-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#141418] border-b border-[#222227] text-zinc-400 uppercase font-semibold text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Date Added</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#18181f]">
                {recentFiles.map((file) => renderFileRow(file, false))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ======== FILE PREVIEW LIGHTBOX ======== */}
      {previewFile && (
        <div
          className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm"
          onClick={closePreview}
        >
          {/* Close Button */}
          <button
            onClick={closePreview}
            className="absolute top-4 right-4 z-50 w-10 h-10 rounded-full bg-zinc-800/80 hover:bg-zinc-700 flex items-center justify-center text-white transition"
          >
            <X className="w-5 h-5" />
          </button>

          {/* File Info Header */}
          <div className="absolute top-4 left-4 z-50 flex items-center space-x-3 max-w-[60%]">
            <span className="text-sm font-semibold text-white truncate">{previewFile.filename}</span>
            <span className="text-xs text-zinc-400">{formatBytes(previewFile.sizeBytes)}</span>
          </div>

          {/* Download Button */}
          <a
            href={getStreamUrl(previewFile._id)}
            download={previewFile.filename}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-4 right-16 z-50 w-10 h-10 rounded-full bg-zinc-800/80 hover:bg-purple-700 flex items-center justify-center text-white transition"
            title="Download"
          >
            <Download className="w-5 h-5" />
          </a>

          <div
            className="max-w-[90vw] max-h-[85vh] flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
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
                  <a
                    href={getStreamUrl(previewFile._id)}
                    download={previewFile.filename}
                    className="inline-flex items-center space-x-1.5 px-4 py-2 text-xs font-semibold text-white bg-purple-600 hover:bg-purple-500 rounded-full transition"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download File Directly</span>
                  </a>
                </div>
              </div>
            ) : previewUrl ? (
              previewFile.mimeType.startsWith('image/') ? (
                <img
                  src={previewUrl}
                  alt={previewFile.filename}
                  className="max-w-[90vw] max-h-[85vh] object-contain rounded-lg shadow-2xl"
                  onError={() => {
                    setPreviewError('Unable to display image. The file may be corrupt or encrypted without a valid key.');
                  }}
                />
              ) : previewFile.mimeType.startsWith('video/') ? (
                <video
                  src={previewUrl}
                  controls
                  autoPlay
                  className="max-w-[90vw] max-h-[85vh] rounded-lg shadow-2xl"
                  onError={() => {
                    setPreviewError('Unable to play video format in this browser.');
                  }}
                >
                  Your browser does not support the video tag.
                </video>
              ) : null
            ) : (
              <div className="text-zinc-400 text-sm">Unable to load preview</div>
            )}
          </div>
        </div>
      )}

      {/* New Folder Modal */}
      {showFolderModal && (
        <div className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-[#111114] border border-[#222227] rounded-3xl p-6 max-w-sm w-full shadow-2xl space-y-4">
            <h3 className="font-bold text-white text-base">Create New Folder</h3>
            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. Travel 2026"
                className="w-full px-3.5 py-2.5 bg-[#18181f] border border-[#272733] rounded-xl text-sm text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                autoFocus
              />
              <div className="flex justify-end space-x-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowFolderModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:bg-[#18181f] rounded-full transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-bold text-white bg-gradient-to-r from-purple-600 to-violet-500 rounded-full shadow-glow-purple hover:from-purple-500 hover:to-violet-400 transition"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
