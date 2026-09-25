import mongoose from 'mongoose';

const attemptDetailSchema = new mongoose.Schema({
  id: { type: String, required: true },
  subject: { type: String, default: '' },
  topic: { type: String, default: '' },
  difficulty: { type: String, default: 'medium' },
  question: {
    hi: { type: String, default: '' },
    en: { type: String, default: '' },
  },
  options: {
    hi: [{ type: String }],
    en: [{ type: String }],
  },
  answerIndex: { type: Number, default: -1 },
  chosenIndex: { type: Number, default: null },
  status: { type: String, enum: ['correct', 'wrong', 'skipped'], default: 'skipped' },
  explanation: {
    hi: { type: String, default: '' },
    en: { type: String, default: '' },
  },
}, { _id: false });

const breakdownSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  total: { type: Number, default: 0 },
  correct: { type: Number, default: 0 },
  accuracy: { type: Number, default: 0 },
}, { _id: false });

const weakTopicSchema = new mongoose.Schema({
  subject: { type: String, default: '' },
  topic: { type: String, default: '' },
  total: { type: Number, default: 0 },
  correct: { type: Number, default: 0 },
  accuracy: { type: Number, default: 0 },
}, { _id: false });

const attemptSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  student: { type: String, default: 'Anonymous', index: true },
  at: { type: Number, required: true, index: true },
  finishedAt: { type: Number, default: Date.now },
  mode: { type: String, default: 'test' },
  label: { type: String, default: 'Test' },
  subjects: [{ type: String }],
  total: { type: Number, required: true },
  correct: { type: Number, default: 0 },
  wrong: { type: Number, default: 0 },
  skipped: { type: Number, default: 0 },
  score: { type: Number, default: 0 },
  percent: { type: Number, default: 0 },
  timeTaken: { type: Number, default: 0 },
  minutes: { type: Number, default: 0 },
  negative: { type: Boolean, default: false },
  breakdown: [breakdownSchema],
  weakTopics: [weakTopicSchema],
  details: [attemptDetailSchema],
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

export const Attempt = mongoose.models.Attempt || mongoose.model('Attempt', attemptSchema);
