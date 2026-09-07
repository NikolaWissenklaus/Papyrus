/*
 * CRUD da arvore de trabalho (pastas e paginas) e leitura e gravacao de pagina.
 */

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  PAPYRUS_ROOT,
  resolveInPapyrus,
  toRelative,
  sanitizeName,
  exists,
  uniquePath,
} from '../lib/paths.js';
import { scanTree, createEmptyDoc, readDocIfValid, writeDoc } from '../lib/papyrus.js';
import {
  readFolderColors,
  setFolderColor,
  moveFolderColors,
  forgetFolderColors,
} from '../lib/folder-colors.js';

const router = express.Router();

/** GET /api/tree: arvore completa da pasta papyrus. */
router.get('/tree', async (_req, res, next) => {
  try {
    const colors = await readFolderColors();
    res.json({ root: toRelative(PAPYRUS_ROOT), nodes: await scanTree(PAPYRUS_ROOT, 0, colors) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/folders  { parent, name, color? } */
router.post('/folders', async (req, res, next) => {
  try {
    const parent = resolveInPapyrus(req.body.parent || '');
    const name = sanitizeName(req.body.name);
    const target = await uniquePath(path.join(parent, name));
    await fs.mkdir(target, { recursive: true });

    const relative = toRelative(target);
    if (req.body.color) await setFolderColor(relative, req.body.color);

    res.status(201).json({ path: relative, name: path.basename(target), color: req.body.color || null });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/folders/color  { path, color }: cor vazia volta ao padrao. */
router.put('/folders/color', async (req, res, next) => {
  try {
    const absolute = resolveInPapyrus(req.body.path);
    const stat = await fs.stat(absolute);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: 'Somente pastas tem cor personalizada.' });
    }

    await setFolderColor(toRelative(absolute), req.body.color || '');
    res.json({ path: toRelative(absolute), color: req.body.color || null });
  } catch (err) {
    next(err);
  }
});

/** POST /api/pages  { parent, name }: cria uma pagina de canvas vazia. */
router.post('/pages', async (req, res, next) => {
  try {
    const parent = resolveInPapyrus(req.body.parent || '');
    const name = sanitizeName(req.body.name);
    await fs.mkdir(parent, { recursive: true });

    const target = await uniquePath(path.join(parent, `${name}.json`));
    const pageName = path.basename(target, '.json');
    const doc = await writeDoc(target, createEmptyDoc(pageName));

    res.status(201).json({ path: toRelative(target), name: pageName, doc });
  } catch (err) {
    next(err);
  }
});

/** GET /api/page?path=...: le uma pagina validada. */
router.get('/page', async (req, res, next) => {
  try {
    const absolute = resolveInPapyrus(req.query.path);
    const doc = await readDocIfValid(absolute);

    if (!doc) {
      return res.status(422).json({
        error: 'Arquivo ignorado: a raiz do JSON precisa conter "json-type": "papyrus".',
      });
    }
    res.json({ path: toRelative(absolute), doc });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/page  { path, doc }: grava a pagina (auto-save do canvas). */
router.put('/page', async (req, res, next) => {
  try {
    const absolute = resolveInPapyrus(req.body.path);
    if (!absolute.toLowerCase().endsWith('.json')) {
      return res.status(400).json({ error: 'Somente arquivos .json podem ser gravados.' });
    }
    const saved = await writeDoc(absolute, req.body.doc || {});
    res.json({ path: toRelative(absolute), updatedAt: saved.updatedAt });
  } catch (err) {
    next(err);
  }
});

/** PATCH /api/entry  { path, name }: renomeia pasta ou pagina. */
router.patch('/entry', async (req, res, next) => {
  try {
    const absolute = resolveInPapyrus(req.body.path);
    if (absolute === PAPYRUS_ROOT) {
      return res.status(400).json({ error: 'A raiz nao pode ser renomeada.' });
    }

    const stat = await fs.stat(absolute);
    const name = sanitizeName(req.body.name);
    const ext = stat.isDirectory() ? '' : '.json';
    const target = await uniquePath(path.join(path.dirname(absolute), `${name}${ext}`));

    await fs.rename(absolute, target);

    if (stat.isDirectory()) await moveFolderColors(toRelative(absolute), toRelative(target));

    // Mantem o campo `name` do documento em sincronia com o nome do arquivo.
    if (!stat.isDirectory()) {
      const doc = await readDocIfValid(target);
      if (doc) await writeDoc(target, { ...doc, name: path.basename(target, '.json') });
    }

    res.json({ path: toRelative(target), name: path.basename(target, ext) });
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/entry?path=...: exclui pasta (recursivo) ou pagina. */
router.delete('/entry', async (req, res, next) => {
  try {
    const absolute = resolveInPapyrus(req.query.path);
    if (absolute === PAPYRUS_ROOT) {
      return res.status(400).json({ error: 'A raiz nao pode ser excluida.' });
    }
    if (!(await exists(absolute))) return res.status(404).json({ error: 'Nao encontrado.' });

    await fs.rm(absolute, { recursive: true, force: true });
    await forgetFolderColors(toRelative(absolute));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/** POST /api/entry/move  { path, destination }: move pasta/pagina (drag & drop). */
router.post('/entry/move', async (req, res, next) => {
  try {
    const source = resolveInPapyrus(req.body.path);
    const destDir = resolveInPapyrus(req.body.destination || '');

    if (source === PAPYRUS_ROOT) return res.status(400).json({ error: 'Origem invalida.' });
    if (destDir.startsWith(source + path.sep)) {
      return res.status(400).json({ error: 'Nao e possivel mover uma pasta para dentro dela mesma.' });
    }

    const target = await uniquePath(path.join(destDir, path.basename(source)));
    await fs.mkdir(destDir, { recursive: true });
    await fs.rename(source, target);
    await moveFolderColors(toRelative(source), toRelative(target));
    res.json({ path: toRelative(target) });
  } catch (err) {
    next(err);
  }
});

export default router;
