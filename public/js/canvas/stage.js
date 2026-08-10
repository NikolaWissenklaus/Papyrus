/**
 * canvas/stage.js
 * ---------------------------------------------------------------------------
 * O canvas infinito: palco Konva, pan/zoom, ferramentas, selecao, arrasto,
 * conectores magneticos e edicao inline de texto.
 *
 * Estrategia de render: incremental com diff por fingerprint (`render()`) —
 * cada elemento e comparado com a versao que gerou seu no Konva e so o que
 * mudou e reconstruido; commits do mesmo frame sao agrupados em um unico
 * render. Durante um arrasto nada e reconstruido — o Konva move os nos e apenas
 * os conectores sao recalculados em tempo real (`redrawConnectors`).
 */

import {
  state, commit, getElements, getElement, addElements, updateElement,
  removeElements, setSelection, toggleSelection, saveViewport, setTool, on,
} from '../store.js';
import { clamp, uid } from '../util.js';
import { DEFAULTS } from '../constants.js';
import {
  createShape, createSticky, createText, createPin, createConnector, createEventCard,
} from '../models.js';
import { buildNode, imageCache } from './nodes.js';
import {
  getBounds, getContentBounds, intersects, routeConnector, connectorPoints, bezierMidpoint, sizeCache,
} from './geometry.js';
import { toast } from '../ui/toast.js';

const GRID = 24;
const MIN_SCALE = 0.08;
const MAX_SCALE = 4;

/** Elementos que podem ser redimensionados livremente. */
const RESIZABLE = new Set(['rect', 'ellipse', 'image', 'sticky']);
/** Elementos em que so faz sentido ajustar a largura. */
const WIDTH_ONLY = new Set(['event', 'text']);

let stage = null;
let layer = null;      // elementos
let overlay = null;    // transformer, marquee, preview de conector
let transformer = null;
let marquee = null;
let host = null;

/** Konva nodes indexados por id do elemento. */
const nodes = new Map();

/** Estado transiente das interacoes. */
const session = {
  spaceDown: false,
  panning: false,
  dragStart: null,        // posicoes iniciais no arrasto multiplo
  connectFrom: null,      // id de origem enquanto desenha um conector
  connectPreview: null,
  editing: null,          // textarea aberto
};

/* ========================================================================== */
/* Inicializacao                                                              */
/* ========================================================================== */

export function initStage(container) {
  host = container;

  // Em monitores com escala alta (Windows a 200%+), o Konva renderiza cada
  // canvas em devicePixelRatio cheio — 2.5x de escala = 6x mais pixels por
  // frame. Limitar a 2 e visualmente identico e muito mais leve.
  Konva.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

  stage = new Konva.Stage({
    container,
    width: container.clientWidth || 800,
    height: container.clientHeight || 600,
  });

  layer = new Konva.Layer();
  overlay = new Konva.Layer();
  stage.add(layer, overlay);

  transformer = new Konva.Transformer({
    rotateEnabled: false,
    borderStroke: '#1A73E8',
    borderStrokeWidth: 1.5,
    anchorStroke: '#1A73E8',
    anchorFill: '#FFFFFF',
    anchorSize: 8,
    anchorCornerRadius: 2,
    padding: 4,
    ignoreStroke: true,
    boundBoxFunc: (oldBox, newBox) => (newBox.width < 40 || newBox.height < 24 ? oldBox : newBox),
  });
  overlay.add(transformer);

  marquee = new Konva.Rect({
    fill: 'rgba(26,115,232,0.08)',
    stroke: '#1A73E8',
    strokeWidth: 1,
    dash: [4, 3],
    visible: false,
  });
  overlay.add(marquee);

  bindStageEvents();
  bindTransformer();
  bindWindowEvents();

  // Ao trocar para as abas "Grupos" ou "Dicionário" o container fica com
  // display:none e reporta 0x0. Redimensionar o palco para zero faz o Konva
  // tentar desenhar um canvas vazio e lançar erro — por isso ignoramos.
  new ResizeObserver(() => {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;

    stage.width(width);
    stage.height(height);
    paintGrid();
  }).observe(host);

  // Re-renderiza sempre que o documento ou a selecao mudarem.
  // O agendamento por frame evita renders redundantes durante digitacao rapida.
  on('doc', () => scheduleRender());
  on('selection', () => applySelectionVisuals());
  on('tool', (tool) => {
    cancelConnector();
    host.classList.toggle('is-panning', tool === 'hand');
    stage.container().style.cursor = cursorForTool(tool);
  });

  return stage;
}

