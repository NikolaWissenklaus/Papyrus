/**
 * routes/system.js
 * ---------------------------------------------------------------------------
 * Modulos transversais:
 *  - Grupos de Parametros (templates reutilizaveis)
 *  - Dicionario Global (catalogo consolidado do workspace)
 *  - Exportador "Trust Factor" (JSON de regras de negocio, sem dados visuais)
 *  - Configuracao e upload para o Google Cloud Storage
 *  - Importacao de paginas via upload pelo navegador
 *
 * A API nao expoe NENHUM caminho absoluto nem estrutura de pastas do host —
 * requisito para rodar a ferramenta em servidor compartilhado.
 */

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SYSTEM_DIR,
  resolveInPapyrus,
  toRelative,
  sanitizeName,
  uniquePath,
} from '../lib/paths.js';
import { collectAllDocs, extractEvents, readDocIfValid, isPapyrusDoc } from '../lib/papyrus.js';
import {
  gcsStatus, uploadToGcs, readGcsFileConfig, saveGcsConfig, testGcs, gcsEnvOverrides,
} from '../lib/gcs.js';

const router = express.Router();
const TEMPLATES_FILE = path.join(SYSTEM_DIR, 'parameter-groups.json');

/* -------------------------------------------------------------------------- */
/* Grupos de Parametros                                                       */
/* -------------------------------------------------------------------------- */

async function readTemplates() {
  try {
    const raw = await fs.readFile(TEMPLATES_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.groups) ? parsed.groups : [];
  } catch {
    return [];
  }
}

