/**
 * models.js
 * ---------------------------------------------------------------------------
 * Fabricas dos elementos do canvas. Um unico lugar define a forma de cada
 * elemento persistido no JSON — o renderer e o inspetor apenas consomem.
 *
 * Formato comum:
 *   { id, type, x, y, ... }               // geometria vive na raiz
 *   { ..., data: {...} }                  // regra de negocio (apenas em `event`)
 */

import { uid } from './util.js';
import { DEFAULTS, GA4_ITEM_PARAMS, STICKY_COLORS } from './constants.js';

/** Parametro individual da tabela de um card. */
export function createParam(overrides = {}) {
  return {
    id: uid('p'),
    name: '',
    type: 'string',
    required: false,
    example: '',
    description: '',
    ...overrides,
  };
}

/** Card de Evento — o coracao da ferramenta. */
export function createEventCard(x, y, overrides = {}) {
  return {
    id: uid('evt'),
    type: 'event',
    x,
    y,
    width: DEFAULTS.eventCardWidth,
    collapsed: false,
    data: {
      name: 'novo_evento',
      eventType: 'interaction',
      platform: ['web'],
      trigger: '',
      squad: '',
      owner: '',
      notes: '',
      ticketName: '',
      ticketId: '',
      ticketUrl: '',
      eventParams: [createParam()],
      userParams: [],
      itemParams: [],
      /** IDs dos grupos de parametros importados — usado para evitar duplicatas. */
      linkedGroups: [],
    },
    ...overrides,
  };
}

/** Injeta o bloco padrao de `items` do GA4 (chamado ao virar tipo Ecommerce). */
export function defaultItemParams() {
  return GA4_ITEM_PARAMS.map((p) => createParam(p));
}

/** Retangulo / elipse. */
export function createShape(kind, x, y) {
  return {
    id: uid(kind),
    type: kind, // 'rect' | 'ellipse'
    x,
    y,
    width: DEFAULTS.shapeSize.width,
    height: DEFAULTS.shapeSize.height,
    fill: 'transparent',
    stroke: '#5F6368',
    strokeWidth: 2,
    cornerRadius: kind === 'rect' ? 12 : 0,
    opacity: 1,
    label: '',
  };
}

/** Nota adesiva. */
export function createSticky(x, y) {
  return {
    id: uid('note'),
    type: 'sticky',
    x,
    y,
    width: DEFAULTS.stickySize,
    height: DEFAULTS.stickySize,
    fill: STICKY_COLORS[0],
    text: 'Nota',
    fontSize: 14,
  };
}

/** Caixa de texto livre. */
export function createText(x, y) {
  return {
    id: uid('txt'),
    type: 'text',
    x,
    y,
    width: DEFAULTS.textWidth,
    text: 'Texto',
    fontSize: 18,
    fontStyle: 'normal',
    fill: '#202124',
    align: 'left',
  };
}

/** Imagem (print de tela de referencia). */
export function createImage(x, y, { url, width, height }) {
  return {
    id: uid('img'),
    type: 'image',
    x,
    y,
    width,
    height,
    url,
    opacity: 1,
    cornerRadius: 8,
  };
}

/** Pin numerado que referencia um ponto especifico de uma imagem. */
export function createPin(x, y, label) {
  return {
    id: uid('pin'),
    type: 'pin',
    x,
    y,
    label: String(label ?? 1),
    color: '#EA4335',
    note: '',
  };
}

/**
 * Conector magnetico entre dois elementos.
 * `from`/`to` guardam { id, anchor } — a posicao real e recalculada no render,
 * garantindo que a seta acompanhe o elemento quando ele e movido ou redimensionado.
 */
export function createConnector(from, to) {
  return {
    id: uid('cnn'),
    type: 'connector',
    from,
    to,
    stroke: '#5F6368',
    strokeWidth: 2,
    dash: false,
    arrow: true,
    label: '',
  };
}