const cursorForTool = (tool) =>
  tool === 'hand' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';

/* ========================================================================== */
/* Render                                                                     */
/* ========================================================================== */

/**
 * Cache de render incremental: id -> { fp, node }.
 * `fp` e o fingerprint (JSON) do elemento na ultima construcao — se nao mudou,
 * o no Konva e reaproveitado como esta. Reconstruir tudo a cada tecla digitada
 * no inspetor era a principal fonte de travamento em mapas grandes.
 */
const nodeCache = new Map();

export function render() {
  if (!stage) return;

  const elements = getElements();
  const ctx = { findElement: getElement, requestRender: () => render() };

  // 1. Remove nos de elementos que deixaram de existir (cobre conectores).
  const aliveIds = new Set(elements.map((el) => el.id));
  for (const [id, node] of nodes) {
    if (!aliveIds.has(id)) {
      node.destroy();
      nodes.delete(id);
      nodeCache.delete(id);
    }
  }

  // 2. Elementos: diff por fingerprint — so o que mudou e reconstruido.
  for (const el of elements) {
    if (el.type === 'connector') continue;

    // Imagens: o visual muda quando o arquivo termina de carregar (placeholder
    // -> bitmap) mesmo com o elemento identico, entao o estado entra no hash.
    const loadedSuffix = el.type === 'image' && imageCache.has(el.url) ? '|loaded' : '';
    const fp = JSON.stringify(el) + loadedSuffix;
    const cached = nodeCache.get(el.id);

    if (cached && cached.fp === fp) continue; // no reaproveitado como esta

    cached?.node.destroy();
    const node = buildNode(el, ctx);
    if (!node) {
      nodeCache.delete(el.id);
      nodes.delete(el.id);
      continue;
    }
    wireNode(node, el);
    nodeCache.set(el.id, { fp, node });
    nodes.set(el.id, node);
    layer.add(node);
  }

  // 3. Conectores: sempre reconstruidos — dependem da posicao e da altura
  //    medida (sizeCache) dos elementos ancorados. Sao poucos e baratos.
  for (const el of elements) {
    if (el.type !== 'connector') continue;
    nodes.get(el.id)?.destroy();
    nodes.delete(el.id);

    const node = buildNode(el, ctx);
    if (!node) continue;
    nodes.set(el.id, node);
    layer.add(node);
  }

  // 4. Ordem Z: o `layer.add` de um no que JA e filho do layer e no-op no
  //    Konva, entao a pilha e realinhada explicitamente com a ordem do array
  //    (conectores por ultimo ja saem naturalmente no topo do array de render).
  for (const el of elements) {
    if (el.type === 'connector') continue;
    nodes.get(el.id)?.moveToTop();
  }
  for (const el of elements) {
    if (el.type !== 'connector') continue;
    nodes.get(el.id)?.moveToTop();
  }

  layer.batchDraw();
  applySelectionVisuals();
}

/** Agrupa varios eventos 'doc' do mesmo frame em UM unico render. */
let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

/** Restaura zoom/pan salvos no documento. */
export function applyViewport(viewport) {
  if (!stage) return;
  const v = viewport || { x: 0, y: 0, scale: 1 };
  stage.scale({ x: v.scale, y: v.scale });
  stage.position({ x: v.x, y: v.y });
  stage.batchDraw();
  paintGrid();
  emitZoom();
}

/* ========================================================================== */
/* Grid                                                                       */
/* ========================================================================== */

/** A malha e desenhada via CSS no container — custo zero de render no Konva. */
function paintGrid() {
  if (!host || !stage) return;
  const scale = stage.scaleX();
  const size = GRID * scale;
  const dot = clamp(1 * scale, 0.6, 2);

  host.style.backgroundImage = `radial-gradient(circle, #DADCE0 ${dot}px, transparent ${dot}px)`;
  host.style.backgroundSize = `${size}px ${size}px`;
  host.style.backgroundPosition = `${stage.x()}px ${stage.y()}px`;
}

