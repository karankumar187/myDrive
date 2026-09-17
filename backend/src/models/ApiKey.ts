import mongoose, { Schema } from 'mongoose';
import { IApiKeyDocument } from '../types/index.js';

const ApiKeySchema = new Schema<IApiKeyDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    apiKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    apiSecretHash: {
      type: String,
      required: true,
    },
    apiSecretPrefix: {
      type: String,
      required: true,
    },
    permissions: {
      type: [String],
      default: ['upload', 'read', 'delete', 'transform'],
    },
    allowedOrigins: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    lastUsedAt: {
      type: Date,
      default: null,
    },
    requestCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

ApiKeySchema.index({ userId: 1, isActive: 1 });

export const ApiKey = mongoose.model<IApiKeyDocument>('ApiKey', ApiKeySchema);
