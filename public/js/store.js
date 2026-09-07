/*
 * Estado central da aplicacao, historico de undo/redo e auto-save.
 *
 * Existe um documento aberto por vez, em `state.doc`. Toda alteracao passa por
 * commit(), que empilha um snapshot do estado anterior, aplica a mutacao em uma
 * copia, avisa os assinantes e agenda o auto-save.
 *
 * O historico guarda snapshots inteiros do documento. Um sistema de comandos
 * invertidos seria mais economico, mas tambem bem mais facil de quebrar, e
 * nesta escala a economia nao paga: uma pagina tipica tem dezenas de
 * elementos, nao milhares.
 */

import { api } from './api.js';
import { clone, debounce, uid } from './util.js';

const HISTORY_LIMIT = 80;

const listeners = new Map();

export const state = {
  /** Arvore de pastas/paginas vinda do disco. */
  tree: [],
  /** Caminho relativo da pagina aberta (ex: "Checkout/carrinho.json"). */
  currentPath: null,
  /** Documento papyrus aberto. */
  doc: null,
  /** IDs dos elementos selecionados no canvas. */
  selection: [],
  /** Ferramenta ativa do toolpad. */
  tool: 'select',
  /** Grupos de parametros salvos. */
  templates: [],
  /** Aba ativa: canvas | templates | dictionary. */
  view: 'canvas',
  /** Estado do auto-save: idle | saving | saved | error. */
  saveStatus: 'idle',
};

const history = { undo: [], redo: [] };

/*
 * Ultimo commit registrado, usado para agrupar alteracoes continuas. Digitar o
 * nome de um evento gera dezenas de commits, e todos eles precisam caber em um
 * unico passo de undo.
 */
let lastCommit = { key: null, at: 0 };
const COALESCE_WINDOW = 1200;

/* Pub/Sub */

export function on(event, handler) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(handler);
  return () => listeners.get(event).delete(handler);
}

export function emit(event, payload) {
  listeners.get(event)?.forEach((handler) => handler(payload));
}

/* Auto-save */

function setSaveStatus(status) {
  state.saveStatus = status;
  emit('save-status', status);
}

async function persist() {
  if (!state.currentPath || !state.doc) return;
  setSaveStatus('saving');
  try {
    await api.savePage(state.currentPath, state.doc);
    setSaveStatus('saved');
  } catch (err) {
    setSaveStatus('error');
    emit('error', err);
  }
}

const scheduleSave = debounce(persist, 700);

/** Forca a gravacao imediata (usado antes de trocar de pagina ou exportar). */
export async function flushSave() {
  scheduleSave.cancel();
  await persist();
}

/* Arvore e paginas */

export async function loadTree() {
  const { nodes } = await api.getTree();
  state.tree = nodes;
  emit('tree', nodes);
  return nodes;
}

export async function openPage(path) {
  if (state.currentPath === path) return state.doc;
  if (state.currentPath) await flushSave();

  const { doc } = await api.readPage(path);
  state.currentPath = path;
  state.doc = doc;
  state.selection = [];
  history.undo.length = 0;
  history.redo.length = 0;
  lastCommit = { key: null, at: 0 };

  setSaveStatus('idle');
  emit('page-opened', { path, doc });
  emit('doc', doc);
  emit('selection', []);
  return doc;
}

/** Fecha a pagina atual (apos exclusao, por exemplo). */
export function closePage() {
  state.currentPath = null;
  state.doc = null;
  state.selection = [];
  history.undo.length = 0;
  history.redo.length = 0;
  lastCommit = { key: null, at: 0 };
  emit('page-opened', { path: null, doc: null });
  emit('doc', null);
  emit('selection', []);
}

/* Mutacoes e historico */

/**
 * Aplica uma mutacao no documento com suporte a undo.
 * @param {(doc: object) => void} mutator recebe uma copia mutavel do documento
 * @param {object} [options]
 * @param {boolean} [options.silent] nao emite evento 'doc' (usado em drag continuo)
 * @param {boolean} [options.noHistory] nao registra no historico (ex.: viewport)
 * @param {string}  [options.coalesceKey] agrupa commits consecutivos da mesma
 *        origem em um unico passo de undo (ex.: digitacao em um campo)
 */