/* ========================================================================== */
/* Eventos do palco                                                           */
/* ========================================================================== */

function bindStageEvents() {
  // --- Zoom (Ctrl/pinch) e pan (scroll) ------------------------------------
  stage.on('wheel', (e) => {
    e.evt.preventDefault();

    if (e.evt.ctrlKey || e.evt.metaKey) {
      zoomAt(stage.getPointerPosition(), e.evt.deltaY > 0 ? 0.92 : 1.08);
    } else {
      stage.position({
        x: stage.x() - (e.evt.shiftKey ? e.evt.deltaY : e.evt.deltaX),
        y: stage.y() - (e.evt.shiftKey ? 0 : e.evt.deltaY),
      });
      stage.batchDraw();
      paintGrid();
      persistViewport();
    }
  });

  // --- Mouse down ----------------------------------------------------------
  stage.on('mousedown touchstart', (e) => {
    if (session.editing) commitInlineEdit();

    const isEmpty = e.target === stage;
    const middleButton = e.evt.button === 1;

    // Pan: ferramenta mao, espaco pressionado ou botao do meio
    if (state.tool === 'hand' || session.spaceDown || middleButton) {
      e.evt.preventDefault();
      startPan();
      return;
    }

    // Ferramentas de criacao
    if (isEmpty && state.tool !== 'select' && state.tool !== 'connector') {
      createFromTool(pointerWorld());
      return;
    }

    // Selecao por arrasto (marquee)
    if (isEmpty && state.tool === 'select') {
      if (!e.evt.shiftKey) setSelection([]);
      startMarquee();
    }
  });

  // --- Clique em elemento --------------------------------------------------
  stage.on('click tap', (e) => {
    if (e.target === stage) return;
    const node = e.target.findAncestor('.element', true) || e.target.getParent();
    const id = node?.id();
    if (!id) return;

    if (state.tool === 'connector') {
      handleConnectorClick(id);
      return;
    }
    if (e.evt.shiftKey) toggleSelection(id);
    else if (!state.selection.includes(id)) setSelection([id]);
  });

  // --- Duplo clique: edicao inline / abrir card ----------------------------
  stage.on('dblclick dbltap', (e) => {
    const node = e.target.findAncestor('.element', true) || e.target.getParent();
    const el = getElement(node?.id());
    if (!el) return;

    if (el.type === 'text' || el.type === 'sticky') startInlineEdit(el, node);
    else if (el.type === 'event') window.dispatchEvent(new CustomEvent('papyrus:focus-inspector'));
  });

  // --- Menu de contexto ----------------------------------------------------
  stage.on('contextmenu', async (e) => {
    e.evt.preventDefault();
    const node = e.target === stage ? null : e.target.findAncestor('.element', true);
    const { contextMenu } = await import('../ui/modal.js');

    if (node) {
      const id = node.id();
      if (!state.selection.includes(id)) setSelection([id]);
      contextMenu(e.evt.clientX, e.evt.clientY, [
        { label: 'Duplicar', onClick: () => duplicateSelection() },
        { label: 'Trazer para frente', onClick: () => reorderSelection('front') },
        { label: 'Enviar para trás', onClick: () => reorderSelection('back') },
        '-',
        { label: 'Excluir', danger: true, onClick: () => removeElements(state.selection) },
      ]);
    } else {
      const world = pointerWorld();
      contextMenu(e.evt.clientX, e.evt.clientY, [
        { label: 'Novo card de evento', onClick: () => addElements(createEventCard(world.x, world.y)) },
        { label: 'Nova nota adesiva', onClick: () => addElements(createSticky(world.x, world.y)) },
        { label: 'Novo texto', onClick: () => addElements(createText(world.x, world.y)) },
        '-',
        { label: 'Enquadrar conteúdo', onClick: () => fitToContent() },
      ]);
    }
  });

  // --- Preview do conector -------------------------------------------------
  stage.on('mousemove', () => {
    if (session.connectFrom) drawConnectorPreview();
  });
}

