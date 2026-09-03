import mongoose, { Schema } from 'mongoose';
import { IUserDocument } from '../types/index.js';

const UserSchema = new Schema<IUserDocument>(
  {
    googleProfileId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    role: {
      type: String,
      enum: ['owner', 'member'],
      default: 'owner',
    },
    masterKeySalt: {
      type: String,
      default: null,
    },
    encryptedVaultKey: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const User = mongoose.model<IUserDocument>('User', UserSchema);
