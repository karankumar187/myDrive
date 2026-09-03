import mongoose, { Schema } from 'mongoose';
import { ISyncEventDocument } from '../types/index.js';

const SyncEventSchema = new Schema<ISyncEventDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    checkpoint: {
      type: Number,
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: [
        'FILE_UPLOADED',
        'FILE_UPDATED',
        'FILE_RENAMED',
        'FILE_MOVED',
        'FILE_TRASHED',
        'FILE_RESTORED',
        'FILE_DELETED_PERMANENT',
        'FOLDER_CREATED',
        'FOLDER_RENAMED',
        'FOLDER_DELETED',
        'POLICY_UPDATED',
      ],
      required: true,
    },
    targetId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    targetType: {
      type: String,
      enum: ['file', 'folder', 'device'],
      required: true,
    },
    originDeviceId: {
      type: String,
      default: null,
    },
    payload: {
      type: Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  }
);

SyncEventSchema.index({ userId: 1, checkpoint: 1 });

export const SyncEvent = mongoose.model<ISyncEventDocument>('SyncEvent', SyncEventSchema);