/* ========================================================================== */
/* Pan / zoom                                                                 */
/* ========================================================================== */

function startPan() {
  session.panning = true;
  const origin = { ...stage.getPointerPosition() };
  const start = stage.position();
  stage.container().style.cursor = 'grabbing';

  const move = () => {
    const p = stage.getPointerPosition();
    if (!p) return;
    stage.position({ x: start.x + (p.x - origin.x), y: start.y + (p.y - origin.y) });
    stage.batchDraw();
    paintGrid();
  };
  const up = () => {
    session.panning = false;
    stage.off('mousemove.pan touchmove.pan');
    window.removeEventListener('mouseup', up);
    window.removeEventListener('touchend', up);
    stage.container().style.cursor = cursorForTool(state.tool);
    persistViewport();
  };

  stage.on('mousemove.pan touchmove.pan', move);
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
}

function zoomAt(point, factor) {
  const oldScale = stage.scaleX();
  const newScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
  const p = point || { x: stage.width() / 2, y: stage.height() / 2 };

  const mousePoint = { x: (p.x - stage.x()) / oldScale, y: (p.y - stage.y()) / oldScale };
  stage.scale({ x: newScale, y: newScale });
  stage.position({ x: p.x - mousePoint.x * newScale, y: p.y - mousePoint.y * newScale });

  stage.batchDraw();
  paintGrid();
  persistViewport();
  emitZoom();
}

export function zoomBy(factor) {
  zoomAt(null, factor);
}

export function resetZoom() {
  zoomAt(null, 1 / stage.scaleX());
}

export function fitToContent() {
  const bounds = getContentBounds(getElements());
  if (!bounds) return resetZoom();

  const margin = 80;
  const scale = clamp(
    Math.min(
      (stage.width() - margin * 2) / bounds.width,
      (stage.height() - margin * 2) / bounds.height,
    ),
    MIN_SCALE,
    1.6,
  );

  stage.scale({ x: scale, y: scale });
  stage.position({
    x: stage.width() / 2 - (bounds.x + bounds.width / 2) * scale,
    y: stage.height() / 2 - (bounds.y + bounds.height / 2) * scale,
  });
  stage.batchDraw();
  paintGrid();
  persistViewport();
  emitZoom();
}

/** Centraliza a camera em um elemento (usado pelo painel de validacao). */
export function centerOn(id) {
  const el = getElement(id);
  if (!el) return;
  const b = getBounds(el);
  const scale = stage.scaleX();
  stage.position({
    x: stage.width() / 2 - (b.x + b.width / 2) * scale,
    y: stage.height() / 2 - (b.y + b.height / 2) * scale,
  });
  stage.batchDraw();
  paintGrid();
  setSelection([id]);
  persistViewport();
}

function persistViewport() {
  saveViewport({ x: stage.x(), y: stage.y(), scale: stage.scaleX() });
}

function emitZoom() {
  window.dispatchEvent(new CustomEvent('papyrus:zoom', { detail: stage.scaleX() }));
}

export const getStage = () => stage;
export const getZoom = () => stage?.scaleX() ?? 1;

/** Ponteiro do mouse convertido para coordenadas do mundo. */
function pointerWorld() {
  const p = stage.getPointerPosition() || { x: stage.width() / 2, y: stage.height() / 2 };
  return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
}

/** Centro da viewport em coordenadas do mundo (usado ao colar/criar via menu). */
export function viewportCenter() {
  return {
    x: (stage.width() / 2 - stage.x()) / stage.scaleX(),
    y: (stage.height() / 2 - stage.y()) / stage.scaleY(),
  };
}

/* ========================================================================== */
/* Criacao via ferramenta                                                     */
/* ========================================================================== */

function createFromTool(world) {
  const tool = state.tool;
  let element = null;

  switch (tool) {
    case 'event':
      element = createEventCard(world.x, world.y);
      break;
    case 'sticky':
      element = createSticky(world.x, world.y);
      break;
    case 'text':
      element = createText(world.x, world.y);
      break;
    case 'rect':
      element = createShape('rect', world.x, world.y);
      break;
    case 'ellipse':
      element = createShape('ellipse', world.x, world.y);
      break;
    case 'pin': {
      const next = getElements().filter((e) => e.type === 'pin').length + 1;
      element = createPin(world.x, world.y, next);
      break;
    }
    case 'image':
      document.getElementById('file-image').click();
      setTool('select');
      return;
    default:
      return;
  }

  addElements(element);
  setTool('select');
}

