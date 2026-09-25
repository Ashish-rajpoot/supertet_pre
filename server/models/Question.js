import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  subject: { type: String, required: true, index: true },
  topic: { type: String, default: 'General', index: true },
  difficulty: { type: String, default: 'medium', index: true },
  question: {
    hi: { type: String, default: '' },
    en: { type: String, default: '' },
  },
  options: {
    hi: [{ type: String }],
    en: [{ type: String }],
  },
  answerIndex: { type: Number, required: true },
  answerLetter: { type: String, default: 'A' },
  explanation: {
    hi: { type: String, default: '' },
    en: { type: String, default: '' },
  },
  tags: [{ type: String }],
  source: { type: String, default: 'user' },   // 'admin' (official bank) or 'user'
  createdBy: { type: String, default: '', index: true }, // User.id of whoever added it
}, {
  timestamps: true,
  toJSON: {
    transform(_doc, ret) {
      delete ret._id;
      delete ret.__v;
      return ret;
    },
  },
});

export const Question = mongoose.models.Question || mongoose.model('Question', questionSchema);
