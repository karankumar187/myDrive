import mongoose, { Schema } from 'mongoose';
import { IFolderDocument } from '../types/index.js';

const FolderSchema = new Schema<IFolderDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    parentFolderId: {
      type: Schema.Types.ObjectId,
      ref: 'Folder',
      default: null,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    path: {
      type: String,
      required: true,
      index: true, // e.g., "/" or "/Photos/Vacation/"
    },
    color: {
      type: String,
      default: '#3b82f6', // Tailwind blue-500
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
  },
  {
    timestamps: true,
  }
);

FolderSchema.index({ userId: 1, parentFolderId: 1, name: 1 }, { unique: true });
FolderSchema.index({ userId: 1, isTrash: 1, parentFolderId: 1 });

export const Folder = mongoose.model<IFolderDocument>('Folder', FolderSchema);
