/*
 * Fabricas dos elementos do canvas.
 *
 * A forma de cada elemento que vai para o JSON nasce aqui, e so aqui. O
 * renderer e o inspetor sao consumidores: se um campo novo precisa existir,
 * ele comeca neste arquivo.
 *
 * Geometria (id, type, x, y, width...) fica na raiz do objeto. Regra de
 * negocio fica em `data`, e so o card de evento tem `data`.
 */

import { uid } from './util.js';
import { state } from './store.js';
import { DEFAULTS, GA4_ITEM_PARAMS, STICKY_COLORS } from './constants.js';

/*
 * Parametro que identifica o evento. O Papyrus preenche na criacao e em toda
 * copia de card, mas o campo fica editavel: o valor gerado e um ponto de
 * partida, e o id pode vir de outro sistema. O que nao pode e repetir, e disso
 * cuida o validador.
 */
export const EVENT_ID_PARAM = 'event_id';

/** True na linha do event_id de um card. */
export function isEventIdParam(scope, param) {
  return scope === 'eventParams' && param?.name === EVENT_ID_PARAM;
}

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

/** Nome da pasta onde a pagina aberta esta gravada. Vazio se ela esta na raiz. */
function currentFolderName() {
  const parts = String(state.currentPath || '').split('/');
  return parts.length > 1 ? parts[parts.length - 2] : '';
}

const EVENT_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/*
 * Monta o `event_id` em tres partes separadas por hifen:
 *
 *   d + codigos ASCII do nome da pasta da pagina
 *   p + timestamp atual em segundos
 *   6 + sufixo aleatorio de 6 caracteres
 *
 * Os codigos ASCII vao com zero a esquerda, sempre 3 digitos. Sem esse padding
 * "AB" (65, 66) e "6566" dariam a mesma string e o prefixo pararia de
 * identificar a pasta. Quando a pagina esta na raiz do workspace, a pasta
 * considerada e a propria `papyrus`.
 */
export function generateEventId(folderName = currentFolderName()) {
  // NFD separa o acento da letra. O filtro logo abaixo joga fora o acento
  // solto e tudo o que estiver fora da faixa ASCII imprimivel.
  const ascii = [
    ...String(folderName || 'papyrus')
      .normalize('NFD')
      .replace(/[^\x20-\x7E]/g, ''),
  ]
    .map((char) => String(char.charCodeAt(0)).padStart(3, '0'))
    .join('');

  const random = Array.from(
    { length: 6 },
    () => EVENT_ID_ALPHABET[Math.floor(Math.random() * EVENT_ID_ALPHABET.length)],
  ).join('');

  return `d${ascii}-p${Math.floor(Date.now() / 1000)}-6${random}`;
}

/** Card de Evento, o elemento central da ferramenta. */
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
      // O event_id ja vem preenchido. E a chave que amarra o planejamento ao
      // dado coletado, entao nao da para depender de alguem lembrar de criar.
      eventParams: [
        createParam({ name: EVENT_ID_PARAM, type: 'string', required: true, example: generateEventId() }),
      ],
      userParams: [],
      itemParams: [],
      /** IDs dos grupos ja importados, para nao importar o mesmo duas vezes. */
      linkedGroups: [],
    },
    ...overrides,
  };
}

/*
 * Da um `event_id` novo a cada card de evento da lista.
 *
 * Copia de card e copia de tudo, menos da chave que identifica a coleta: dois
 * cards com o mesmo event_id apontariam para o mesmo evento no GA4. Vale para
 * colar, duplicar no canvas e duplicar a pagina inteira.
 *
 * `folderName` fica de fora quando o destino e a pagina aberta; a duplicacao de
 * pagina passa a pasta de destino, que nem sempre e a da pagina aberta.
 *
 * O Set evita repeticao dentro do proprio lote: o sufixo aleatorio ja torna a
 * colisao improvavel, mas duplicar dez cards de uma vez cai todo no mesmo
 * segundo, e ai o sorteio e a unica coisa separando um id do outro.
 */
export function renewEventIds(elements, folderName) {
  const used = new Set();

  for (const el of elements) {
    if (el.type !== 'event') continue;

    for (const param of el.data?.eventParams || []) {
      if (param.name !== EVENT_ID_PARAM) continue;

      let next = generateEventId(folderName);
      while (used.has(next)) next = generateEventId(folderName);
      used.add(next);
      param.example = next;
    }
  }

  return elements;
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

/*
 * Conector magnetico entre dois elementos.
 *
 * `from` e `to` guardam apenas { id, anchor }. A posicao real e recalculada a
 * cada render, e por isso a seta acompanha o elemento quando ele e movido ou
 * redimensionado.
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
