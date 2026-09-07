/*
 * Traduz um elemento do documento em um no do Konva.
 *
 * Aqui e so a parte visual: o modulo nao sabe o que e selecao, ferramenta ou
 * store. Ele recebe o elemento e devolve um Konva.Group com `id(el.id)`. Quem
 * cuida da interacao e o stage.
 */

import { EVENT_TYPE_MAP, DEFAULTS } from '../constants.js';
import { truncate } from '../util.js';
import { cacheSize, routeConnector, connectorPoints, bezierMidpoint, getBounds } from './geometry.js';

const FONT_BODY = "Roboto, 'Helvetica Neue', Arial, sans-serif";
const FONT_DISPLAY = "'Google Sans', 'Product Sans', Roboto, 'Helvetica Neue', Arial, sans-serif";
const FONT_MONO = "'Roboto Mono', Consolas, monospace";

/** Cache das imagens ja carregadas, para nao recarregar a cada re-render. */
const imageCache = new Map();

/* Card de Evento */

/*
 * O card e desenhado com um cursor vertical (`y`) que avanca a cada bloco
 * adicionado. No fim a altura real vai para o `sizeCache`, e e assim que o
 * conector consegue encostar exatamente na borda de baixo.
 */
function buildEventCard(el) {
  const PAD = 16;
  const W = el.width || DEFAULTS.eventCardWidth;
  const d = el.data || {};
  const type = EVENT_TYPE_MAP[d.eventType] || EVENT_TYPE_MAP.interaction;

  const group = new Konva.Group({ id: el.id, x: el.x, y: el.y, name: 'element event-card' });

  // Fundo, com a altura ajustada no final. O bg e o unico shape do card que
  // escuta eventos: o conteudo interno e decorativo, e desenhar hit-canvas para
  // cada texto seria desperdicio. Em mapa grande, e o que mais pesa.
  const bg = new Konva.Rect({
    width: W,
    height: 100,
    fill: '#FFFFFF',
    cornerRadius: 14,
    shadowColor: '#3C4043',
    shadowBlur: 16,
    shadowOpacity: 0.08,
    shadowOffsetY: 4,
    stroke: '#E8EAED',
    strokeWidth: 1,
    perfectDrawEnabled: false,
    shadowForStrokeEnabled: false,
  });
  group.add(bg);

  // Cabecalho do tipo: filete de acento na cor plena e faixa suave com o rotulo
  // na variante escura. Da para ler o tipo de longe sem poluir o mapa.
  const HEAD = 26;
  group.add(
    new Konva.Rect({
      width: W, height: 4, fill: type.color, cornerRadius: [14, 14, 0, 0],
      listening: false, perfectDrawEnabled: false,
    }),
  );
  group.add(
    new Konva.Rect({
      y: 4, width: W, height: HEAD - 4, fill: type.soft,
      listening: false, perfectDrawEnabled: false,
    }),
  );
  group.add(
    new Konva.Circle({
      x: PAD + 3, y: 4 + (HEAD - 4) / 2, radius: 3, fill: type.color,
      listening: false, perfectDrawEnabled: false,
    }),
  );
  group.add(
    new Konva.Text({
      x: PAD + 12,
      y: 4 + 6,
      width: W - PAD * 2 - 12,
      text: type.label.toUpperCase(),
      fontSize: 10,
      fontFamily: FONT_DISPLAY,
      fontStyle: '700',
      letterSpacing: 1,
      fill: type.text || type.color,
      listening: false,
    }),
  );

  let y = HEAD + 14;

  // Nome do evento
  group.add(
    new Konva.Text({
      x: PAD,
      y,
      width: W - PAD * 2,
      text: d.name || 'sem_nome',
      fontSize: 16,
      fontFamily: FONT_MONO,
      fontStyle: '500',
      fill: '#202124',
      wrap: 'none',
      ellipsis: true,
      listening: false,
    }),
  );
  y += 24;

  // Plataformas
  const platforms = (d.platform || []).map((p) => p.toUpperCase()).join(' · ') || 'SEM PLATAFORMA';
  group.add(
    new Konva.Text({
      x: PAD,
      y,
      width: W - PAD * 2,
      text: platforms,
      fontSize: 10,
      fontFamily: FONT_BODY,
      letterSpacing: 0.6,
      fill: '#9AA0A6',
      listening: false,
    }),
  );
  y += 18;

  if (el.collapsed) {
    y += 2;
    const total =
      (d.eventParams?.length || 0) + (d.userParams?.length || 0) + (d.itemParams?.length || 0);
    group.add(divider(PAD, y, W));
    y += 10;
    group.add(
      label(PAD, y, `${total} PARÂMETRO${total === 1 ? '' : 'S'} · RECOLHIDO`, W - PAD * 2),
    );
    y += 18;
    return finish(group, bg, el, W, y + 4);
  }

  y += 4;
  group.add(divider(PAD, y, W));
  y += 12;

  // Gatilho
  group.add(label(PAD, y, 'GATILHO', W - PAD * 2));
  y += 13;
  group.add(value(PAD, y, d.trigger || '—', W - PAD * 2));
  y += 20;

  // Governanca
  const gov = [d.squad, d.owner].filter(Boolean).join('  ·  ') || '—';
  group.add(label(PAD, y, 'SQUAD / RESPONSÁVEL', W - PAD * 2));
  y += 13;
  group.add(value(PAD, y, gov, W - PAD * 2));
  y += 20;

  // Ticket (Jira/Trello)
  if (d.ticketName || d.ticketId) {
    group.add(label(PAD, y, 'CARD', W - PAD * 2));
    y += 13;
    group.add(
      new Konva.Text({
        x: PAD,
        y,
        width: W - PAD * 2,
        text: [d.ticketId, d.ticketName].filter(Boolean).join(' · '),
        fontSize: 12,
        fontFamily: FONT_BODY,
        fill: d.ticketUrl ? '#1A73E8' : '#202124',
        textDecoration: d.ticketUrl ? 'underline' : '',
        wrap: 'none',
        ellipsis: true,
        name: 'ticket-link',
      }),
    );
    y += 20;
  }

  // Tabela de parametros
  y += 2;
  group.add(divider(PAD, y, W));
  y += 12;

  y = paramBlock(group, PAD, y, W, 'PARÂMETROS DE EVENTO', d.eventParams);
  if (d.userParams?.length) {
    y = paramBlock(group, PAD, y, W, 'PROPRIEDADES DE USUÁRIO', d.userParams);
  }
  if (d.eventType === 'ecommerce' && d.itemParams?.length) {
    y = paramBlock(group, PAD, y, W, 'ITEMS[]', d.itemParams);
  }

  return finish(group, bg, el, W, y + 6);
}

