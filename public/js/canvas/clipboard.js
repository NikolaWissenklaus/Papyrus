/*
 * Copiar e colar elementos e imagens.
 *
 * O que e copiado tambem vai para a area de transferencia do sistema, como
 * JSON assinado (`papyrus/clipboard`). E o que permite colar elementos de uma
 * pagina em outra, e ate entre abas do navegador.
 */

import { state, addElements, getElement } from '../store.js';
import { uid, readFileAsDataURL, loadImage } from '../util.js';
import { createImage, renewEventIds } from '../models.js';
import { api } from '../api.js';
import { toast } from '../ui/toast.js';
import { viewportCenter } from './stage.js';
import { primeImage } from './nodes.js';

const SIGNATURE = 'papyrus/clipboard';

/** Buffer interno, usado quando o navegador bloqueia a leitura do clipboard. */
let buffer = null;

/* Copiar e recortar */

export async function copySelection() {
  const selected = state.selection.map(getElement).filter(Boolean);
  if (!selected.length) return false;

  const payload = { signature: SIGNATURE, elements: structuredClone(selected) };
  buffer = payload;

  try {
    await navigator.clipboard.writeText(JSON.stringify(payload));
  } catch {
    /* sem permissao de clipboard; o buffer interno cobre o caso */
  }

  toast.info(`${selected.length} elemento(s) copiado(s).`);
  return true;
}

/* Colar */

/** Reidrata elementos copiados com novos IDs, preservando conectores internos. */
function rehydrate(elements, origin) {
  const idMap = new Map();
  const result = [];

  for (const el of elements) {
    if (el.type === 'connector') continue;
    const copy = structuredClone(el);
    copy.id = uid(el.type);
    idMap.set(el.id, copy.id);
    result.push(copy);
  }

  for (const el of elements) {
    if (el.type !== 'connector') continue;
    if (!idMap.has(el.from?.id) || !idMap.has(el.to?.id)) continue;
    const copy = structuredClone(el);
    copy.id = uid('cnn');
    copy.from = { ...copy.from, id: idMap.get(el.from.id) };
    copy.to = { ...copy.to, id: idMap.get(el.to.id) };
    result.push(copy);
  }

  // A copia entra como card novo, entao ganha event_id proprio. Colando em
  // outra pagina, o id ja sai com o prefixo da pasta de destino.
  renewEventIds(result);

  // Reposiciona o bloco colado no centro da viewport atual.
  const shapes = result.filter((el) => el.type !== 'connector');
  if (shapes.length) {
    const minX = Math.min(...shapes.map((el) => el.x));
    const minY = Math.min(...shapes.map((el) => el.y));
    const dx = origin.x - minX;
    const dy = origin.y - minY;
    for (const el of shapes) {
      el.x += dx;
      el.y += dy;
    }
  }

  return result;
}

/** Sobe a imagem para o servidor e insere no canvas com escala adequada. */
export async function insertImageFromFile(file, position) {
  if (!state.doc) {
    toast.error('Abra uma página antes de inserir imagens.');
    return;
  }

  try {
    const dataUrl = await readFileAsDataURL(file);
    const { url } = await api.uploadAsset(dataUrl);

    const img = await loadImage(url);
    primeImage(url, img);

    // Limita a largura inicial para nao "explodir" o canvas com prints grandes.
    const maxWidth = 760;
    const scale = img.width > maxWidth ? maxWidth / img.width : 1;
    const at = position || viewportCenter();

    addElements(
      createImage(
        Math.round(at.x - (img.width * scale) / 2),
        Math.round(at.y - (img.height * scale) / 2),
        { url, width: Math.round(img.width * scale), height: Math.round(img.height * scale) },
      ),
    );
    toast.ok('Imagem inserida.');
  } catch (err) {
    toast.error(`Falha ao inserir imagem: ${err.message}`);
  }
}

/*
 * Handler global de `paste`, nesta ordem de prioridade: imagem na area de
 * transferencia (print de tela), JSON assinado do Papyrus e, por ultimo, texto
 * simples, que vira nota adesiva.
 */
export async function handlePaste(event) {
  if (!state.doc) return;

  const items = [...(event.clipboardData?.items || [])];
  const imageItem = items.find((i) => i.type.startsWith('image/'));

  if (imageItem) {
    event.preventDefault();
    const file = imageItem.getAsFile();
    if (file) await insertImageFromFile(file, viewportCenter());
    return;
  }

  const text = event.clipboardData?.getData('text/plain');
  let payload = null;

  if (text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.signature === SIGNATURE) payload = parsed;
    } catch {
      /* nao era JSON do Papyrus */
    }
  }
  if (!payload) payload = buffer;

  if (payload?.elements?.length) {
    event.preventDefault();
    const center = viewportCenter();
    addElements(rehydrate(payload.elements, { x: center.x - 120, y: center.y - 80 }));
    return;
  }

  // Texto solto vira nota adesiva. Ajuda na hora de trazer requisito de fora.
  if (text && text.trim() && !isTypingTarget(event.target)) {
    event.preventDefault();
    const { createSticky } = await import('../models.js');
    const center = viewportCenter();
    const note = createSticky(Math.round(center.x - 90), Math.round(center.y - 90));
    note.text = text.trim().slice(0, 800);
    addElements(note);
  }
}

function isTypingTarget(target) {
  return Boolean(
    target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable),
  );
}