/* ========================================================================== */
/* Interacao por no                                                           */
/* ========================================================================== */

function wireNode(node, el) {
  if (el.type === 'connector') return;

  node.on('dragstart', () => {
    // Se o elemento nao estava selecionado, seleciona antes de arrastar.
    if (!state.selection.includes(el.id)) setSelection([el.id]);

    session.dragStart = new Map(
      state.selection
        .map((id) => [id, nodes.get(id)])
        .filter(([, n]) => n)
        .map(([id, n]) => [id, { x: n.x(), y: n.y() }]),
    );
  });

  node.on('dragmove', () => {
    const origin = session.dragStart?.get(el.id);
    if (origin) {
      const dx = node.x() - origin.x;
      const dy = node.y() - origin.y;
      // Arrasta os demais selecionados junto.
      for (const [id, start] of session.dragStart) {
        if (id === el.id) continue;
        nodes.get(id)?.position({ x: start.x + dx, y: start.y + dy });
      }
    }
    redrawConnectors();
  });

  node.on('dragend', () => {
    const moved = [...(session.dragStart?.keys() || [el.id])];
    commit((doc) => {
      for (const id of moved) {
        const target = doc.elements.find((e) => e.id === id);
        const n = nodes.get(id);
        if (target && n) {
          target.x = Math.round(n.x());
          target.y = Math.round(n.y());
        }
      }
    });
    session.dragStart = null;
  });

  // Abrir link do card do Jira/Trello com Ctrl+clique no texto.
  if (el.type === 'event' && el.data?.ticketUrl) {
    node.find('.ticket-link').forEach((t) => {
      t.on('click', (e) => {
        if (e.evt.ctrlKey || e.evt.metaKey) window.open(el.data.ticketUrl, '_blank', 'noopener');
      });
      t.on('mouseenter', () => (stage.container().style.cursor = 'pointer'));
      t.on('mouseleave', () => (stage.container().style.cursor = cursorForTool(state.tool)));
    });
  }
}

/* ========================================================================== */
/* Transformer (resize)                                                       */
/* ========================================================================== */

function bindTransformer() {
  transformer.on('transformend', () => {
    const updates = transformer.nodes().map((node) => {
      const el = getElement(node.id());
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();
      node.scale({ x: 1, y: 1 });

      const patch = { x: Math.round(node.x()), y: Math.round(node.y()) };
      if (el.width) patch.width = Math.max(60, Math.round(el.width * scaleX));
      if (el.height && !WIDTH_ONLY.has(el.type)) {
        patch.height = Math.max(30, Math.round(el.height * scaleY));
      }
      return { id: el.id, patch };
    });

    commit((doc) => {
      for (const { id, patch } of updates) {
        const target = doc.elements.find((e) => e.id === id);
        if (target) Object.assign(target, patch);
      }
    });
  });
}

function applySelectionVisuals() {
  if (!stage) return;

  const selected = state.selection.map((id) => getElement(id)).filter(Boolean);
  const selectableNodes = selected
    .filter((el) => el.type !== 'connector')
    .map((el) => nodes.get(el.id))
    .filter(Boolean);

  transformer.nodes(selectableNodes);

  const single = selected.length === 1 ? selected[0] : null;
  const resizable = single && (RESIZABLE.has(single.type) || WIDTH_ONLY.has(single.type));
  transformer.resizeEnabled(Boolean(resizable));
  transformer.enabledAnchors(
    !resizable
      ? []
      : WIDTH_ONLY.has(single.type)
        ? ['middle-left', 'middle-right']
        : ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right'],
  );

  // Conectores selecionados recebem destaque proprio.
  for (const [id, node] of nodes) {
    const el = getElement(id);
    if (el?.type !== 'connector') continue;
    const isSelected = state.selection.includes(id);
    node.findOne('.body')?.stroke(isSelected ? '#1A73E8' : el.stroke || '#5F6368');
    node.findOne('.body')?.fill(isSelected ? '#1A73E8' : el.stroke || '#5F6368');
  }

  overlay.batchDraw();
  layer.batchDraw();
}

