import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, isDbConnected } from './db.js';
import attemptsRouter from './routes/attempts.js';
import questionsRouter from './routes/questions.js';
import authRouter from './routes/auth.js';
import analyticsRouter from './routes/analytics.js';
import subjectsRouter from './routes/subjects.js';
import { ensureDefaultAdmin } from './bootstrap-admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS headers for when the frontend is hosted elsewhere (e.g., GitHub Pages)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Health / Status endpoint
app.get('/api/status', (_req, res) => {
  res.json({
    ok: true,
    mongoConnected: isDbConnected(),
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api/attempts', attemptsRouter);
app.use('/api/questions', questionsRouter);
app.use('/api/auth', authRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/subjects', subjectsRouter);

// Static site hosting (the whole PWA is served directly from the root)
app.use(express.static(ROOT, {
  extensions: ['html'],
  index: 'index.html',
}));

// Fallback to 404 page for missing static routes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.status(404).sendFile(path.join(ROOT, '404.html'));
});

// Boot
export async function start(port = PORT, mongoUri) {
  await connectDB(mongoUri);
  // First boot on a fresh database: make sure the default admin can sign in.
  if (isDbConnected()) {
    try {
      await ensureDefaultAdmin();
    } catch (err) {
      console.warn('[admin] Could not bootstrap the default admin:', err.message);
    }
  }
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`[server] SuperTET Prep running at http://localhost:${port}/`);
      console.log(`[server] MongoDB status: ${isDbConnected() ? 'CONNECTED' : 'DISCONNECTED (local storage fallback active)'}`);
      resolve(server);
    });
  });
}

// Auto-run if executed directly
if (process.argv[1] === __filename) {
  start();
}

export default app;
