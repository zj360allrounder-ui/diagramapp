import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const exportDir = path.join(__dirname, 'exportedfiles');
const dist = path.join(__dirname, 'dist');
const indexHtml = path.join(dist, 'index.html');

app.use(express.json({ limit: '15mb' }));

/** @returns {string|null} stem without extension */
function safeStem(name) {
  const base = String(name ?? '')
    .trim()
    .replace(/[/\\]/g, '')
    .replace(/\.(txt|json)$/i, '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(base)) return null;
  return base;
}

async function ensureExportDir() {
  await fs.mkdir(exportDir, { recursive: true });
}

app.get('/api/diagrams', async (_req, res) => {
  try {
    await ensureExportDir();
    const files = (await fs.readdir(exportDir)).filter((f) => f.endsWith('.txt'));
    const rows = await Promise.all(
      files.map(async (filename) => {
        const stem = filename.slice(0, -4);
        const st = await fs.stat(path.join(exportDir, filename));
        return { stem, filename, mtime: st.mtimeMs };
      })
    );
    rows.sort((a, b) => b.mtime - a.mtime);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/diagrams/:stem', async (req, res) => {
  const stem = safeStem(req.params.stem);
  if (!stem) return res.status(400).json({ error: 'Invalid name' });
  const filePath = path.join(exportDir, `${stem}.txt`);
  try {
    const text = await fs.readFile(filePath, 'utf8');
    res.type('text/plain; charset=utf-8').send(text);
  } catch (e) {
    if (e?.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/diagrams', async (req, res) => {
  const stem = safeStem(req.body?.name);
  if (!stem) return res.status(400).json({ error: 'Invalid name (use letters, numbers, dot, dash, underscore)' });
  const diagram = req.body?.diagram;
  if (!diagram || typeof diagram !== 'object') {
    return res.status(400).json({ error: 'Missing diagram object' });
  }
  const replace = req.body?.replace === true;
  try {
    await ensureExportDir();
    const text = `${JSON.stringify(diagram, null, 2)}\n`;
    const filePath = path.join(exportDir, `${stem}.txt`);
    let existed = false;
    try {
      await fs.access(filePath);
      existed = true;
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
    }
    if (existed && !replace) {
      return res.status(409).json({
        error: 'A file with this name already exists',
        exists: true,
        stem,
      });
    }
    let backupPath = null;
    if (existed && replace) {
      const backupDir = path.join(exportDir, '.backups');
      await fs.mkdir(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
      const backupName = `${stem}.${stamp}.txt`;
      const backupFull = path.join(backupDir, backupName);
      await fs.copyFile(filePath, backupFull);
      backupPath = `exportedfiles/.backups/${backupName}`;
    }
    await fs.writeFile(filePath, text, 'utf8');
    res.json({
      ok: true,
      stem,
      path: `exportedfiles/${stem}.txt`,
      ...(backupPath ? { backupPath } : {}),
    });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

if (existsSync(indexHtml)) {
  app.use(express.static(dist));
}

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (existsSync(indexHtml)) {
    return res.sendFile(indexHtml);
  }
  return res
    .status(503)
    .type('text/plain')
    .send(
      'API is running without a production build.\nOpen the app with Vite: npm run dev (with proxy) or npm run dev:all.\nDiagram saves still work; files go to exportedfiles/*.txt'
    );
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Server http://localhost:${port}`);
  if (existsSync(indexHtml)) {
    console.log('Serving Cloud Diagram Studio (dist/)');
  } else {
    console.log('No dist/ yet — run Vite on :5173 for the UI, or npm run build && npm start');
  }
  console.log(`Diagram storage: ${exportDir} (*.txt JSON)`);
});
