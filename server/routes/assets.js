/*
 * Upload de imagem, vindo do Ctrl+V de um print ou do botao de importar.
 *
 * Imagem nao fica embutida em base64 dentro do JSON da pagina. Ela e gravada em
 * `papyrus/_assets/<data>/<uuid>.<ext>` e o documento guarda so a URL. E o que
 * mantem o JSON leve, versionavel e legivel por gente.
 */

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ASSETS_DIR } from '../lib/paths.js';

const router = express.Router();

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/** POST /api/assets  { dataUrl } -> { url, bytes } */
router.post('/assets', async (req, res, next) => {
  try {
    const dataUrl = String(req.body.dataUrl || '');
    const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);

    if (!match) return res.status(400).json({ error: 'dataUrl invalida.' });

    const [, mime, base64] = match;
    const ext = MIME_EXT[mime.toLowerCase()];
    if (!ext) return res.status(415).json({ error: `Formato nao suportado: ${mime}` });

    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 25 * 1024 * 1024) {
      return res.status(413).json({ error: 'Imagem acima de 25 MB.' });
    }

    // Agrupa por dia, para facilitar uma limpeza manual la na frente.
    const bucket = new Date().toISOString().slice(0, 10);
    const dir = path.join(ASSETS_DIR, bucket);
    await fs.mkdir(dir, { recursive: true });

    const filename = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(dir, filename), buffer);

    res.status(201).json({
      url: `/papyrus/_assets/${bucket}/${filename}`,
      bytes: buffer.length,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
