/*
 * Modulos transversais da API: Grupos de Parametros (templates reutilizaveis),
 * Dicionario Global (catalogo consolidado do workspace), exportador de eventos
 * (JSON so com regra de negocio), configuracao e upload para o Google Cloud
 * Storage, e importacao de pagina por upload pelo navegador.
 *
 * Nada aqui devolve caminho absoluto ou estrutura de pastas do host. E o que
 * permite rodar a ferramenta em um servidor compartilhado.
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
import { collectAllDocs, extractEvents, readDocIfValid, isPapyrusDoc, EVENT_ID_PARAM } from '../lib/papyrus.js';
import {
  gcsStatus, uploadToGcs, readGcsFileConfig, saveGcsConfig, testGcs, gcsEnvOverrides,
} from '../lib/gcs.js';

const router = express.Router();
const TEMPLATES_FILE = path.join(SYSTEM_DIR, 'parameter-groups.json');

/* Grupos de Parametros */

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

/** PUT /api/templates  { groups: [...] }: grava a colecao inteira. */
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

/* Dicionario Global */

/**
 * GET /api/dictionary
 *
 * Consolida o workspace inteiro em tres visoes: `events` traz todo evento e
 * onde ele mora, `parameters` traz os parametros unicos com o de-para dos
 * eventos que os usam, e `conflicts` lista o mesmo parametro declarado com
 * tipos diferentes, que e o risco de schema. `eventIdCollisions` fecha a conta
 * apontando o event_id que aparece em mais de um card.
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

    // event_id repetido. O validador da pagina so enxerga a pagina aberta, e a
    // chave precisa ser unica no workspace todo, entao a colisao entre paginas
    // so aparece aqui.
    const byEventId = new Map();
    for (const e of events) {
      const id = ((e.parameters.event || []).find((p) => p.name === EVENT_ID_PARAM)?.example || '').trim();
      if (!id) continue;
      if (!byEventId.has(id)) byEventId.set(id, []);
      byEventId.get(id).push({ event: e.event_name, page: e.page, pagePath: e.pagePath });
    }
    const eventIdCollisions = [...byEventId.entries()]
      .filter(([, uses]) => uses.length > 1)
      .map(([id, uses]) => ({ id, uses }));

    res.json({
      generatedAt: new Date().toISOString(),
      totals: { pages: docs.length, events: events.length, parameters: parameters.length },
      events,
      parameters,
      conflicts,
      eventIdCollisions,
    });
  } catch (err) {
    next(err);
  }
});

/* Exportador */

/**
 * POST /api/export/events
 * body: { paths?: string[], filename?: string }
 *
 * Gera `{ "<nome da pagina>": [ ...eventos com parametros tipados ] }`.
 * Nenhuma coordenada de canvas, cor ou elemento visual entra no arquivo.
 *
 * O destino e sempre o bucket do Google Cloud Storage configurado. O contrato
 * de coleta precisa morar em um lugar so, versionado e acessivel ao time; um
 * download solto na maquina de quem exportou vira copia divergente no dia
 * seguinte. Gravar em caminho de disco tambem nao e opcao, porque exporia o
 * filesystem do servidor quando a ferramenta roda compartilhada.
 *
 * Recusa a exportacao quando algum event_id falta ou se repete. A UI ja checa
 * isso antes de habilitar o botao, mas a garantia precisa morar aqui: o arquivo
 * no bucket e lido como verdade pelo time de engenharia, e um id repetido faz
 * dois eventos diferentes chegarem como o mesmo no GA4.
 */
/** Aponta evento sem event_id e event_id usado por mais de um evento. */
function findEventIdProblems(payload) {
  const problems = [];
  const byId = new Map();

  for (const [page, events] of Object.entries(payload)) {
    for (const evt of events) {
      const id = ((evt.parameters?.event || []).find((p) => p.name === EVENT_ID_PARAM)?.example || '').trim();

      if (!id) {
        problems.push({ kind: 'missing', page, event: evt.event_name });
        continue;
      }
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push({ page, event: evt.event_name });
    }
  }

  for (const [id, uses] of byId) {
    if (uses.length > 1) problems.push({ kind: 'duplicate', id, uses });
  }

  return problems;
}

router.post('/export/events', async (req, res, next) => {
  try {
    const { paths: requested, filename } = req.body;

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

    const problems = findEventIdProblems(payload);
    if (problems.length) {
      return res.status(409).json({
        error: 'Exportacao bloqueada: event_id ausente ou repetido.',
        problems,
      });
    }

    const json = JSON.stringify(payload, null, 2);
    const safeName = sanitizeName(filename || `papyrus-${Date.now()}`);
    const object = safeName.endsWith('.json') ? safeName : `${safeName}.json`;

    const uploaded = await uploadToGcs({
      filename: object,
      contentType: 'application/json',
      buffer: Buffer.from(json, 'utf8'),
    });
    res.json({ saved: true, gcs: uploaded, pages: Object.keys(payload).length });
  } catch (err) {
    next(err);
  }
});

/* Google Cloud Storage */

/** GET /api/gcs/status: a UI usa isto para habilitar, ou explicar, a opcao. */
router.get('/gcs/status', async (_req, res, next) => {
  try {
    res.json(await gcsStatus());
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settings/gcs: configuracao atual para a aba Configuracoes.
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

/* Importacao */

/*
 * A importacao acontece so por upload pelo navegador, em /api/import/inline. O
 * antigo navegador de diretorios do SO e a importacao por caminho absoluto
 * foram removidos de proposito: com a ferramenta em servidor compartilhado, os
 * dois exporiam a estrutura de pastas do host.
 */

/**
 * POST /api/import/inline
 * body: { files: [{ name, content }], destination? }
 * Usado quando a pessoa arrasta ou seleciona arquivos pelo proprio navegador.
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
