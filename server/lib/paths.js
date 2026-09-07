/*
 * Resolucao segura de caminhos dentro da pasta `papyrus`.
 *
 * A API inteira trabalha com caminho relativo, do tipo "Checkout/home.json".
 * Este e o unico modulo que transforma esse caminho em caminho absoluto no
 * disco, e e ele que garante que nenhuma requisicao escape da raiz por path
 * traversal.
 */

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do projeto (pasta que contem package.json). */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** Diretorio base de todos os arquivos do usuario. */
export const PAPYRUS_ROOT = process.env.PAPYRUS_DIR
  ? path.resolve(process.env.PAPYRUS_DIR)
  : path.join(PROJECT_ROOT, 'papyrus');

/** Pastas reservadas do sistema. Nao aparecem na arvore de navegacao. */
export const SYSTEM_DIRS = ['_assets', '_system'];

/** Onde ficam imagens coladas/importadas. */
export const ASSETS_DIR = path.join(PAPYRUS_ROOT, '_assets');

/** Onde ficam configuracoes internas (grupos de parametros, etc). */
export const SYSTEM_DIR = path.join(PAPYRUS_ROOT, '_system');

/** Garante que a estrutura minima existe no disco. */
export async function ensureBaseStructure() {
  await fs.mkdir(PAPYRUS_ROOT, { recursive: true });
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  await fs.mkdir(SYSTEM_DIR, { recursive: true });
}

/**
 * Converte um caminho relativo vindo da API em caminho absoluto ja validado.
 * Lanca erro se o resultado cair fora de PAPYRUS_ROOT.
 *
 * @param {string} relativePath ex: "" | "Checkout" | "Checkout/carrinho.json"
 * @returns {string} caminho absoluto
 */
export function resolveInPapyrus(relativePath = '') {
  const clean = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .trim();

  const absolute = path.resolve(PAPYRUS_ROOT, clean);
  const rootWithSep = PAPYRUS_ROOT.endsWith(path.sep) ? PAPYRUS_ROOT : PAPYRUS_ROOT + path.sep;

  if (absolute !== PAPYRUS_ROOT && !absolute.startsWith(rootWithSep)) {
    const err = new Error('Caminho fora do diretorio papyrus.');
    err.status = 400;
    throw err;
  }
  return absolute;
}

/** Caminho absoluto -> caminho relativo (com barras normais) usado pela API. */
export function toRelative(absolutePath) {
  const rel = path.relative(PAPYRUS_ROOT, absolutePath);
  return rel.split(path.sep).join('/');
}

/**
 * Sanitiza um nome de arquivo/pasta digitado pelo usuario.
 * Remove separadores e caracteres invalidos no Windows.
 */
export function sanitizeName(name) {
  const clean = String(name || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\.+$/, '')
    .trim();

  if (!clean) {
    const err = new Error('Nome invalido.');
    err.status = 400;
    throw err;
  }
  return clean.slice(0, 120);
}

/** Verifica se um caminho existe. */
export async function exists(absolutePath) {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

/*
 * Nao existe mais um `uniquePath` aqui.
 *
 * Ele resolvia colisao acrescentando "(2)" ao nome, e era exatamente o
 * comportamento que a regra de nome unico proibe: a copia nascia parecida com a
 * original, sem ninguem perceber. Colisao de nome agora vira erro, em
 * lib/names.js.
 */
