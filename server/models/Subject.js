import mongoose from 'mongoose';

/* ===========================================================
   Subject.js - one syllabus subject (e.g. "Mathematics") plus its
   embedded list of topics.

   Topics live inside the subject document because the admin always
   edits one subject at a time, and students always read the whole
   syllabus at once - there is never a need to query a topic alone.
   Names are stored bilingually ({ name, nameHi }) like every other
   user facing string in the app.
   =========================================================== */

const topicSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String, required: true, trim: true },
  nameHi: { type: String, default: '', trim: true },
}, { _id: false });

const subjectSchema = new mongoose.Schema({
  id: { type: String, required: true, unique: true, index: true },
  // Unique so seeding can be idempotent and "add subject" cannot double up.
  name: { type: String, required: true, unique: true, index: true, trim: true },
  nameHi: { type: String, default: '', trim: true },
  topics: { type: [topicSchema], default: [] },
  order: { type: Number, default: 0, index: true },
  createdBy: { type: String, default: '', index: true },
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

/**
 * URL friendly slug built from ASCII only, so a subject written purely in
 * Hindi still gets a usable id ("item", "item-2", ... handled by the route).
 */
export function slugify(text) {
  return (String(text == null ? '' : text)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'item');
}

export const Subject = mongoose.models.Subject || mongoose.model('Subject', subjectSchema);