/* ========================================================================== */
/* Marquee (selecao por arrasto)                                              */
/* ========================================================================== */

function startMarquee() {
  const origin = pointerWorld();
  marquee.setAttrs({ x: origin.x, y: origin.y, width: 0, height: 0, visible: true });
  overlay.batchDraw();

  const move = () => {
    const p = pointerWorld();
    marquee.setAttrs({
      x: Math.min(origin.x, p.x),
      y: Math.min(origin.y, p.y),
      width: Math.abs(p.x - origin.x),
      height: Math.abs(p.y - origin.y),
    });
    overlay.batchDraw();
  };

  const up = () => {
    stage.off('mousemove.marquee');
    window.removeEventListener('mouseup', up);

    const box = {
      x: marquee.x(), y: marquee.y(), width: marquee.width(), height: marquee.height(),
    };
    marquee.visible(false);
    overlay.batchDraw();

    if (box.width < 4 && box.height < 4) return;

    const hits = getElements()
      .filter((el) => el.type !== 'connector' && intersects(getBounds(el), box))
      .map((el) => el.id);

    setSelection([...new Set([...state.selection, ...hits])]);
  };

  stage.on('mousemove.marquee', move);
  window.addEventListener('mouseup', up);
}

/* ========================================================================== */
/* Conectores                                                                 */
/* ========================================================================== */

/** Recalcula as linhas dos conectores usando as posicoes VIVAS dos nos. */
function redrawConnectors() {
  const live = (el) => {
    const node = nodes.get(el.id);
    if (!node) return el;
    return { ...el, x: node.x(), y: node.y() };
  };

  for (const el of getElements()) {
    if (el.type !== 'connector') continue;
    const node = nodes.get(el.id);
    const from = getElement(el.from?.id);
    const to = getElement(el.to?.id);
    if (!node || !from || !to) continue;

    const route = routeConnector(live(from), live(to), el.from.anchor || 'auto', el.to.anchor || 'auto');
    const points = connectorPoints(route.start, route.end, route.fs, route.ts);
    node.findOne('.body')?.points(points);
    node.findOne('.hit')?.points(points);

    // O rótulo (quando existe) acompanha o ponto médio da curva.
    const labelNode = node.findOne('.connector-label');
    if (labelNode) {
      const mid = bezierMidpoint(points);
      const pos = { x: mid.x - labelNode.width() / 2, y: mid.y - labelNode.height() / 2 };
      labelNode.position(pos);
      node.findOne('.connector-label-bg')?.position(pos);
    }
  }
  layer.batchDraw();
}

function handleConnectorClick(id) {
  const el = getElement(id);
  if (!el || el.type === 'connector') return;

  if (!session.connectFrom) {
    session.connectFrom = id;
    toast.info('Agora clique no elemento de destino. Esc cancela.');
    return;
  }
  if (session.connectFrom === id) return cancelConnector();

  addElements(
    createConnector({ id: session.connectFrom, anchor: 'auto' }, { id, anchor: 'auto' }),
    { select: false },
  );
  cancelConnector();
  setTool('select');
}

function drawConnectorPreview() {
  const from = getElement(session.connectFrom);
  if (!from) return;

  const b = getBounds(from);
  const start = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const end = pointerWorld();

  if (!session.connectPreview) {
    session.connectPreview = new Konva.Arrow({
      stroke: '#1A73E8',
      fill: '#1A73E8',
      strokeWidth: 2,
      dash: [6, 4],
      pointerLength: 8,
      pointerWidth: 7,
    });
    overlay.add(session.connectPreview);
  }
  session.connectPreview.points([start.x, start.y, end.x, end.y]);
  overlay.batchDraw();
}

export function cancelConnector() {
  session.connectFrom = null;
  session.connectPreview?.destroy();
  session.connectPreview = null;
  overlay.batchDraw();
}

/* ========================================================================== */
/* Edicao inline de texto                                                     */
/* ========================================================================== */

