import mongoose from 'mongoose';

export async function connectDatabase(): Promise<void> {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/unified_drive';

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    // In production we would exit, in dev we allow graceful startup if container isn't ready yet
  }

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection event error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected');
  });
}
