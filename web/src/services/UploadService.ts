import { api, startGlobalLoading } from './api.js';
import { VaultCryptoService } from './vault-crypto.js';
import { mediaCache, generateThumbnailFromVideoFile, isVideoFile, getEffectiveMimeType } from './media-cache.js';

export interface UploadTask {
  id: string;
  file: File;
  folderId: string | null;
  targetFolderName?: string;
  progress: number; // 0 to 100
  status: 'queued' | 'processing' | 'uploading' | 'completed' | 'failed' | 'duplicate';
  message?: string;
  error?: string;
  storageAccountEmail?: string;
  createdAt: number;
}

type UploadListener = (tasks: UploadTask[]) => void;

class BackgroundUploadManager {
  private tasks: UploadTask[] = [];
  private listeners: Set<UploadListener> = new Set();
  private isProcessing = false;
  private onUploadSuccessCallback: ((folderId: string | null) => void) | null = null;

  public setOnUploadSuccess(cb: (folderId: string | null) => void) {
    this.onUploadSuccessCallback = cb;
  }

  public subscribe(listener: UploadListener): () => void {
    this.listeners.add(listener);
    listener([...this.tasks]);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    const copy = [...this.tasks];
    this.listeners.forEach((l) => {
      try {
        l(copy);
      } catch (err) {
        console.error('UploadListener error:', err);
      }
    });
  }

  public getTasks(): UploadTask[] {
    return [...this.tasks];
  }

  public clearCompleted() {
    this.tasks = this.tasks.filter((t) => t.status !== 'completed' && t.status !== 'duplicate' && t.status !== 'failed');
    this.notify();
  }

  public enqueue(files: FileList | File[], folderId: string | null, targetFolderName?: string) {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);

    const newTasks: UploadTask[] = fileArray.map((f) => ({
      id: `up_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      file: f,
      folderId,
      targetFolderName,
      progress: 0,
      status: 'queued',
      message: 'Queued for upload',
      createdAt: Date.now(),
    }));

    this.tasks = [...this.tasks, ...newTasks];
    this.notify();
    this.processQueue();
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    while (true) {
      const nextTask = this.tasks.find((t) => t.status === 'queued');
      if (!nextTask) break;

      await this.uploadSingleTask(nextTask);
    }

    this.isProcessing = false;
  }

  private async uploadSingleTask(task: UploadTask) {
    task.status = 'processing';
    task.message = `Processing ${task.file.name}...`;
    task.progress = 5;
    this.notify();

    const stopLoading = startGlobalLoading('upload');

    try {
      const effectiveMime = getEffectiveMimeType(task.file.name, task.file.type);
      let videoThumb: string | null = null;
      if (isVideoFile(task.file.name) || effectiveMime.startsWith('video/')) {
        task.message = `Extracting preview frame...`;
        this.notify();
        try {
          videoThumb = await generateThumbnailFromVideoFile(task.file);
        } catch {
          // ignore thumbnail failure
        }
      }

      task.progress = 15;
      task.message = `Computing hash...`;
      this.notify();

      const buffer = await task.file.arrayBuffer();
      const contentHash = await VaultCryptoService.calculateSha256(buffer);

      task.progress = 25;
      task.message = `Allocating storage pool...`;
      this.notify();

      const initResult = await api.initiateUpload({
        filename: task.file.name,
        mimeType: effectiveMime,
        sizeBytes: task.file.size,
        contentHash,
        folderId: task.folderId,
        isEncrypted: false,
      });

      if (initResult.isDuplicate) {
        task.status = 'duplicate';
        task.progress = 100;
        task.message = `✨ Exact duplicate! Linked instantly without uploading bytes.`;
        this.notify();
        this.onUploadSuccessCallback?.(task.folderId);
        stopLoading();
        return;
      }

      task.status = 'uploading';
      task.storageAccountEmail = initResult.targetAccountEmail;
      task.message = `Uploading to ${initResult.targetAccountEmail || 'cloud'}...`;
      task.progress = 30;
      this.notify();

      const uploadUrl = initResult.uploadSessionUrl.startsWith('http')
        ? initResult.uploadSessionUrl
        : `${import.meta.env.VITE_API_URL || ''}${initResult.uploadSessionUrl}`;

      // Upload with XHR for accurate byte progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', effectiveMime);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const pct = Math.round(30 + (e.loaded / e.total) * 60); // 30% to 90%
            task.progress = pct;
            task.message = `Uploading: ${Math.round((e.loaded / e.total) * 100)}%`;
            this.notify();
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload stream failed with HTTP ${xhr.status}: ${xhr.statusText}`));
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error during file upload stream'));
        };

        xhr.send(buffer);
      });

      task.progress = 92;
      task.message = `Finalizing cloud backup metadata...`;
      this.notify();

      const realProviderFileId = initResult.driveOpaqueName || `file_${Date.now()}`;

      const completeRes = await api.completeUpload({
        filename: task.file.name,
        mimeType: effectiveMime,
        sizeBytes: task.file.size,
        contentHash,
        storageAccountId: initResult.storageAccountId,
        providerFileId: realProviderFileId,
        folderId: task.folderId,
        isEncrypted: false,
        metadata: videoThumb ? { thumbnail: videoThumb } : undefined,
      });

      if (videoThumb && completeRes?.file?._id) {
        mediaCache.saveThumbnail(completeRes.file._id, videoThumb);
      }

      task.status = 'completed';
      task.progress = 100;
      task.message = `✓ Safely backed up to cloud`;
      this.notify();

      this.onUploadSuccessCallback?.(task.folderId);
    } catch (err: any) {
      console.error(`Failed to upload ${task.file.name}:`, err);
      task.status = 'failed';
      task.error = err.message || 'Upload failed';
      task.message = `Failed: ${task.error}`;
      this.notify();
    } finally {
      stopLoading();
    }
  }
}

export const uploadService = new BackgroundUploadManager();