function startInlineEdit(el, node) {
  const textNode = node.findOne('.label');
  if (!textNode) return;

  const containerRect = host.getBoundingClientRect();
  const abs = textNode.getAbsolutePosition();
  const scale = stage.scaleX();

  const area = document.createElement('textarea');
  area.value = el.text || '';
  Object.assign(area.style, {
    position: 'fixed',
    left: `${containerRect.left + abs.x}px`,
    top: `${containerRect.top + abs.y}px`,
    width: `${textNode.width() * scale}px`,
    minHeight: `${Math.max(textNode.height(), 24) * scale}px`,
    fontSize: `${(el.fontSize || 14) * scale}px`,
    fontFamily: el.type === 'text' ? "'Google Sans', Roboto, sans-serif" : 'Roboto, sans-serif',
    lineHeight: el.type === 'text' ? '1.35' : '1.4',
    color: el.fill || '#202124',
    background: el.type === 'sticky' ? el.fill : 'transparent',
    border: '1px solid #1A73E8',
    borderRadius: '4px',
    padding: '0',
    margin: '0',
    outline: 'none',
    resize: 'none',
    overflow: 'hidden',
    zIndex: '90',
  });

  document.body.appendChild(area);
  area.focus();
  area.select();
  textNode.visible(false);
  layer.batchDraw();

  session.editing = { el, area, textNode };

  area.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') cancelInlineEdit();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitInlineEdit();
  });
  area.addEventListener('blur', () => commitInlineEdit());
}

function commitInlineEdit() {
  if (!session.editing) return;
  const { el, area, textNode } = session.editing;
  const value = area.value;
  session.editing = null;

  area.remove();
  textNode.visible(true);

  if (value !== el.text) updateElement(el.id, { text: value });
  else layer.batchDraw();
}

function cancelInlineEdit() {
  if (!session.editing) return;
  const { area, textNode } = session.editing;
  session.editing = null;
  area.remove();
  textNode.visible(true);
  layer.batchDraw();
}

/* ========================================================================== */
/* Acoes expostas                                                             */
/* ========================================================================== */

export function duplicateSelection(offset = 24) {
  const selected = state.selection.map(getElement).filter(Boolean);
  if (!selected.length) return;

  const idMap = new Map();
  const copies = selected
    .filter((el) => el.type !== 'connector')
    .map((el) => {
      const copy = structuredClone(el);
      copy.id = uid(el.type);
      copy.x += offset;
      copy.y += offset;
      idMap.set(el.id, copy.id);
      return copy;
    });

  // Conectores internos a selecao sao duplicados junto, religados as copias.
  for (const el of selected) {
    if (el.type !== 'connector') continue;
    if (!idMap.has(el.from?.id) || !idMap.has(el.to?.id)) continue;
    const copy = structuredClone(el);
    copy.id = uid('cnn');
    copy.from = { ...copy.from, id: idMap.get(el.from.id) };
    copy.to = { ...copy.to, id: idMap.get(el.to.id) };
    copies.push(copy);
  }

  addElements(copies);
}

export function reorderSelection(direction) {
  if (!state.selection.length) return;
  const set = new Set(state.selection);
  commit((doc) => {
    const moving = doc.elements.filter((el) => set.has(el.id));
    const rest = doc.elements.filter((el) => !set.has(el.id));
    doc.elements = direction === 'front' ? [...rest, ...moving] : [...moving, ...rest];
  });
}

export function selectAll() {
  setSelection(getElements().filter((el) => el.type !== 'connector').map((el) => el.id));
}

/** Move a selecao com as setas do teclado. */
export function nudgeSelection(dx, dy) {
  if (!state.selection.length) return;
  const set = new Set(state.selection);
  commit((doc) => {
    for (const el of doc.elements) {
      if (!set.has(el.id) || el.type === 'connector') continue;
      el.x += dx;
      el.y += dy;
    }
  });
}

/* ========================================================================== */
/* Exportacao PNG                                                             */
/* ========================================================================== */