/** Bloco "titulo + linhas de parametros" dentro do card. */
function paramBlock(group, PAD, y, W, title, params = []) {
  group.add(label(PAD, y, `${title} (${params.length})`, W - PAD * 2));
  y += 15;

  const visible = params.slice(0, DEFAULTS.maxPreviewParams);

  for (const p of visible) {
    // Marcador de obrigatoriedade
    group.add(
      new Konva.Circle({
        x: PAD + 3,
        y: y + 6,
        radius: 3,
        fill: p.required ? '#D93025' : '#DADCE0',
        listening: false,
        perfectDrawEnabled: false,
      }),
    );
    group.add(
      new Konva.Text({
        x: PAD + 12,
        y,
        width: W - PAD * 2 - 12 - 56,
        text: p.name || '(sem nome)',
        fontSize: 11.5,
        fontFamily: FONT_MONO,
        fill: p.name ? '#202124' : '#BDC1C6',
        wrap: 'none',
        ellipsis: true,
        listening: false,
      }),
    );
    group.add(
      new Konva.Text({
        x: W - PAD - 56,
        y,
        width: 56,
        align: 'right',
        text: p.type || 'string',
        fontSize: 10,
        fontFamily: FONT_BODY,
        fill: '#9AA0A6',
        listening: false,
      }),
    );
    y += 17;
  }

  if (params.length > visible.length) {
    group.add(
      new Konva.Text({
        x: PAD + 12,
        y,
        text: `+${params.length - visible.length} parâmetro(s)`,
        fontSize: 10.5,
        fontFamily: FONT_BODY,
        fontStyle: 'italic',
        fill: '#9AA0A6',
        listening: false,
      }),
    );
    y += 17;
  }
  if (!params.length) {
    group.add(
      new Konva.Text({
        x: PAD + 12,
        y,
        text: 'nenhum parâmetro',
        fontSize: 10.5,
        fontFamily: FONT_BODY,
        fontStyle: 'italic',
        fill: '#BDC1C6',
        listening: false,
      }),
    );
    y += 17;
  }

  return y + 8;
}

const label = (x, y, text, width) =>
  new Konva.Text({
    x, y, width, text,
    fontSize: 9,
    fontFamily: FONT_DISPLAY,
    fontStyle: '700',
    letterSpacing: 0.8,
    fill: '#9AA0A6',
    wrap: 'none',
    ellipsis: true,
    listening: false,
  });

