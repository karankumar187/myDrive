import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Lock,
  Unlock,
  ShieldCheck,
  Upload,
  Search,
  FileText,
  Film,
  Image as ImageIcon,
  Download,
  Trash2,
  ExternalLink,
  RefreshCw,
  FolderInput,
  KeyRound,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  FileArchive,
  Music,
  X,
  MoreVertical,
} from 'lucide-react';
import { api } from '../services/api.js';
import { VaultCryptoService } from '../services/vault-crypto.js';
import { FileItem } from '../types.js';
import { FullScreenViewer } from './FullScreenViewer.js';

interface PrivateVaultViewProps {
  vaultKey: CryptoKey;
  onLockVault: () => void;
}

interface DecryptedVaultFile extends FileItem {
  decryptedFilename: string;
  decryptedMimeType: string;
  decryptedSize: number;
  decryptedThumbnail?: string;
  decryptedTakenAt?: string;
  isDecrypting?: boolean;
}

export const PrivateVaultView: React.FC<PrivateVaultViewProps> = ({
  vaultKey,
  onLockVault,
}) => {
  const [files, setFiles] = useState<DecryptedVaultFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'photos' | 'videos' | 'documents'>('all');
  const [isDragging, setIsDragging] = useState(false);
  const [selectedMediaIndex, setSelectedMediaIndex] = useState<number | null>(null);
  const [uploadingFiles, setUploadingFiles] = useState<
    Array<{ id: string; name: string; progress: number; status: 'encrypting' | 'uploading' | 'done' | 'error'; error?: string }>
  >([]);
  const [actionMenuFileId, setActionMenuFileId] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load and decrypt vault files list
  const loadVaultFiles = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.listVaultFiles();
      const rawFiles = res.files || [];

      // Decrypt metadata for all files
      const decryptedList: DecryptedVaultFile[] = await Promise.all(
        rawFiles.map(async (f) => {
          let decName = f.filename;
          let decMime = f.mimeType;
          let decSize = f.sizeBytes;
          let decThumb = f.metadata?.thumbnail;
          let decTakenAt = f.metadata?.takenAt;

          if (f.encryptedMeta) {
            try {
              const meta = await VaultCryptoService.decryptMetadata(f.encryptedMeta, vaultKey);
              if (meta) {
                if (meta.originalFilename) decName = meta.originalFilename;
                if (meta.originalMimeType) decMime = meta.originalMimeType;
                if (meta.originalSize) decSize = meta.originalSize;
                if (meta.thumbnail) decThumb = meta.thumbnail;
                if (meta.takenAt) decTakenAt = meta.takenAt;
              }
            } catch (err) {
              console.warn('Failed to decrypt metadata for file', f._id, err);
            }
          } else {
            // File was moved into the vault without PIN — encrypt its metadata now in the background!
            try {
              const metaPayload = {
                originalFilename: f.filename,
                originalMimeType: f.mimeType,
                originalSize: f.sizeBytes,
                takenAt: f.metadata?.takenAt || f.createdAt,
                thumbnail: f.metadata?.thumbnail,
              };
              VaultCryptoService.encryptMetadata(metaPayload, vaultKey).then((encStr) => {
                api.moveToVault([f._id], { [f._id]: encStr }).catch(() => {});
              });
            } catch {}
          }

          // Background Zero-Knowledge byte re-encryption for moved files (converts plaintext Google Drive file to AES-256-GCM ciphertext)
          const latestVer = f.versions?.[f.versions.length - 1];
          if (!latestVer?.isEncrypted) {
            (async () => {
              try {
                const streamUrl = `/api/v1/files/${f._id}/stream`;
                const fetchRes = await fetch(streamUrl, {
                  headers: {
                    Authorization: `Bearer ${localStorage.getItem('drive_token') || ''}`,
                  },
                });
                if (!fetchRes.ok) return;
                const rawBuffer = await fetchRes.arrayBuffer();
                const { encryptedBlob, ivHex } = await VaultCryptoService.encryptBuffer(rawBuffer, vaultKey);
                const encBuf = await encryptedBlob.arrayBuffer();
                const hash = await VaultCryptoService.calculateSha256(encBuf);
                await api.reencryptVaultFile(f._id, encryptedBlob, ivHex, hash);
                console.log(`[Zero-Knowledge] File ${f._id} re-encrypted on Google Drive successfully.`);
              } catch (reErr) {
                console.warn(`[Zero-Knowledge] Background re-encryption error for ${f._id}:`, reErr);
              }
            })();
          }

          return {
            ...f,
            decryptedFilename: decName,
            decryptedMimeType: decMime,
            decryptedSize: decSize,
            decryptedThumbnail: decThumb,
            decryptedTakenAt: decTakenAt,
          };
        })
      );

      setFiles(decryptedList);
    } catch (err: any) {
      console.error('Failed to load vault files:', err);
    } finally {
      setLoading(false);
    }
  }, [vaultKey]);

  useEffect(() => {
    loadVaultFiles();
  }, [loadVaultFiles]);

  // Handle uploading and encrypting files directly to vault
  const handleUploadFiles = async (selectedFiles: FileList | File[]) => {
    const fileList = Array.from(selectedFiles);
    if (fileList.length === 0) return;

    for (const file of fileList) {
      const taskId = `vup_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      setUploadingFiles((prev) => [
        { id: taskId, name: file.name, progress: 10, status: 'encrypting' },
        ...prev,
      ]);

      try {
        // Step 1: Read file and encrypt with AES-256-GCM in browser RAM
        const arrayBuffer = await file.arrayBuffer();
        const { encryptedBlob, ivHex } = await VaultCryptoService.encryptBuffer(arrayBuffer, vaultKey);

        setUploadingFiles((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, progress: 35, status: 'encrypting' } : t))
        );

        // Step 2: Compute hash of encrypted content
        const encryptedBuffer = await encryptedBlob.arrayBuffer();
        const contentHash = await VaultCryptoService.calculateSha256(encryptedBuffer);

        // Step 3: Encrypt metadata (original filename, mime, size, timestamp)
        const metaPayload = {
          originalFilename: file.name,
          originalMimeType: file.type || 'application/octet-stream',
          originalSize: file.size,
          takenAt: new Date(file.lastModified || Date.now()).toISOString(),
        };
        const encryptedMeta = await VaultCryptoService.encryptMetadata(metaPayload, vaultKey);

        setUploadingFiles((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, progress: 45, status: 'uploading' } : t))
        );

        // Step 4: Initiate upload with backend (opaque name on Google Drive)
        const opaqueDriveName = `vault_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.enc`;
        const initRes = await api.initiateUpload({
          filename: opaqueDriveName,
          mimeType: 'application/octet-stream',
          sizeBytes: encryptedBlob.size,
          contentHash,
          isEncrypted: true,
        });

        // Step 5: Upload encrypted blob to Google Drive resumable URI
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', initRes.uploadSessionUrl, true);
          xhr.setRequestHeader('Content-Type', 'application/octet-stream');

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const uploadPct = Math.round((e.loaded / e.total) * 45); // 45% -> 90%
              setUploadingFiles((prev) =>
                prev.map((t) => (t.id === taskId ? { ...t, progress: 45 + uploadPct } : t))
              );
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201) {
              resolve();
            } else {
              reject(new Error(`Drive upload failed with status ${xhr.status}`));
            }
          };

          xhr.onerror = () => reject(new Error('Network error during Google Drive upload'));
          xhr.send(encryptedBlob);
        });

        setUploadingFiles((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, progress: 95, status: 'uploading' } : t))
        );

        // Step 6: Complete upload with backend
        await api.completeUpload({
          filename: opaqueDriveName,
          mimeType: 'application/octet-stream',
          sizeBytes: encryptedBlob.size,
          contentHash,
          storageAccountId: initRes.storageAccountId,
          providerFileId: initRes.driveOpaqueName || opaqueDriveName,
          driveOpaqueName: initRes.driveOpaqueName || opaqueDriveName,
          folderId: null,
          isEncrypted: true,
          isVault: true,
          encryptedMeta,
          iv: ivHex,
        });

        setUploadingFiles((prev) =>
          prev.map((t) => (t.id === taskId ? { ...t, progress: 100, status: 'done' } : t))
        );

        // Refresh list
        loadVaultFiles();
      } catch (err: any) {
        console.error('Vault upload error:', err);
        setUploadingFiles((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, status: 'error', error: err.message || 'Upload failed' } : t
          )
        );
      }
    }
  };

  // Download and decrypt file in-memory
  const handleDownloadDecrypted = async (file: DecryptedVaultFile) => {
    try {
      setDownloadingFileId(file._id);
      const streamUrl = `/api/v1/files/${file._id}/stream`;
      const res = await fetch(streamUrl, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('drive_token') || ''}`,
        },
      });

      if (!res.ok) throw new Error('Failed to download encrypted file from storage');
      const ciphertext = await res.arrayBuffer();

      const version = file.versions?.[file.versions.length - 1];
      const iv = version?.iv;

      // Decrypt if encrypted with IV, otherwise use raw bytes directly
      const fileBuffer = (iv && version?.isEncrypted)
        ? await VaultCryptoService.decryptBuffer(ciphertext, iv, vaultKey)
        : ciphertext;

      const blob = new Blob([fileBuffer], { type: file.decryptedMimeType || 'application/octet-stream' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = file.decryptedFilename || 'decrypted_file';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloadingFileId(null);
    }
  };

  // Move out of vault (restore to regular library)
  const handleRestoreFromVault = async (file: DecryptedVaultFile) => {
    if (!confirm(`Move "${file.decryptedFilename}" out of the private vault to your regular drive?`)) {
      return;
    }

    try {
      const version = file.versions?.[file.versions.length - 1];
      if (version?.isEncrypted && version?.iv) {
        // Download ciphertext, decrypt with vaultKey, and upload plaintext back to Google Drive
        const streamUrl = `/api/v1/files/${file._id}/stream`;
        const res = await fetch(streamUrl, {
          headers: { Authorization: `Bearer ${localStorage.getItem('drive_token') || ''}` },
        });
        if (!res.ok) throw new Error('Failed to download encrypted file for restoration');
        const ciphertext = await res.arrayBuffer();
        const decryptedBuffer = await VaultCryptoService.decryptBuffer(ciphertext, version.iv, vaultKey);
        const decryptedBlob = new Blob([decryptedBuffer], { type: file.decryptedMimeType });
        const hash = await VaultCryptoService.calculateSha256(decryptedBuffer);
        await api.restorePlaintextVaultFile(file._id, decryptedBlob, file.decryptedFilename, file.decryptedMimeType, hash);
      } else {
        await api.restoreFromVault([file._id], {
          [file._id]: {
            filename: file.decryptedFilename,
            mimeType: file.decryptedMimeType,
          },
        });
      }
      setFiles((prev) => prev.filter((f) => f._id !== file._id));
    } catch (err: any) {
      alert(`Failed to restore file: ${err.message}`);
    }
  };

  // Delete file permanently from cloud
  const handleDeletePermanently = async (file: DecryptedVaultFile) => {
    if (!confirm(`Permanently delete "${file.decryptedFilename}" from the cloud? This cannot be undone.`)) {
      return;
    }

    try {
      await api.permanentDelete(file._id);
      setFiles((prev) => prev.filter((f) => f._id !== file._id));
    } catch (err: any) {
      alert(`Failed to delete file: ${err.message}`);
    }
  };

  // Format bytes helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Filtered files
  const filteredFiles = files.filter((f) => {
    const matchesSearch =
      !searchQuery ||
      f.decryptedFilename.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (activeFilter === 'photos') return f.decryptedMimeType.startsWith('image/');
    if (activeFilter === 'videos') return f.decryptedMimeType.startsWith('video/');
    if (activeFilter === 'documents') {
      return !f.decryptedMimeType.startsWith('image/') && !f.decryptedMimeType.startsWith('video/');
    }
    return true;
  });

  const totalVaultBytes = files.reduce((acc, f) => acc + (f.decryptedSize || f.sizeBytes || 0), 0);

  const getFileIcon = (mime: string) => {
    if (mime.startsWith('image/')) return <ImageIcon className="w-5 h-5 text-zinc-300" />;
    if (mime.startsWith('video/')) return <Film className="w-5 h-5 text-zinc-300" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('rar')) {
      return <FileArchive className="w-5 h-5 text-zinc-300" />;
    }
    if (mime.startsWith('audio/')) return <Music className="w-5 h-5 text-zinc-300" />;
    return <FileText className="w-5 h-5 text-zinc-400" />;
  };

  return (
    <div
      className="min-h-[calc(100vh-4rem)] bg-[#09090b] text-white p-4 sm:p-6 lg:p-8"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files) handleUploadFiles(e.dataTransfer.files);
      }}
    >
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) handleUploadFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Drag Overlay */}
      {isDragging && (
        <div className="fixed inset-0 z-50 bg-black/85 border-4 border-dashed border-zinc-700 backdrop-blur-sm flex items-center justify-center pointer-events-none">
          <div className="bg-[#121215] border border-zinc-800 rounded-3xl p-8 flex flex-col items-center text-center shadow-2xl">
            <Upload className="w-10 h-10 text-zinc-300 animate-bounce mb-3" />
            <p className="text-base font-bold text-white">Drop files to add to Private Vault</p>
            <p className="text-xs text-zinc-400 mt-1">Encrypted before saving</p>
          </div>
        </div>
      )}

      {/* Sleek, Compact Vault Header */}
      <div className="rounded-2xl bg-[#101013] border border-zinc-800/80 px-4 py-3 sm:px-5 sm:py-3.5 mb-5 shadow-lg flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300 shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm sm:text-base font-bold text-white tracking-tight">
                Private Vault
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-zinc-800/80 text-zinc-400 border border-zinc-700/60">
                E2EE
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 mt-0.5">
              {files.length} {files.length === 1 ? 'item' : 'items'} • {formatBytes(totalVaultBytes)}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2 shrink-0">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition active:scale-95 shadow-sm"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload</span>
          </button>

          <button
            onClick={onLockVault}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white font-medium text-xs transition active:scale-95"
            title="Lock Vault"
          >
            <KeyRound className="w-3.5 h-3.5" />
            <span>Lock</span>
          </button>
        </div>
      </div>

      {/* Upload Tasks Progress Banner */}
      {uploadingFiles.length > 0 && (
        <div className="mb-5 rounded-2xl bg-[#101013] border border-zinc-800 p-3.5 space-y-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-zinc-200 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
              Encrypting & Uploading ({uploadingFiles.filter((t) => t.status !== 'done').length} remaining)
            </span>
            <button
              onClick={() => setUploadingFiles((prev) => prev.filter((t) => t.status !== 'done'))}
              className="text-[10px] text-zinc-400 hover:text-white"
            >
              Dismiss Completed
            </button>
          </div>
          <div className="space-y-2">
            {uploadingFiles.slice(0, 4).map((task) => (
              <div key={task.id} className="text-xs bg-zinc-900/60 rounded-xl p-2.5 border border-zinc-800/80">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-medium text-zinc-200 truncate max-w-[200px] sm:max-w-md">
                    {task.name}
                  </span>
                  <span className="text-[10px] font-medium text-zinc-400">
                    {task.status === 'encrypting'
                      ? 'Encrypting RAM…'
                      : task.status === 'uploading'
                      ? `${task.progress}%`
                      : task.status === 'done'
                      ? 'Encrypted & Stored'
                      : 'Error'}
                  </span>
                </div>
                <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-200 ${
                      task.status === 'error'
                        ? 'bg-red-500'
                        : task.status === 'done'
                        ? 'bg-emerald-500'
                        : 'bg-zinc-200'
                    }`}
                    style={{ width: `${task.progress}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        {/* Category Pills */}
        <div className="flex items-center space-x-1.5 overflow-x-auto pb-1 sm:pb-0">
          {(
            [
              { id: 'all', label: 'All Files' },
              { id: 'photos', label: 'Photos' },
              { id: 'videos', label: 'Videos' },
              { id: 'documents', label: 'Documents' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition ${
                activeFilter === tab.id
                  ? 'bg-zinc-100 text-zinc-950 shadow-sm'
                  : 'bg-zinc-900/80 text-zinc-400 hover:text-white border border-zinc-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-2.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search vault files…"
            className="w-full pl-9 pr-8 py-2 bg-zinc-900/80 border border-zinc-800 rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-2.5 text-zinc-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Vault Files Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <Loader2 className="w-7 h-7 animate-spin text-zinc-400 mb-3" />
          <p className="text-sm font-semibold text-zinc-300">Decrypting vault catalog…</p>
          <p className="text-xs text-zinc-500 mt-1">Unpacking client-side encrypted metadata</p>
        </div>
      ) : filteredFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center rounded-2xl bg-[#101013] border border-zinc-800/80 p-8">
          <div className="w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-bold text-white">
            {searchQuery ? 'No matching files in vault' : 'Private Vault is Empty'}
          </h3>
          <p className="text-xs text-zinc-400 max-w-sm mt-1 leading-relaxed">
            {searchQuery
              ? 'Try adjusting your search query or clear the filter.'
              : 'Add confidential files, photos, or documents to store them with client-side zero-knowledge encryption.'}
          </p>
          {!searchQuery && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="mt-4 px-4 py-2 rounded-xl bg-zinc-100 hover:bg-white text-zinc-950 font-semibold text-xs transition active:scale-95 shadow-sm flex items-center space-x-2"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Add File</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-3.5">
          {filteredFiles.map((file) => {
            const isMedia =
              file.decryptedMimeType.startsWith('image/') ||
              file.decryptedMimeType.startsWith('video/');

            const mediaFiles = filteredFiles.filter(
              (f) =>
                f.decryptedMimeType.startsWith('image/') ||
                f.decryptedMimeType.startsWith('video/')
            );

            return (
              <div
                key={file._id}
                className="group relative rounded-2xl bg-[#111114] border border-zinc-800/80 hover:border-zinc-700 p-2.5 sm:p-3 flex flex-col justify-between shadow-md hover:shadow-black/60 transition-all duration-200"
              >
                {/* Media preview or icon */}
                <div
                  onClick={() => {
                    if (isMedia) {
                      const idx = mediaFiles.findIndex((m) => m._id === file._id);
                      if (idx !== -1) setSelectedMediaIndex(idx);
                    } else {
                      handleDownloadDecrypted(file);
                    }
                  }}
                  className="relative aspect-square w-full rounded-xl bg-zinc-950 flex items-center justify-center overflow-hidden cursor-pointer select-none border border-zinc-900"
                >
                  {file.decryptedThumbnail ? (
                    <img
                      src={file.decryptedThumbnail}
                      alt={file.decryptedFilename}
                      className="w-full h-full object-cover group-hover:scale-105 transition duration-300"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center p-3 text-center">
                      {getFileIcon(file.decryptedMimeType)}
                      <span className="text-[10px] text-zinc-500 font-bold uppercase mt-1">
                        {file.decryptedFilename.split('.').pop() || 'FILE'}
                      </span>
                    </div>
                  )}

                  {/* Video Play Badge */}
                  {file.decryptedMimeType.startsWith('video/') && (
                    <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                      <div className="w-8 h-8 rounded-full bg-black/70 backdrop-blur-md border border-white/20 flex items-center justify-center text-white">
                        <Film className="w-4 h-4 text-zinc-200" />
                      </div>
                    </div>
                  )}

                  {/* E2EE Lock Badge */}
                  <div className="absolute top-1.5 left-1.5 p-1 rounded-md bg-black/70 backdrop-blur-md text-zinc-400 border border-white/5">
                    <Lock className="w-3 h-3" />
                  </div>
                </div>

                {/* File Info */}
                <div className="mt-2.5">
                  <p
                    className="text-xs font-semibold text-zinc-200 truncate group-hover:text-white transition"
                    title={file.decryptedFilename}
                  >
                    {file.decryptedFilename}
                  </p>
                  <div className="flex items-center justify-between text-[10px] text-zinc-500 mt-1">
                    <span>{formatBytes(file.decryptedSize || file.sizeBytes)}</span>
                    <span>
                      {file.decryptedTakenAt
                        ? new Date(file.decryptedTakenAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })
                        : new Date(file.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                          })}
                    </span>
                  </div>
                </div>

                {/* Action Toolbar on Hover */}
                <div className="mt-2 pt-2 border-t border-zinc-800/80 flex items-center justify-between">
                  <button
                    onClick={() => handleDownloadDecrypted(file)}
                    disabled={downloadingFileId === file._id}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                    title="Decrypt & Download"
                  >
                    {downloadingFileId === file._id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-zinc-400" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <button
                    onClick={() => handleRestoreFromVault(file)}
                    className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                    title="Move out of vault to standard drive"
                  >
                    <FolderInput className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => handleDeletePermanently(file)}
                    className="p-1.5 text-zinc-400 hover:text-red-400 rounded-lg hover:bg-zinc-800 transition"
                    title="Delete permanently"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full-Screen Decrypted Media Viewer */}
      {selectedMediaIndex !== null && (
        <FullScreenViewer
          mediaList={filteredFiles.filter(
            (f) =>
              f.decryptedMimeType.startsWith('image/') ||
              f.decryptedMimeType.startsWith('video/')
          )}
          currentIndex={selectedMediaIndex}
          vaultKey={vaultKey}
          onIndexChange={(idx) => setSelectedMediaIndex(idx)}
          onClose={() => setSelectedMediaIndex(null)}
        />
      )}
    </div>
  );
};
