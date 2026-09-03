import mongoose, { Schema } from 'mongoose';
import { IDeviceFileStateDocument } from '../types/index.js';

const DeviceFileStateSchema = new Schema<IDeviceFileStateDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    deviceId: {
      type: String,
      required: true,
      index: true,
    },
    fileId: {
      type: Schema.Types.ObjectId,
      ref: 'File',
      required: true,
      index: true,
    },
    deviceAssetId: {
      type: String, // Android MediaStore ID or iOS PHAsset localIdentifier
      default: null,
      index: true,
    },
    isLocallyPresent: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastSeenLocalAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

DeviceFileStateSchema.index({ userId: 1, deviceId: 1, fileId: 1 }, { unique: true });

export const DeviceFileState = mongoose.model<IDeviceFileStateDocument>('DeviceFileState', DeviceFileStateSchema);