/** GET /api/templates */
router.get('/templates', async (_req, res, next) => {
  try {
    res.json({ groups: await readTemplates() });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/templates  { groups: [...] } — grava a colecao inteira. */
router.put('/templates', async (req, res, next) => {
  try {
    const groups = Array.isArray(req.body.groups) ? req.body.groups : [];
    await fs.mkdir(SYSTEM_DIR, { recursive: true });
    await fs.writeFile(
      TEMPLATES_FILE,
      JSON.stringify({ 'json-type': 'papyrus-templates', updatedAt: new Date().toISOString(), groups }, null, 2),
      'utf8',
    );
    res.json({ ok: true, count: groups.length });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Dicionario Global                                                          */
/* -------------------------------------------------------------------------- */

/**
 * GET /api/dictionary
 * Consolida todo o workspace em tres visoes:
 *   events     -> todos os eventos e onde eles vivem
 *   parameters -> parametros unicos + de-para com os eventos que os usam
 *   conflicts  -> mesmo parametro declarado com tipos diferentes (risco de schema)
 */
router.get('/dictionary', async (_req, res, next) => {
  try {
    const docs = await collectAllDocs();
    const events = [];
    const paramMap = new Map();

    for (const { path: relPath, doc } of docs) {
      const pageName = doc.name || path.basename(relPath, '.json');

      for (const evt of extractEvents(doc)) {
        events.push({ ...evt, page: pageName, pagePath: relPath });

        for (const scope of ['event', 'user', 'items']) {
          for (const param of evt.parameters[scope] || []) {
            const key = `${scope}::${param.name}`;
            if (!paramMap.has(key)) {
              paramMap.set(key, {
                name: param.name,
                scope,
                types: new Set(),
                requiredIn: 0,
                usedBy: [],
              });
            }
            const entry = paramMap.get(key);
            entry.types.add(param.type);
            if (param.required) entry.requiredIn += 1;
            entry.usedBy.push({ event: evt.event_name, page: pageName, pagePath: relPath });
          }
        }
      }
    }

    const parameters = [...paramMap.values()]
      .map((p) => ({
        name: p.name,
        scope: p.scope,
        types: [...p.types],
        requiredIn: p.requiredIn,
        usageCount: p.usedBy.length,
        usedBy: p.usedBy,
      }))
      .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));

    const conflicts = parameters
      .filter((p) => p.types.length > 1)
      .map((p) => ({ name: p.name, scope: p.scope, types: p.types }));

    // Eventos com o mesmo nome declarados em paginas diferentes.
    const byName = new Map();
    for (const e of events) {
      if (!byName.has(e.event_name)) byName.set(e.event_name, []);
      byName.get(e.event_name).push(e.page);
    }
    const duplicates = [...byName.entries()]
      .filter(([, pages]) => pages.length > 1)
      .map(([name, pages]) => ({ name, pages: [...new Set(pages)] }));

    res.json({
      generatedAt: new Date().toISOString(),
      totals: { pages: docs.length, events: events.length, parameters: parameters.length },
      events,
      parameters,
      conflicts,
      duplicates,
    });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Exportador Trust Factor                                                    */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/export/trust
 * body: { paths?: string[], filename?: string, gcs?: boolean }
 *
 * Gera `{ "<nome da pagina>": [ ...eventos com parametros tipados ] }`.
 * Nenhuma coordenada de canvas, cor ou elemento visual entra no arquivo.
 * Destinos: download pelo navegador (padrao) ou bucket GCS. Nao existe
 * gravacao em caminho arbitrario do disco — isso exporia o filesystem do
 * servidor quando a ferramenta roda compartilhada.
 */
router.post('/export/trust', async (req, res, next) => {
  try {
    const { paths: requested, filename, gcs } = req.body;

    const docs =
      Array.isArray(requested) && requested.length
        ? await Promise.all(
            requested.map(async (rel) => {
              const absolute = resolveInPapyrus(rel);
              return { path: rel, doc: await readDocIfValid(absolute) };
            }),
          )
        : await collectAllDocs();

    /** @type {Record<string, object[]>} */
    const payload = {};
    for (const item of docs) {
      if (!item.doc) continue;
      const pageName = item.doc.name || path.basename(item.path, '.json');
      payload[pageName] = extractEvents(item.doc);
    }

    const json = JSON.stringify(payload, null, 2);

    // Destino: bucket do Google Cloud Storage.
    if (gcs) {
      const safeName = sanitizeName(filename || `trust-factor-${Date.now()}`);
      const object = safeName.endsWith('.json') ? safeName : `${safeName}.json`;
      const uploaded = await uploadToGcs({
        filename: object,
        contentType: 'application/json',
        buffer: Buffer.from(json, 'utf8'),
      });
      return res.json({ saved: true, gcs: uploaded, pages: Object.keys(payload).length });
    }

    // Padrao: devolve o conteudo para download direto pelo navegador.
    res.json({ saved: false, payload });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Google Cloud Storage                                                       */
/* -------------------------------------------------------------------------- */

/** GET /api/gcs/status — a UI usa isto para habilitar (ou explicar) a opcao. */
router.get('/gcs/status', async (_req, res, next) => {
  try {
    res.json(await gcsStatus());
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settings/gcs — configuracao atual para a aba Configuracoes.
 * Nem a chave privada nem CAMINHOS do servidor sao devolvidos: a credencial
 * vira apenas o booleano `hasCredential`.
 */
router.get('/settings/gcs', async (_req, res, next) => {
  try {
    const fileConfig = await readGcsFileConfig();
    res.json({
      config: {
        bucket: fileConfig.bucket || '',
        prefix: fileConfig.prefix || '',
        projectId: fileConfig.projectId || '',
        hasCredential: Boolean(fileConfig.keyFilename),
      },
      envOverrides: gcsEnvOverrides(),
      status: await gcsStatus(),
    });
  } catch (err) {
    next(err);
  }
});

/** PUT /api/settings/gcs  { bucket, prefix, projectId, keyJson?, removeKey? } */
router.put('/settings/gcs', async (req, res, next) => {
  try {
    const saved = await saveGcsConfig(req.body || {});
    res.json({
      config: {
        bucket: saved.bucket,
        prefix: saved.prefix,
        projectId: saved.projectId,
        hasCredential: Boolean(saved.keyFilename),
      },
      status: await gcsStatus(),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/gcs/test  { bucket?, prefix?, projectId?, keyJson? }
 * Valida lib + credencial + acesso ao bucket. O corpo é opcional: quando vem
 * preenchido, testa os valores que estão na tela (permite testar sem salvar);
 * quando vem vazio, testa a configuração já persistida.
 */
router.post('/settings/gcs/test', async (req, res, next) => {
  try {
    res.json(await testGcs(req.body || {}));
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/export/gcs
 * body: { filename: string, contentType: string, dataBase64: string }
 * Upload generico — usado pelo exportador de imagens (PNG/JPG).
 */
router.post('/export/gcs', async (req, res, next) => {
  try {
    const { filename, contentType, dataBase64 } = req.body;
    if (!filename || !dataBase64) {
      return res.status(400).json({ error: 'filename e dataBase64 sao obrigatorios.' });
    }

    const buffer = Buffer.from(String(dataBase64), 'base64');
    if (buffer.length > 100 * 1024 * 1024) {
      return res.status(413).json({ error: 'Arquivo acima de 100 MB.' });
    }

    const uploaded = await uploadToGcs({
      filename: sanitizeName(filename),
      contentType: contentType || 'application/octet-stream',
      buffer,
    });
    res.json({ saved: true, gcs: uploaded });
  } catch (err) {
    next(err);
  }
});

/* -------------------------------------------------------------------------- */
/* Importacao                                                                 */
/* -------------------------------------------------------------------------- */

/*
 * Nota de seguranca: a importacao acontece SOMENTE via upload pelo navegador
 * (/api/import/inline). O antigo navegador de diretorios do SO e a importacao
 * por caminho absoluto foram removidos de proposito — quando a ferramenta roda
 * em um servidor compartilhado, eles exporiam a estrutura de pastas do host.
 */

/**
 * POST /api/import/inline
 * body: { files: [{ name, content }], destination? }
 * Usado quando o usuario arrasta/seleciona arquivos pelo proprio navegador.
 */
router.post('/import/inline', async (req, res, next) => {
  try {
    const destination = resolveInPapyrus(req.body.destination || '');
    const files = Array.isArray(req.body.files) ? req.body.files : [];
    const report = { imported: [], ignored: [] };

    await fs.mkdir(destination, { recursive: true });

    for (const f of files) {
      let doc = null;
      try {
        doc = JSON.parse(f.content);
      } catch {
        report.ignored.push({ file: f.name, reason: 'JSON invalido.' });
        continue;
      }
      if (!isPapyrusDoc(doc)) {
        report.ignored.push({ file: f.name, reason: 'Sem "json-type": "papyrus" na raiz.' });
        continue;
      }
      const safe = sanitizeName(f.name.replace(/\.json$/i, ''));
      const target = await uniquePath(path.join(destination, `${safe}.json`));
      await fs.writeFile(target, JSON.stringify(doc, null, 2), 'utf8');
      report.imported.push(toRelative(target));
    }

    res.json(report);
  } catch (err) {
    next(err);
  }
});

export default router;