export function commit(mutator, options = {}) {
  if (!state.doc) return;

  const now = Date.now();
  const coalesce =
    Boolean(options.coalesceKey) &&
    lastCommit.key === options.coalesceKey &&
    now - lastCommit.at < COALESCE_WINDOW;

  if (!options.noHistory && !coalesce) {
    history.undo.push(clone(state.doc));
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
    history.redo.length = 0;
  }
  lastCommit = { key: options.coalesceKey || null, at: now };

  const draft = clone(state.doc);
  mutator(draft);
  state.doc = draft;

  if (!options.silent) emit('doc', state.doc);
  emit('history', canUndoRedo());
  scheduleSave();
}

export function canUndoRedo() {
  return { undo: history.undo.length > 0, redo: history.redo.length > 0 };
}

export function undo() {
  if (!history.undo.length) return false;
  history.redo.push(clone(state.doc));
  state.doc = history.undo.pop();
  // Sem este reset, um commit agrupado logo depois do undo nao empilharia
  // snapshot, e o Ctrl+Z seguinte nao teria para onde voltar.
  lastCommit = { key: null, at: 0 };
  pruneSelection();
  emit('doc', state.doc);
  emit('selection', state.selection);
  emit('history', canUndoRedo());
  scheduleSave();
  return true;
}

export function redo() {
  if (!history.redo.length) return false;
  history.undo.push(clone(state.doc));
  state.doc = history.redo.pop();
  lastCommit = { key: null, at: 0 };
  pruneSelection();
  emit('doc', state.doc);
  emit('selection', state.selection);
  emit('history', canUndoRedo());
  scheduleSave();
  return true;
}

/** Remove da selecao IDs que deixaram de existir apos um undo/redo. */
function pruneSelection() {
  const ids = new Set((state.doc?.elements || []).map((el) => el.id));
  state.selection = state.selection.filter((id) => ids.has(id));
}

/* Helpers de elementos */

export function getElements() {
  return state.doc?.elements || [];
}

export function getElement(id) {
  return getElements().find((el) => el.id === id) || null;
}

export function addElements(elements, { select = true } = {}) {
  const list = Array.isArray(elements) ? elements : [elements];
  commit((doc) => {
    doc.elements.push(...list);
  });
  if (select) setSelection(list.map((el) => el.id));
  return list;
}

export function updateElement(id, patch, options = {}) {
  commit((doc) => {
    const el = doc.elements.find((e) => e.id === id);
    if (el) Object.assign(el, patch);
  }, options);
}

/** Atualiza o objeto `data` de um card de evento (merge raso). */
export function updateEventData(id, patch, options = {}) {
  commit((doc) => {
    const el = doc.elements.find((e) => e.id === id);
    if (el) el.data = { ...el.data, ...patch };
  }, options);
}

export function removeElements(ids) {
  const set = new Set(ids);
  commit((doc) => {
    doc.elements = doc.elements.filter((el) => {
      if (set.has(el.id)) return false;
      // Conectores orfaos sao removidos junto com o elemento de origem/destino.
      if (el.type === 'connector' && (set.has(el.from?.id) || set.has(el.to?.id))) return false;
      return true;
    });
  });
  setSelection([]);
}

/** Move elementos no eixo Z (para frente / para tras). */
export function reorder(ids, direction) {
  const set = new Set(ids);
  commit((doc) => {
    const moving = doc.elements.filter((el) => set.has(el.id));
    const rest = doc.elements.filter((el) => !set.has(el.id));
    doc.elements = direction === 'front' ? [...rest, ...moving] : [...moving, ...rest];
  });
}

/* Selecao */

export function setSelection(ids) {
  state.selection = [...new Set(ids)];
  emit('selection', state.selection);
}

export function toggleSelection(id) {
  const next = state.selection.includes(id)
    ? state.selection.filter((s) => s !== id)
    : [...state.selection, id];
  setSelection(next);
}

export function getSelectedElements() {
  return state.selection.map(getElement).filter(Boolean);
}

/* Viewport */

/** Viewport fica fora do historico: zoom e pan nao devem ser desfeitos. */
export function saveViewport(viewport) {
  if (!state.doc) return;
  state.doc.viewport = viewport;
  scheduleSave();
}

/* Grupos de parametros */

export async function loadTemplates() {
  const { groups } = await api.getTemplates();
  state.templates = groups;
  emit('templates', groups);
  return groups;
}

export async function saveTemplates(groups) {
  state.templates = groups;
  await api.saveTemplates(groups);
  emit('templates', groups);
}

export function newTemplateGroup(name) {
  return { id: uid('grp'), name, scope: 'eventParams', description: '', params: [] };
}

/* Navegacao entre abas */

export function setView(view) {
  state.view = view;
  emit('view', view);
}

export function setTool(tool) {
  state.tool = tool;
  emit('tool', tool);
}
