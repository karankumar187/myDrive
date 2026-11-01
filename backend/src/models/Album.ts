import mongoose, { Schema } from 'mongoose';
import { IAlbumDocument } from '../types/index.js';

const AlbumSchema = new Schema<IAlbumDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
      trim: true,
    },
    destination: {
      name: { type: String, default: '', trim: true },
      latitude: { type: Number, default: null },
      longitude: { type: Number, default: null },
    },
    coverFileId: {
      type: Schema.Types.ObjectId,
      ref: 'File',
      default: null,
    },
    fileIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'File',
        index: true,
      },
    ],
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    isPinned: {
      type: Boolean,
      default: false,
      index: true,
    },
    isFavorite: {
      type: Boolean,
      default: false,
      index: true,
    },
    themeGradient: {
      type: String,
      default: 'from-purple-900/60 via-indigo-950/40 to-black',
    },
  },
  {
    timestamps: true,
  }
);

// High performance compound indexes
AlbumSchema.index({ userId: 1, isPinned: -1, updatedAt: -1 });
AlbumSchema.index({ userId: 1, isFavorite: -1 });

export const Album = mongoose.model<IAlbumDocument>('Album', AlbumSchema);
