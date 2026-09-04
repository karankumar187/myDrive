import mongoose, { Schema } from 'mongoose';
import { IDeviceDocument } from '../types/index.js';

const DevicePolicySchema = new Schema(
  {
    uploadFolders: {
      type: [String],
      default: ['Camera', 'Screenshots', 'WhatsApp'],
    },
    wifiOnly: {
      type: Boolean,
      default: true,
    },
    chargingOnly: {
      type: Boolean,
      default: false,
    },
    autoDeleteLocalAfterBackup: {
      type: Boolean,
      default: false, // Default false per user specification
    },
    downloadMode: {
      type: String,
      enum: ['cloud_only', 'auto_download'],
      default: 'cloud_only',
    },
    autoDownloadFolders: {
      type: [String],
      default: [],
    },
    deletionMode: {
      type: String,
      enum: ['keep_in_cloud', 'mirror_deletion'],
      default: 'keep_in_cloud', // Default keep in cloud
    },
    syncPhotos: {
      type: Boolean,
      default: true,
    },
    syncVideos: {
      type: Boolean,
      default: true,
    },
    syncDocuments: {
      type: Boolean,
      default: true,
    },
    syncOthers: {
      type: Boolean,
      default: false,
    },
    pairedDeviceRules: {
      type: [
        {
          sourceDeviceId: { type: String, required: true },
          sourceDeviceName: { type: String, default: '' },
          syncPhotos: { type: Boolean, default: true },
          syncVideos: { type: Boolean, default: true },
          syncDocuments: { type: Boolean, default: true },
          autoDownloadToGallery: { type: Boolean, default: true },
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

const DeviceSchema = new Schema<IDeviceDocument>(
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
    apiKeyHash: {
      type: String,
      required: true,
      index: true,
    },
    apiKeyPrefix: {
      type: String,
      required: true,
    },
    deviceName: {
      type: String,
      required: true,
      trim: true,
    },
    deviceType: {
      type: String,
      enum: ['android', 'iphone', 'web', 'desktop'],
      required: true,
    },
    osVersion: String,
    appVersion: String,
    status: {
      type: String,
      enum: ['online', 'offline'],
      default: 'offline',
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastCheckpoint: {
      type: Number,
      default: 0,
    },
    policy: {
      type: DevicePolicySchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  }
);

DeviceSchema.index({ userId: 1, deviceId: 1 }, { unique: true });

export const Device = mongoose.model<IDeviceDocument>('Device', DeviceSchema);