const value = (x, y, text, width) =>
  new Konva.Text({
    x, y, width, text,
    fontSize: 12.5,
    fontFamily: FONT_BODY,
    fill: '#202124',
    wrap: 'none',
    ellipsis: true,
    listening: false,
  });

const divider = (PAD, y, W) =>
  new Konva.Line({
    points: [PAD, y, W - PAD, y],
    stroke: '#F1F3F4',
    strokeWidth: 1,
    listening: false,
    perfectDrawEnabled: false,
  });

function finish(group, bg, el, width, height) {
  bg.height(height);
  cacheSize(el.id, width, height);
  return group;
}

/* Demais elementos */

function buildRect(el) {
  const group = new Konva.Group({ id: el.id, x: el.x, y: el.y, name: 'element shape' });
  group.add(
    new Konva.Rect({
      width: el.width,
      height: el.height,
      fill: el.fill === 'transparent' ? undefined : el.fill,
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      cornerRadius: el.cornerRadius ?? 0,
      opacity: el.opacity ?? 1,
      perfectDrawEnabled: false,
      name: 'body',
    }),
  );
  if (el.label) group.add(shapeLabel(el));
  cacheSize(el.id, el.width, el.height);
  return group;
}

function buildEllipse(el) {
  const group = new Konva.Group({ id: el.id, x: el.x, y: el.y, name: 'element shape' });
  group.add(
    new Konva.Ellipse({
      x: el.width / 2,
      y: el.height / 2,
      radiusX: el.width / 2,
      radiusY: el.height / 2,
      fill: el.fill === 'transparent' ? undefined : el.fill,
      stroke: el.stroke,
      strokeWidth: el.strokeWidth,
      opacity: el.opacity ?? 1,
      perfectDrawEnabled: false,
      name: 'body',
    }),
  );
  if (el.label) group.add(shapeLabel(el));
  cacheSize(el.id, el.width, el.height);
  return group;
}

const shapeLabel = (el) =>
  new Konva.Text({
    x: 8,
    y: el.height / 2 - 10,
    width: el.width - 16,
    align: 'center',
    text: el.label,
    fontSize: 13,
    fontFamily: FONT_BODY,
    fill: el.fill === '#202124' || el.fill === '#231F20' ? '#FFFFFF' : '#202124',
    listening: false,
  });

function buildSticky(el) {
  const group = new Konva.Group({ id: el.id, x: el.x, y: el.y, name: 'element sticky' });
  group.add(
    new Konva.Rect({
      width: el.width,
      height: el.height,
      fill: el.fill,
      cornerRadius: 6,
      shadowColor: '#3C4043',
      shadowBlur: 12,
      shadowOpacity: 0.1,
      shadowOffsetY: 3,
      perfectDrawEnabled: false,
      name: 'body',
    }),
  );
  group.add(
    new Konva.Text({
      x: 14,
      y: 14,
      width: el.width - 28,
      height: el.height - 28,
      text: el.text,
      fontSize: el.fontSize || 14,
      fontFamily: FONT_BODY,
      lineHeight: 1.4,
      fill: '#202124',
      listening: false,
      name: 'label',
    }),
  );
  cacheSize(el.id, el.width, el.height);
  return group;
}

function buildText(el) {
  const group = new Konva.Group({ id: el.id, x: el.x, y: el.y, name: 'element text' });
  const text = new Konva.Text({
    width: el.width,
    text: el.text,
    fontSize: el.fontSize || 18,
    fontFamily: FONT_DISPLAY,
    fontStyle: el.fontStyle || 'normal',
    fill: el.fill || '#202124',
    align: el.align || 'left',
    lineHeight: 1.35,
    name: 'label',
  });
  group.add(text);
  cacheSize(el.id, el.width, text.height());
  return group;
}

function buildImage(el, ctx) {
  const group = new Konva.Group({ id: el.id, x: el.x, y: el.y, name: 'element image' });
  const cached = imageCache.get(el.url);

  if (cached) {
    group.add(
      new Konva.Image({
        image: cached,
        width: el.width,
        height: el.height,
        opacity: el.opacity ?? 1,
        cornerRadius: el.cornerRadius ?? 0,
        perfectDrawEnabled: false,
        name: 'body',
      }),
    );
  } else {
    // Placeholder enquanto carrega, para o layout nao pular.
    group.add(
      new Konva.Rect({
        width: el.width,
        height: el.height,
        fill: '#F1F3F4',
        stroke: '#DADCE0',
        dash: [6, 4],
        cornerRadius: 8,
        perfectDrawEnabled: false,
        name: 'body',
      }),
    );
    const img = new Image();
    img.onload = () => {
      imageCache.set(el.url, img);
      ctx?.requestRender?.();
    };
    img.src = el.url;
  }

  cacheSize(el.id, el.width, el.height);
  return group;
}

