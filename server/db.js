import mongoose from 'mongoose';

let isConnected = false;

export async function connectDB(uri) {
  const mongoUri = uri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/supertet-prep';
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 2500, // fail fast if mongo is not running locally
    });
    isConnected = true;
    console.log('[db] Connected to MongoDB:', mongoUri.replace(/\/\/[^@]+@/, '//***@'));
    return true;
  } catch (err) {
    isConnected = false;
    console.warn('[db] MongoDB not available at boot (' + err.message + ').');
    console.warn('[db] Static pages and local storage will still work.');
    console.warn('[db] Start MongoDB (or set MONGODB_URI in .env) to enable cloud sync.');
    return false;
  }
}

export function isDbConnected() {
  return isConnected && mongoose.connection.readyState === 1;
}

export { mongoose };
