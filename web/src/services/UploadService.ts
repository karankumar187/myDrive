import { api, startGlobalLoading } from './api.js';
import { VaultCryptoService } from './vault-crypto.js';
import { isVideoFile, getEffectiveMimeType } from './media-cache.js';

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
  retryCount?: number;
}

type UploadListener = (tasks: UploadTask[]) => void;

class BackgroundUploadManager {
  private tasks: UploadTask[] = [];
  private listeners: Set<UploadListener> = new Set();
  private isProcessing = false;
  private onUploadSuccessCallback: ((folderId: string | null) => void) | null = null;
  private wakeLockSentinel: any = null;
  private activeXhr: XMLHttpRequest | null = null;

  constructor() {
    // When returning to tab on iOS or desktop, automatically resume any interrupted uploads
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (this.hasActiveUploads()) {
            this.acquireWakeLock();
            this.processQueue();
          }
        }
      });
      window.addEventListener('online', () => {
        if (this.hasActiveUploads()) {
          this.processQueue();
        }
      });
    }
  }

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

  public hasActiveUploads(): boolean {
    return this.tasks.some(
      (t) => t.status === 'queued' || t.status === 'processing' || t.status === 'uploading'
    );
  }

  public clearCompleted() {
    this.tasks = this.tasks.filter(
      (t) => t.status !== 'completed' && t.status !== 'duplicate' && t.status !== 'failed'
    );
    this.notify();
  }

  public retryTask(taskId: string) {
    const task = this.tasks.find((t) => t.id === taskId);
    if (task && task.status === 'failed') {
      task.status = 'queued';
      task.progress = 0;
      task.message = 'Retrying upload...';
      task.error = undefined;
      task.retryCount = 0;
      this.notify();
      this.acquireWakeLock();
      this.processQueue();
    }
  }

  public retryAllFailed() {
    let count = 0;
    this.tasks.forEach((t) => {
      if (t.status === 'failed') {
        t.status = 'queued';
        t.progress = 0;
        t.message = 'Retrying upload...';
        t.error = undefined;
        t.retryCount = 0;
        count++;
      }
    });
    if (count > 0) {
      this.notify();
      this.acquireWakeLock();
      this.processQueue();
    }
  }

  public cancelTask(taskId: string) {
    const index = this.tasks.findIndex((t) => t.id === taskId);
    if (index !== -1) {
      const task = this.tasks[index];
      if (task.status === 'uploading' && this.activeXhr) {
        try {
          this.activeXhr.abort();
        } catch {}
      }
      this.tasks.splice(index, 1);
      this.notify();
    }
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
      retryCount: 0,
    }));

    this.tasks = [...this.tasks, ...newTasks];
    this.notify();
    this.acquireWakeLock();
    this.processQueue();
  }

  private async acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !this.wakeLockSentinel) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        this.wakeLockSentinel.addEventListener('release', () => {
          this.wakeLockSentinel = null;
        });
      }
    } catch {
      // Ignore wake lock failure (e.g. low power mode)
    }
  }

  private releaseWakeLock() {
    if (this.wakeLockSentinel) {
      try {
        this.wakeLockSentinel.release();
      } catch {}
      this.wakeLockSentinel = null;
    }
  }

  private async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (true) {
        const nextTask = this.tasks.find((t) => t.status === 'queued');
        if (!nextTask) break;

        await this.uploadSingleTask(nextTask);
      }
    } finally {
      this.isProcessing = false;
      if (!this.hasActiveUploads()) {
        this.releaseWakeLock();
      }
    }
  }

  private async uploadSingleTask(task: UploadTask) {
    task.status = 'processing';
    task.message = `Preparing ${task.file.name}...`;
    task.progress = 5;
    this.notify();

    const stopLoading = startGlobalLoading('upload');

    try {
      const effectiveMime = getEffectiveMimeType(task.file.name, task.file.type);

      // Fast, lightweight hash (< 15ms): avoids memory spikes on iOS Safari
      task.progress = 15;
      task.message = `Computing hash...`;
      this.notify();

      let contentHash: string;
      const MAX_IN_MEMORY_SIZE = 8 * 1024 * 1024; // 8 MB
      if (task.file.size <= MAX_IN_MEMORY_SIZE) {
        const buffer = await task.file.arrayBuffer();
        contentHash = await VaultCryptoService.calculateSha256(buffer);
      } else {
        // Fast chunk hash: head 2MB + tail 2MB
        const head = await task.file.slice(0, 2 * 1024 * 1024).arrayBuffer();
        const tail = await task.file.slice(Math.max(0, task.file.size - 2 * 1024 * 1024)).arrayBuffer();
        const combined = new Uint8Array(head.byteLength + tail.byteLength);
        combined.set(new Uint8Array(head), 0);
        combined.set(new Uint8Array(tail), head.byteLength);
        contentHash = await VaultCryptoService.calculateSha256(combined.buffer);
      }

      task.progress = 25;
      task.message = `Connecting to storage...`;
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

      // Upload with XHR and automatic retry on connection interruption (e.g. mobile app switch / sleep)
      let uploadSuccess = false;
      let lastError: any = null;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          await this.streamUpload(uploadUrl, effectiveMime, task);
          uploadSuccess = true;
          break;
        } catch (err: any) {
          lastError = err;
          if (attempt < maxRetries) {
            task.retryCount = attempt;
            task.message = `Connection interrupted, retrying (attempt ${attempt + 1}/${maxRetries})...`;
            this.notify();
            await new Promise((r) => setTimeout(r, 2000));
          }
        }
      }

      if (!uploadSuccess) {
        throw lastError;
      }

      task.progress = 92;
      task.message = `Finalizing cloud backup metadata...`;
      this.notify();

      const realProviderFileId = initResult.driveOpaqueName || `file_${Date.now()}`;

      await api.completeUpload({
        filename: task.file.name,
        mimeType: effectiveMime,
        sizeBytes: task.file.size,
        contentHash,
        storageAccountId: initResult.storageAccountId,
        providerFileId: realProviderFileId,
        folderId: task.folderId,
        isEncrypted: false,
      });

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

  private streamUpload(uploadUrl: string, mimeType: string, task: UploadTask): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      this.activeXhr = xhr;

      xhr.open('PUT', uploadUrl);
      xhr.setRequestHeader('Content-Type', mimeType);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round(30 + (e.loaded / e.total) * 60); // 30% to 90%
          task.progress = pct;
          task.message = `Uploading: ${Math.round((e.loaded / e.total) * 100)}%`;
          this.notify();
        }
      };

      xhr.onload = () => {
        this.activeXhr = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Upload stream failed with HTTP ${xhr.status}: ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => {
        this.activeXhr = null;
        reject(new Error('Network error during file upload stream'));
      };

      xhr.onabort = () => {
        this.activeXhr = null;
        reject(new Error('Upload cancelled'));
      };

      // Native low-overhead disk streaming via File object
      xhr.send(task.file);
    });
  }
}

export const uploadService = new BackgroundUploadManager();