/**
 * Exporta o conteudo do canvas em alta resolucao.
 *
 * Tres cuidados:
 *  1. A camada de overlay (transformer, marquee) e ocultada para nao vazar.
 *  2. O fundo e desenhado como um retangulo real — o `toDataURL` do Konva nao
 *     aceita cor de fundo, entao sem isso o PNG sairia sempre transparente.
 *  3. O palco e REDIMENSIONADO temporariamente para cobrir toda a area de
 *     exportacao. Os canvases das camadas do Konva tem o tamanho da viewport
 *     visivel; sem esse passo, qualquer conteudo fora da janela sairia cortado.
 */
export function exportPNG({
  pixelRatio = 3,
  padding = 60,
  background = '#FFFFFF',
  mimeType = 'image/png',
  quality = 0.92,
  onlySelection = false,
} = {}) {
  const partial = onlySelection && state.selection.length > 0;
  const source = partial
    ? getElements().filter((el) => state.selection.includes(el.id))
    : getElements();
  const bounds = getContentBounds(source);
  if (!bounds) {
    toast.error('Nada para exportar nesta página.');
    return null;
  }

  // No modo "apenas seleção", esconde o que ficou de fora — o recorte de área
  // sozinho não impediria elementos vizinhos de vazarem para dentro da imagem.
  const hiddenNodes = [];
  if (partial) {
    const keep = new Set(state.selection);
    for (const [id, node] of nodes) {
      const el = getElement(id);
      if (!el || !node.visible()) continue;
      const included =
        el.type === 'connector'
          ? keep.has(id) || (keep.has(el.from?.id) && keep.has(el.to?.id))
          : keep.has(id);
      if (!included) {
        node.visible(false);
        hiddenNodes.push(node);
      }
    }
  }

  const area = {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: Math.ceil(bounds.width + padding * 2),
    height: Math.ceil(bounds.height + padding * 2),
  };

  // Navegadores limitam a dimensao de um canvas (~16k px por lado).
  // Reduz o fator de escala automaticamente para nunca gerar um arquivo corrompido.
  const MAX_SIDE = 16000;
  let ratio = pixelRatio;
  const maxDim = Math.max(area.width, area.height);
  if (maxDim * ratio > MAX_SIDE) {
    ratio = Math.max(0.5, Math.round((MAX_SIDE / maxDim) * 100) / 100);
    toast.info(`Resolução ajustada para ${ratio}× — o mapa é grande demais para a escala pedida.`);
  }

  const prev = {
    scale: stage.scaleX(),
    pos: stage.position(),
    width: stage.width(),
    height: stage.height(),
  };
  overlay.visible(false);
  stage.scale({ x: 1, y: 1 });
  stage.size({ width: area.width, height: area.height });
  stage.position({ x: -area.x, y: -area.y });

  let bgLayer = null;
  if (background) {
    bgLayer = new Konva.Layer({ listening: false });
    bgLayer.add(new Konva.Rect({ ...area, fill: background }));
    stage.add(bgLayer);
    bgLayer.moveToBottom();
  }
  stage.batchDraw();

  let dataUrl = null;
  try {
    dataUrl = stage.toDataURL({
      x: 0,
      y: 0,
      width: area.width,
      height: area.height,
      pixelRatio: ratio,
      mimeType,
      quality,
    });
  } catch (err) {
    toast.error(`Falha ao gerar a imagem: ${err.message}`);
  } finally {
    bgLayer?.destroy();
    hiddenNodes.forEach((node) => node.visible(true));
    stage.size({ width: prev.width, height: prev.height });
    stage.scale({ x: prev.scale, y: prev.scale });
    stage.position(prev.pos);
    overlay.visible(true);
    stage.batchDraw();
    paintGrid();
  }

  return dataUrl;
}

/* ========================================================================== */
/* Teclado global do canvas                                                   */
/* ========================================================================== */

function bindWindowEvents() {
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !isTyping(e)) {
      session.spaceDown = true;
      stage.container().style.cursor = 'grab';
    }
    if (e.key === 'Escape') cancelConnector();
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      session.spaceDown = false;
      stage.container().style.cursor = cursorForTool(state.tool);
    }
  });
}

export function isTyping(e) {
  const t = e?.target;
  return Boolean(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
}

export { nodes, sizeCache, DEFAULTS };
