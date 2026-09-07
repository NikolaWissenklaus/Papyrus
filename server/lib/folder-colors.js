/*
 * Cor do icone de cada pasta na barra lateral.
 *
 * O mapa fica em `_system/folder-colors.json`, indexado pelo caminho relativo
 * da pasta. Ele mora fora das pastas do usuario de proposito: cor e assunto de
 * interface, nao conteudo do mapa de coleta. Assim o JSON de cada pagina
 * continua limpo e facil de versionar.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { SYSTEM_DIR } from './paths.js';

const COLORS_FILE = path.join(SYSTEM_DIR, 'folder-colors.json');
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/** Mapa `{ "caminho/da/pasta": "#RRGGBB" }`. Nunca lanca. */
export async function readFolderColors() {
  try {
    const parsed = JSON.parse(await fs.readFile(COLORS_FILE, 'utf8'));
    return parsed && typeof parsed.colors === 'object' && parsed.colors ? parsed.colors : {};
  } catch {
    return {};
  }
}

async function writeFolderColors(colors) {
  await fs.mkdir(SYSTEM_DIR, { recursive: true });
  await fs.writeFile(
    COLORS_FILE,
    JSON.stringify(
      { 'json-type': 'papyrus-folder-colors', updatedAt: new Date().toISOString(), colors },
      null,
      2,
    ),
    'utf8',
  );
}

/** Define a cor de uma pasta. Cor vazia volta a pasta para o padrao. */
export async function setFolderColor(relativePath, color) {
  if (!relativePath) {
    const err = new Error('Informe a pasta que recebe a cor.');
    err.status = 400;
    throw err;
  }
  if (color && !HEX_COLOR.test(color)) {
    const err = new Error('Cor invalida: use hexadecimal no formato #RRGGBB.');
    err.status = 400;
    throw err;
  }

  const colors = await readFolderColors();
  if (color) colors[relativePath] = color.toUpperCase();
  else delete colors[relativePath];

  await writeFolderColors(colors);
  return colors;
}

/**
 * Reaponta as chaves depois de renomear ou mover uma pasta, incluindo as
 * subpastas, que tambem mudaram de caminho. Sem isso a cor se perderia a cada
 * arrastar e soltar na arvore.
 */
export async function moveFolderColors(fromPath, toPath) {
  const colors = await readFolderColors();
  const next = {};
  let changed = false;

  for (const [key, value] of Object.entries(colors)) {
    if (key === fromPath || key.startsWith(`${fromPath}/`)) {
      next[`${toPath}${key.slice(fromPath.length)}`] = value;
      changed = true;
    } else {
      next[key] = value;
    }
  }

  if (changed) await writeFolderColors(next);
}

/** Esquece a pasta excluida e tudo que vivia dentro dela. */
export async function forgetFolderColors(relativePath) {
  const colors = await readFolderColors();
  const keys = Object.keys(colors).filter(
    (key) => key === relativePath || key.startsWith(`${relativePath}/`),
  );
  if (!keys.length) return;

  for (const key of keys) delete colors[key];
  await writeFolderColors(colors);
}
