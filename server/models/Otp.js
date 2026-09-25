import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
  target: { type: String, required: true, index: true }, // email or phone
  code: { type: String, required: true },
  type: { type: String, enum: ['register', 'login', 'reset'], default: 'register' },
  expiresAt: { type: Date, required: true, index: { expires: 0 } }, // MongoDB TTL index auto-deletes expired docs
}, {
  timestamps: true,
});

export const Otp = mongoose.models.Otp || mongoose.model('Otp', otpSchema);
