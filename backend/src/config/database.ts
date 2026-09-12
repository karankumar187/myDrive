import mongoose from 'mongoose';

export async function connectDatabase(): Promise<void> {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/unified_drive';

  const connectWithRetry = async (retries = 5, delay = 3000): Promise<void> => {
    for (let i = 1; i <= retries; i++) {
      try {
        await mongoose.connect(mongoUri, {
          maxPoolSize: 50,
          serverSelectionTimeoutMS: 10000,
          socketTimeoutMS: 45000,
          heartbeatFrequencyMS: 10000,
        });
        console.log('✅ Connected to MongoDB');
        return;
      } catch (error) {
        console.error(`❌ MongoDB connection attempt ${i}/${retries} failed:`, error);
        if (i < retries) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        } else {
          throw error;
        }
      }
    }
  };

  try {
    await connectWithRetry();
  } catch (error) {
    console.error('❌ Critical: Failed to connect to MongoDB after multiple attempts.');
    if (process.env.NODE_ENV === 'production') {
      process.exit(1); // Let PM2 restart the process cleanly
    }
  }

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB connection event error:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️ MongoDB disconnected. Attempting automatic reconnection...');
    mongoose.connect(mongoUri).catch((err) => {
      console.error('Failed to reconnect to MongoDB:', err);
    });
  });
}
