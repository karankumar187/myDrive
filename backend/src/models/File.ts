import mongoose, { Schema } from 'mongoose';
import { IFileDocument } from '../types/index.js';

const FileVersionSchema = new Schema(
  {
    versionNumber: {
      type: Number,
      required: true,
    },
    storageAccountId: {
      type: Schema.Types.ObjectId,
      ref: 'StorageAccount',
      required: true,
    },
    providerFileId: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
    },
    contentHash: {
      type: String,
      required: true,
    },
    isEncrypted: {
      type: Boolean,
      default: false,
    },
    iv: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

const FileMetadataSchema = new Schema(
  {
    width: Number,
    height: Number,
    duration: Number,
    takenAt: Date,
    cameraMake: String,
    cameraModel: String,
    orientation: Number,
    latitude: Number,
    longitude: Number,
    thumbnail: String,
    exif: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
  },
  { _id: false }
);

const FileSchema = new Schema<IFileDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    folderId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
      index: true,
    },
    filename: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    mimeType: {
      type: String,
      required: true,
      index: true,
    },
    sizeBytes: {
      type: Number,
      required: true,
    },
    contentHash: {
      type: String,
      required: true,
      index: true, // Crucial for instant deduplication lookup
    },
    currentVersion: {
      type: Number,
      default: 1,
    },
    versions: [FileVersionSchema],
    metadata: {
      type: FileMetadataSchema,
      default: () => ({}),
    },
    isFavorite: {
      type: Boolean,
      default: false,
      index: true,
    },
    isTrash: {
      type: Boolean,
      default: false,
      index: true,
    },
    trashedAt: {
      type: Date,
      default: null,
    },
    trashedByDeviceId: {
      type: String,
      default: null,
    },
    sourceDeviceIds: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes for high-speed queries
FileSchema.index({ userId: 1, contentHash: 1 }); // Deduplication check
FileSchema.index({ userId: 1, isTrash: 1, folderId: 1 }); // Folder explorer
FileSchema.index({ userId: 1, isTrash: 1, 'metadata.takenAt': -1, createdAt: -1, _id: -1 }); // Gallery timeline pagination
FileSchema.index({ userId: 1, isTrash: 1, mimeType: 1, 'metadata.takenAt': -1, createdAt: -1, _id: -1 }); // Gallery media pagination
FileSchema.index({ userId: 1, isTrash: 1, createdAt: -1, _id: -1 }); // Recent files / fallback pagination
FileSchema.index({ userId: 1, isTrash: 1, isFavorite: 1 }); // Favorites filter

export const File = mongoose.model<IFileDocument>('File', FileSchema);
