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

/** Single path segment for exportedfiles/<workspace>/… */
function safeWorkspace(name) {
  const raw = String(name ?? '').trim().replace(/[/\\]/g, '');
  const ws = raw === '' ? 'default' : raw;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(ws)) return null;
  return ws;
}

async function ensureExportDir() {
  await fs.mkdir(exportDir, { recursive: true });
}

/**
 * Collect diagram stems from a directory (only *.txt files, not dotfiles).
 * @param {string} dir
 * @returns {Promise<Map<string, { stem: string, filename: string, mtime: number }>>}
 */
async function txtStemsInDir(dir) {
  const byStem = new Map();
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (e) {
    if (e?.code === 'ENOENT') return byStem;
    throw e;
  }
  for (const filename of names) {
    if (!filename.endsWith('.txt') || filename.startsWith('.')) continue;
    const full = path.join(dir, filename);
    const st = await fs.stat(full);
    if (!st.isFile()) continue;
    const stem = filename.slice(0, -4);
    const row = { stem, filename, mtime: st.mtimeMs };
    const prev = byStem.get(stem);
    if (!prev || row.mtime > prev.mtime) byStem.set(stem, row);
  }
  return byStem;
}

/** List diagrams for a workspace; `default` also merges legacy flat exportedfiles/*.txt */
async function listWorkspaceDiagrams(workspace) {
  const byStem = await txtStemsInDir(path.join(exportDir, workspace));
  if (workspace === 'default') {
    const legacy = await txtStemsInDir(exportDir);
    for (const [stem, row] of legacy) {
      const prev = byStem.get(stem);
      if (!prev || row.mtime > prev.mtime) byStem.set(stem, row);
    }
  }
  return [...byStem.values()].sort((a, b) => b.mtime - a.mtime);
}

/** Resolve readable path for a diagram file (for JSON responses / logs) */
function diagramPublicPath(workspace, stem) {
  return `exportedfiles/${workspace}/${stem}.txt`;
}

async function isRegularFile(p) {
  try {
    const st = await fs.stat(p);
    return st.isFile();
  } catch (e) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
}

/** Subfolders of exportedfiles/ that are valid workspace names (plus always `default`). */
app.get('/api/workspaces', async (_req, res) => {
  try {
    await ensureExportDir();
    const names = new Set(['default']);
    let entries;
    try {
      entries = await fs.readdir(exportDir, { withFileTypes: true });
    } catch (e) {
      if (e?.code === 'ENOENT') {
        return res.json(['default']);
      }
      throw e;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const w = safeWorkspace(e.name);
      if (w && w === e.name) names.add(w);
    }
    const list = [...names].sort((a, b) => {
      if (a === 'default') return -1;
      if (b === 'default') return 1;
      return a.localeCompare(b);
    });
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/diagrams', async (req, res) => {
  try {
    const workspace = safeWorkspace(req.query.workspace);
    if (!workspace) {
      return res.status(400).json({ error: 'Invalid workspace (letters, numbers, dot, dash, underscore; max 64 chars)' });
    }
    await ensureExportDir();
    const rows = await listWorkspaceDiagrams(workspace);
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.get('/api/diagrams/:stem', async (req, res) => {
  const workspace = safeWorkspace(req.query.workspace);
  if (!workspace) {
    return res.status(400).json({ error: 'Invalid workspace' });
  }
  const stem = safeStem(req.params.stem);
  if (!stem) return res.status(400).json({ error: 'Invalid name' });
  const inWorkspace = path.join(exportDir, workspace, `${stem}.txt`);
  const legacyRoot = path.join(exportDir, `${stem}.txt`);
  try {
    let text;
    try {
      text = await fs.readFile(inWorkspace, 'utf8');
    } catch (e) {
      if (e?.code !== 'ENOENT') throw e;
      if (workspace === 'default') {
        text = await fs.readFile(legacyRoot, 'utf8');
      } else {
        throw e;
      }
    }
    res.type('text/plain; charset=utf-8').send(text);
  } catch (e) {
    if (e?.code === 'ENOENT') return res.status(404).json({ error: 'Not found' });
    res.status(500).json({ error: String(e?.message || e) });
  }
});

app.post('/api/diagrams', async (req, res) => {
  const workspace = safeWorkspace(req.body?.workspace);
  if (!workspace) {
    return res.status(400).json({ error: 'Invalid workspace (letters, numbers, dot, dash, underscore)' });
  }
  const stem = safeStem(req.body?.name);
  if (!stem) return res.status(400).json({ error: 'Invalid name (use letters, numbers, dot, dash, underscore)' });
  const diagram = req.body?.diagram;
  if (!diagram || typeof diagram !== 'object') {
    return res.status(400).json({ error: 'Missing diagram object' });
  }
  const replace = req.body?.replace === true;
  try {
    await ensureExportDir();
    const wsDir = path.join(exportDir, workspace);
    await fs.mkdir(wsDir, { recursive: true });
    const text = `${JSON.stringify(diagram, null, 2)}\n`;
    const filePath = path.join(wsDir, `${stem}.txt`);
    const legacyPath = workspace === 'default' ? path.join(exportDir, `${stem}.txt`) : null;

    let existingReadPath = null;
    if (await isRegularFile(filePath)) {
      existingReadPath = filePath;
    } else if (legacyPath && (await isRegularFile(legacyPath))) {
      existingReadPath = legacyPath;
    }

    const existed = existingReadPath !== null;
    if (existed && !replace) {
      return res.status(409).json({
        error: 'A file with this name already exists',
        exists: true,
        stem,
        workspace,
      });
    }
    let backupPath = null;
    if (existed && replace && existingReadPath) {
      const backupDir = path.join(wsDir, '.backups');
      await fs.mkdir(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-');
      const backupName = `${stem}.${stamp}.txt`;
      const backupFull = path.join(backupDir, backupName);
      await fs.copyFile(existingReadPath, backupFull);
      backupPath = `exportedfiles/${workspace}/.backups/${backupName}`;
    }
    await fs.writeFile(filePath, text, 'utf8');
    if (legacyPath && existingReadPath === legacyPath && filePath !== legacyPath) {
      await fs.unlink(legacyPath).catch(() => {});
    }
    res.json({
      ok: true,
      stem,
      workspace,
      path: diagramPublicPath(workspace, stem),
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
      'API is running without a production build.\nOpen the app with Vite: npm run dev (with proxy) or npm run dev:all.\nDiagram saves still work; files go to exportedfiles/<workspace>/*.txt'
    );
});

const port = Number(process.env.PORT) || 3000;
app.listen(port, () => {
  console.log(`Server http://localhost:${port}`);
  if (existsSync(indexHtml)) {
    console.log('Serving Zarus Diag Studio (dist/)');
  } else {
    console.log('No dist/ yet — run Vite on :5173 for the UI, or npm run build && npm start');
  }
  console.log(`Diagram storage: ${exportDir}/<workspace>/*.txt (JSON); legacy flat files merged into workspace "default")`);
});
