import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { initDatabase } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Initialize SQLite database
initDatabase();

const app = express();
const port = process.env.PORT || 3000;

// Install the JSON body parser middleware
app.use(express.json());

// --- API Routes ---

// Express 5 cleanly catches errors thrown inside async functions natively!
app.get('/api/data', async (req, res) => {
  // Simulating an asynchronous database call
  const data = { status: "success", version: "Express 5.x" };
  res.json(data);
});

// --- Static File Server ---
// Serve static files from the public directory (compiled frontend + static assets)
app.use(express.static(path.join(ROOT_DIR, 'public')));

// --- Start the Server ---
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
