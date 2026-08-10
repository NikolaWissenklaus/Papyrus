/**
 * canvas/geometry.js
 * ---------------------------------------------------------------------------
 * Calculos espaciais compartilhados: caixas delimitadoras, ancoras magneticas
 * e roteamento dos conectores.
 *
 * `sizeCache` guarda a altura real medida em tempo de render (cards de evento e
 * textos tem altura dinamica). Assim os conectores encostam na borda correta
 * sem precisar duplicar a matematica de layout.
 */

import { DEFAULTS } from '../constants.js';

/** @type {Map<string, {width:number, height:number}>} */
export const sizeCache = new Map();

export function cacheSize(id, width, height) {
  sizeCache.set(id, { width, height });
}

/** Caixa delimitadora de um elemento, em coordenadas do mundo. */
export function getBounds(el) {
  if (!el) return { x: 0, y: 0, width: 0, height: 0 };

  if (el.type === 'pin') {
    const r = DEFAULTS.pinRadius;
    return { x: el.x - r, y: el.y - r, width: r * 2, height: r * 2 };
  }

  const cached = sizeCache.get(el.id);
  return {
    x: el.x,
    y: el.y,
    width: el.width ?? cached?.width ?? 200,
    height: el.height ?? cached?.height ?? 120,
  };
}

/** Centro geometrico do elemento. */
export function getCenter(el) {
  const b = getBounds(el);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Os quatro pontos de encaixe magnetico de um elemento. */
export function getAnchors(el) {
  const b = getBounds(el);
  return {
    top: { x: b.x + b.width / 2, y: b.y },
    right: { x: b.x + b.width, y: b.y + b.height / 2 },
    bottom: { x: b.x + b.width / 2, y: b.y + b.height },
    left: { x: b.x, y: b.y + b.height / 2 },
    center: { x: b.x + b.width / 2, y: b.y + b.height / 2 },
  };
}

/**
 * Escolhe automaticamente o par de ancoras mais curto entre dois elementos.
 * E o que da a sensacao de "conector magnetico": a seta sempre sai e chega
 * pelo lado mais natural, mesmo depois de arrastar os cards.
 */
export function routeConnector(fromEl, toEl, fromAnchor = 'auto', toAnchor = 'auto') {
  const a = getAnchors(fromEl);
  const b = getAnchors(toEl);

  const sides = ['top', 'right', 'bottom', 'left'];
  const fromOptions = fromAnchor === 'auto' ? sides : [fromAnchor];
  const toOptions = toAnchor === 'auto' ? sides : [toAnchor];

  let best = null;
  for (const fs of fromOptions) {
    for (const ts of toOptions) {
      const p = a[fs];
      const q = b[ts];
      const dist = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (!best || dist < best.dist) best = { dist, start: p, end: q, fs, ts };
    }
  }
  return best;
}

/** Vetor normal (para fora) de cada lado de um elemento. */
const SIDE_NORMALS = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/**
 * Gera os pontos de uma curva Bézier cúbica entre duas âncoras.
 * Os pontos de controle saem PERPENDICULARES ao lado ancorado — é o que dá a
 * curva elegante estilo Figma: a linha "nasce" da borda do card e faz um S
 * suave até o destino, em vez de cortar o elemento na diagonal.
 *
 * @returns {number[]} [x0,y0, cx1,cy1, cx2,cy2, x1,y1] (usar com bezier: true)
 */
export function connectorPoints(start, end, fromSide, toSide) {
  const dist = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const reach = Math.min(120, Math.max(24, dist * 0.42));

  // Sem lado definido, o controle aponta na direção do outro extremo.
  const fallback = (a, b) => ({ x: (b.x - a.x) / dist, y: (b.y - a.y) / dist });
  const n1 = SIDE_NORMALS[fromSide] || fallback(start, end);
  const n2 = SIDE_NORMALS[toSide] || fallback(end, start);

  return [
    start.x, start.y,
    start.x + n1.x * reach, start.y + n1.y * reach,
    end.x + n2.x * reach, end.y + n2.y * reach,
    end.x, end.y,
  ];
}

/** Ponto médio (t = 0.5) de uma Bézier cúbica — posiciona o rótulo do conector. */
export function bezierMidpoint(points) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = points;
  return {
    x: (x0 + 3 * x1 + 3 * x2 + x3) / 8,
    y: (y0 + 3 * y1 + 3 * y2 + y3) / 8,
  };
}

/** Caixa que engloba todos os elementos — usada pelo "Fit" e pela exportacao PNG. */
export function getContentBounds(elements) {
  const boxes = elements
    .filter((el) => el.type !== 'connector')
    .map(getBounds)
    .filter((b) => b.width > 0 && b.height > 0);

  if (!boxes.length) return null;

  const minX = Math.min(...boxes.map((b) => b.x));
  const minY = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Testa interseccao entre duas caixas (selecao por arrasto). */
export function intersects(a, b) {
  return !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);
}

/** Distancia entre dois pontos. */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
