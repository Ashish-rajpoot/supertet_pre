import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  name: { type: String, default: 'Student' },
  // Email, phone and login id can only be set at signup - the editor profile never changes them.
  email: { type: String, sparse: true, index: true, lowercase: true, trim: true },
  phone: { type: String, sparse: true, index: true, trim: true },
  userId: { type: String, sparse: true, index: true, lowercase: true, trim: true },
  passwordHash: { type: String, default: '' },
  salt: { type: String, default: '' },
  googleId: { type: String, sparse: true, index: true },
  avatar: { type: String, default: '' },
  verified: { type: Boolean, default: false },
  // 'admin' can add/delete any question and grant the permission below to students.
  role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  // Granted by an admin: the student may then add questions to the shared bank.
  canAddQuestions: { type: Boolean, default: false },
  // Optional profile details a student can edit themselves.
  classLevel: { type: String, default: '' },  // e.g. "Class 6-8", "Paper 1"
  city: { type: String, default: '' },
  school: { type: String, default: '' },
  about: { type: String, default: '' },
}, {
  timestamps: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret.passwordHash;
      delete ret.salt;
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

export const User = mongoose.models.User || mongoose.model('User', userSchema);
