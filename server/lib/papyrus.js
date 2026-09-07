/*
 * Regras do formato de arquivo do Papyrus.
 *
 * Um documento papyrus e um JSON que representa uma pagina de canvas. A regra
 * de seguranca que sustenta o resto: so renderizamos um arquivo se a raiz do
 * JSON tiver a chave `"json-type": "papyrus"`. Todo o resto e ignorado.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PAPYRUS_ROOT, SYSTEM_DIRS, toRelative } from './paths.js';

export const PAPYRUS_TYPE = 'papyrus';
export const SCHEMA_VERSION = 1;

/** Parametro que identifica cada evento; precisa ser unico no workspace inteiro. */
export const EVENT_ID_PARAM = 'event_id';

/** Verifica a assinatura obrigatoria do arquivo. */
export function isPapyrusDoc(doc) {
  return Boolean(doc) && typeof doc === 'object' && doc['json-type'] === PAPYRUS_TYPE;
}

/** Cria um documento de pagina vazio, ja com a assinatura correta. */
export function createEmptyDoc(name) {
  const now = new Date().toISOString();
  return {
    'json-type': PAPYRUS_TYPE,
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    viewport: { x: 0, y: 0, scale: 1 },
    elements: [],
  };
}

/**
 * Le um arquivo JSON e devolve o documento apenas se ele for papyrus valido.
 * @returns {object|null}
 */
export async function readDocIfValid(absolutePath) {
  try {
    const raw = await fs.readFile(absolutePath, 'utf8');
    const doc = JSON.parse(raw);
    return isPapyrusDoc(doc) ? doc : null;
  } catch {
    return null;
  }
}

/** Grava um documento, sempre reforcando assinatura e timestamp. */
export async function writeDoc(absolutePath, doc) {
  const safe = {
    ...doc,
    'json-type': PAPYRUS_TYPE,
    schemaVersion: doc.schemaVersion || SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, JSON.stringify(safe, null, 2), 'utf8');
  return safe;
}

/**
 * Varre a pasta papyrus recursivamente e monta a arvore de navegacao.
 *
 * Arquivo .json que nao passa na validacao entra na arvore com `invalid: true`
 * e aparece esmaecido na UI, para ficar claro por que ele nao abre.
 *
 * @param {string} absoluteDir
 * @param {number} depth protecao contra estruturas muito profundas
 * @param {Record<string,string>} colors cores de pasta (ver lib/folder-colors.js)
 */
export async function scanTree(absoluteDir = PAPYRUS_ROOT, depth = 0, colors = {}) {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const nodes = [];

  for (const entry of entries) {
    const absolute = path.join(absoluteDir, entry.name);
    const relative = toRelative(absolute);

    // Ignora pastas reservadas apenas no primeiro nivel.
    if (depth === 0 && entry.isDirectory() && SYSTEM_DIRS.includes(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      nodes.push({
        type: 'folder',
        name: entry.name,
        path: relative,
        color: colors[relative] || null,
        children: depth < 12 ? await scanTree(absolute, depth + 1, colors) : [],
      });
      continue;
    }

    if (!entry.name.toLowerCase().endsWith('.json')) continue;

    const doc = await readDocIfValid(absolute);
    const stat = await fs.stat(absolute);

    nodes.push({
      type: 'page',
      name: entry.name.replace(/\.json$/i, ''),
      path: relative,
      invalid: doc === null,
      updatedAt: stat.mtime.toISOString(),
      eventCount: doc ? countEvents(doc) : 0,
    });
  }

  // Pastas primeiro, depois paginas, as duas em ordem alfabetica natural.
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR', { numeric: true });
  });
}

/** Conta quantos elementos do tipo `event` existem no documento. */
export function countEvents(doc) {
  if (!Array.isArray(doc.elements)) return 0;
  return doc.elements.filter((el) => el.type === 'event').length;
}

/** Percorre todas as paginas validas e devolve `{ path, doc }`. */
export async function collectAllDocs(absoluteDir = PAPYRUS_ROOT, depth = 0, acc = []) {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(absoluteDir, entry.name);
    if (depth === 0 && entry.isDirectory() && SYSTEM_DIRS.includes(entry.name)) continue;
    if (entry.name.startsWith('.')) continue;

    if (entry.isDirectory()) {
      if (depth < 12) await collectAllDocs(absolute, depth + 1, acc);
      continue;
    }
    if (!entry.name.toLowerCase().endsWith('.json')) continue;

    const doc = await readDocIfValid(absolute);
    if (doc) acc.push({ path: toRelative(absolute), doc });
  }
  return acc;
}

/**
 * Extrai so as regras de negocio de um documento, sem as coordenadas do canvas.
 * E a base do exportador de eventos e do Dicionario Global.
 */
export function extractEvents(doc) {
  if (!Array.isArray(doc.elements)) return [];

  return doc.elements
    .filter((el) => el.type === 'event' && el.data)
    .map((el) => {
      const d = el.data;
      const mapParams = (list) =>
        (Array.isArray(list) ? list : [])
          .filter((p) => p && p.name)
          .map((p) => ({
            name: p.name,
            type: p.type || 'string',
            required: Boolean(p.required),
            ...(p.example ? { example: p.example } : {}),
            ...(p.description ? { description: p.description } : {}),
          }));

      const parameters = {
        event: mapParams(d.eventParams),
        user: mapParams(d.userParams),
      };
      if (d.eventType === 'ecommerce') {
        parameters.items = mapParams(d.itemParams);
      }

      return {
        event_name: d.name || 'sem_nome',
        event_type: d.eventType || 'interaction',
        platform: Array.isArray(d.platform) ? d.platform : [],
        trigger: d.trigger || '',
        governance: {
          squad: d.squad || '',
          owner: d.owner || '',
          notes: d.notes || '',
        },
        tracker: {
          card_name: d.ticketName || '',
          card_id: d.ticketId || '',
          url: d.ticketUrl || '',
        },
        parameters,
      };
    });
}