function buildPin(el) {
  const r = DEFAULTS.pinRadius;
  const group = new Konva.Group({ id: el.id, x: el.x, y: el.y, name: 'element pin' });
  group.add(
    new Konva.Circle({
      radius: r,
      fill: el.color || '#EA4335',
      stroke: '#FFFFFF',
      strokeWidth: 2.5,
      shadowColor: '#3C4043',
      shadowBlur: 8,
      shadowOpacity: 0.22,
      perfectDrawEnabled: false,
      shadowForStrokeEnabled: false,
      name: 'body',
    }),
  );
  group.add(
    new Konva.Text({
      x: -r,
      y: -6,
      width: r * 2,
      align: 'center',
      text: truncate(el.label ?? '', 3),
      fontSize: 12,
      fontFamily: FONT_DISPLAY,
      fontStyle: '700',
      fill: '#FFFFFF',
      listening: false,
    }),
  );
  cacheSize(el.id, r * 2, r * 2);
  return group;
}

/**
 * Conector: Bezier cubica com ponta de seta. Os pontos de controle saem
 * perpendiculares ao lado ancorado (ver geometry.js), o que da a curvatura em S
 * e faz a linha acompanhar os elementos quando eles sao movidos.
 */
function buildConnector(el, ctx) {
  const fromEl = ctx.findElement(el.from?.id);
  const toEl = ctx.findElement(el.to?.id);
  if (!fromEl || !toEl) return null;

  const route = routeConnector(fromEl, toEl, el.from.anchor || 'auto', el.to.anchor || 'auto');
  const points = connectorPoints(route.start, route.end, route.fs, route.ts);

  const group = new Konva.Group({ id: el.id, name: 'element connector', listening: true });

  // Uma linha fantasma mais grossa deixa o conector facil de clicar. E o unico
  // shape do grupo que escuta eventos; a seta visivel nao precisa de hit.
  group.add(
    new Konva.Line({
      points, stroke: 'transparent', strokeWidth: 14, bezier: true,
      perfectDrawEnabled: false, name: 'hit',
    }),
  );
  group.add(
    new Konva.Arrow({
      points,
      stroke: el.stroke || '#5F6368',
      strokeWidth: el.strokeWidth || 2,
      fill: el.stroke || '#5F6368',
      dash: el.dash ? [7, 5] : undefined,
      bezier: true,
      pointerLength: el.arrow === false ? 0 : 9,
      pointerWidth: el.arrow === false ? 0 : 8,
      lineCap: 'round',
      listening: false,
      perfectDrawEnabled: false,
      name: 'body',
    }),
  );

  if (el.label) {
    const mid = bezierMidpoint(points);
    const text = new Konva.Text({
      text: el.label,
      fontSize: 11,
      fontFamily: FONT_BODY,
      fill: '#5F6368',
      padding: 4,
      listening: false,
      name: 'connector-label',
    });
    text.position({ x: mid.x - text.width() / 2, y: mid.y - text.height() / 2 });
    group.add(
      new Konva.Rect({
        x: text.x(),
        y: text.y(),
        width: text.width(),
        height: text.height(),
        fill: '#F8F9FA',
        cornerRadius: 6,
        listening: false,
        perfectDrawEnabled: false,
        name: 'connector-label-bg',
      }),
    );
    group.add(text);
  }

  return group;
}

/* Dispatcher */

const BUILDERS = {
  event: buildEventCard,
  rect: buildRect,
  ellipse: buildEllipse,
  sticky: buildSticky,
  text: buildText,
  image: buildImage,
  pin: buildPin,
  connector: buildConnector,
};

/**
 * @param {object} el elemento do documento
 * @param {{ findElement: (id:string)=>object, requestRender: ()=>void }} ctx
 * @returns {Konva.Group|null}
 */
export function buildNode(el, ctx) {
  const builder = BUILDERS[el.type];
  if (!builder) return null;

  const node = builder(el, ctx);
  if (!node) return null;

  // Conector nunca e arrastado direto: ele segue os elementos ancorados.
  node.draggable(el.type !== 'connector');
  return node;
}

/** Pre-carrega uma imagem no cache (usado ao colar). */
export function primeImage(url, img) {
  imageCache.set(url, img);
}

export { imageCache, getBounds };
