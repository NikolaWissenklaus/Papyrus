/*
 * Nome unico no workspace inteiro.
 *
 * A regra: dentro de `papyrus` nao existem dois nomes iguais. Nem duas paginas,
 * nem duas pastas, nem uma pasta e uma pagina compartilhando o nome. O escopo e
 * o workspace todo, e nao a pasta onde o item nasce: "abacate" dentro de
 * `frutas` bloqueia "abacate" dentro de `alimentos/frutas/verde`.
 *
 * O motivo esta no exportador. O JSON de coleta usa o nome da pagina como chave
 * raiz, e chave de objeto nao se repete: com dois nomes iguais uma pagina
 * sobrescreveria a outra e o contrato sairia para o bucket com eventos
 * faltando, sem nenhum aviso. Ou o arquivo carrega o caminho inteiro, ou o nome
 * e unico de verdade. Aqui a escolha foi a segunda: o nome vira identificador,
 * e a colisao morre na criacao, quando ainda ha alguem na tela para resolver.
 *
 * Por isso nada aqui renomeia sozinho. Um "(2)" silencioso no fim do nome e
 * justamente o que deixaria duas paginas parecidas convivendo sem ninguem
 * perceber. Colisao vira erro, com o nome e o lugar do que ja existe.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { PAPYRUS_ROOT, SYSTEM_DIRS, toRelative } from './paths.js';

/**
 * Forma de comparacao de um nome.
 *
 * Comparacao sem caixa porque o disco do Windows ja trata "Frutas" e "frutas"
 * como o mesmo arquivo, e porque duas paginas separadas so pela caixa da letra
 * seriam indistinguiveis na arvore lateral.
 */
export function normalizeName(name) {
  return String(name || '').trim().normalize('NFC').toLowerCase();
}

/** Como o item ocupado e chamado na mensagem de erro. */
const LABEL = {
  folder: 'uma pasta',
  page: 'uma página',
  system: 'uma pasta reservada do Papyrus',
};

/** "na pasta X" ou "na raiz do papyrus", a partir do caminho do item. */
function whereOf(relativePath) {
  const dir = relativePath.includes('/')
    ? relativePath.slice(0, relativePath.lastIndexOf('/'))
    : '';
  return dir ? `na pasta "${dir}"` : 'na raiz do papyrus';
}

/**
 * Varre o workspace e devolve `Map<nomeNormalizado, { name, type, path }>`.
 *
 * Conta pasta, pagina e tambem `.json` invalido: arquivo invalido aparece na
 * arvore lateral e ocupa lugar no disco, entao ocupa o nome tambem. As pastas
 * reservadas entram como `system` para ninguem criar uma pasta `_assets` e
 * descobrir depois por que ela nao aparece.
 */
export async function collectNames(absoluteDir = PAPYRUS_ROOT, depth = 0, acc = new Map()) {
  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolute = path.join(absoluteDir, entry.name);
    if (entry.name.startsWith('.')) continue;

    if (depth === 0 && entry.isDirectory() && SYSTEM_DIRS.includes(entry.name)) {
      remember(acc, entry.name, 'system', toRelative(absolute));
      continue;
    }

    if (entry.isDirectory()) {
      remember(acc, entry.name, 'folder', toRelative(absolute));
      if (depth < 12) await collectNames(absolute, depth + 1, acc);
      continue;
    }

    if (!entry.name.toLowerCase().endsWith('.json')) continue;
    remember(acc, entry.name.replace(/\.json$/i, ''), 'page', toRelative(absolute));
  }

  return acc;
}

/*
 * Guarda a primeira ocorrencia. Workspace criado antes desta regra pode ter
 * nomes repetidos, e para a mensagem de erro basta apontar um deles.
 */
function remember(acc, name, type, relativePath) {
  const key = normalizeName(name);
  if (!acc.has(key)) acc.set(key, { name, type, path: relativePath });
}

/**
 * Procura quem ja ocupa o nome.
 *
 * `ignorePath` e o proprio item numa renomeacao: sem ele, trocar "abacate" por
 * "Abacate" acusaria conflito do item consigo mesmo.
 *
 * @returns {{ name: string, type: string, path: string }|null}
 */
export function findConflict(taken, name, ignorePath = null) {
  const hit = taken.get(normalizeName(name));
  if (!hit) return null;
  if (ignorePath && hit.path === toApiPath(ignorePath)) return null;
  return hit;
}

/** Caminho da API sempre com barra normal, venha ele do Windows ou nao. */
function toApiPath(value) {
  return String(value).split(path.sep).join('/');
}

/** Frase que explica a colisao para quem esta na tela. */
export function describeConflict(hit) {
  if (hit.type === 'system') {
    return `O nome "${hit.name}" é reservado pelo Papyrus. Escolha outro nome.`;
  }
  return (
    `Já existe ${LABEL[hit.type]} chamada "${hit.name}" ${whereOf(hit.path)}. ` +
    'Nomes de páginas e pastas são únicos no workspace inteiro, então escolha outro nome.'
  );
}

/**
 * Bloqueia o nome se ele ja estiver ocupado. Erro 409, com nome e lugar do que
 * ja existe: quem esta criando precisa saber com o que colidiu para decidir.
 */
export async function assertNameAvailable(name, { ignorePath = null } = {}) {
  const hit = findConflict(await collectNames(), name, ignorePath);
  if (!hit) return;

  const err = new Error(describeConflict(hit));
  err.status = 409;
  throw err;
}
