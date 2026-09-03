import mongoose, { Schema } from 'mongoose';
import { IStorageAccountDocument } from '../types/index.js';

const StorageAccountSchema = new Schema<IStorageAccountDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    accountEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    accountName: {
      type: String,
      required: true,
      trim: true,
    },
    googleDriveAccountId: {
      type: String,
      required: true,
    },
    encryptedRefreshToken: {
      type: String,
      required: true,
    },
    refreshTokenIv: {
      type: String,
      required: true,
    },
    refreshTokenAuthTag: {
      type: String,
      required: true,
    },
    totalStorageBytes: {
      type: Number,
      default: 15 * 1024 * 1024 * 1024, // Default 15 GB
    },
    usedStorageBytes: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ['healthy', 'reauth_required', 'quota_full', 'disabled'],
      default: 'healthy',
      index: true,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    lastQuotaSyncAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Ensure a user cannot link the same Google Drive account twice
StorageAccountSchema.index({ userId: 1, googleDriveAccountId: 1 }, { unique: true });

export const StorageAccount = mongoose.model<IStorageAccountDocument>('StorageAccount', StorageAccountSchema);
