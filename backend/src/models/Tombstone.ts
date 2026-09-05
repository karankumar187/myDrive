import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITombstoneDocument extends Document {
  userId: Types.ObjectId;
  contentHash?: string;
  filename: string;
  sizeBytes?: number;
  deletedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const TombstoneSchema = new Schema<ITombstoneDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    contentHash: {
      type: String,
      index: true,
    },
    filename: {
      type: String,
      required: true,
    },
    sizeBytes: {
      type: Number,
    },
    deletedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

TombstoneSchema.index({ userId: 1, contentHash: 1 });
TombstoneSchema.index({ userId: 1, filename: 1, sizeBytes: 1 });

export const Tombstone = mongoose.model<ITombstoneDocument>('Tombstone', TombstoneSchema);
