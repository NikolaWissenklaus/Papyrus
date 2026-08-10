/**
 * paths.js
 * ---------------------------------------------------------------------------
 * Resolucao segura de caminhos dentro da pasta `papyrus`.
 *
 * Toda a API do Papyrus trabalha com "caminhos relativos" (ex: "Checkout/home.json").
 * Este modulo e o unico ponto onde esses caminhos relativos viram caminhos absolutos
 * no disco, garantindo que nenhuma requisicao consiga escapar da raiz (path traversal).
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

/** Pastas reservadas do sistema — nao aparecem na arvore de navegacao. */
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
 * Converte um caminho relativo vindo da API em caminho absoluto validado.
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

/**
 * Gera um nome unico caso ja exista algo com o mesmo nome no diretorio.
 * "home.json" -> "home (2).json"
 */
export async function uniquePath(absolutePath) {
  if (!(await exists(absolutePath))) return absolutePath;

  const dir = path.dirname(absolutePath);
  const ext = path.extname(absolutePath);
  const base = path.basename(absolutePath, ext);

  for (let i = 2; i < 500; i += 1) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error('Nao foi possivel gerar um nome unico.');
}
