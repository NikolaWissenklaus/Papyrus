/*
 * Vocabulario fixo da ferramenta: taxonomias, cores funcionais e catalogos do
 * GA4. Fica tudo em um arquivo so para que canvas, inspetor, dicionario e
 * validador falem exatamente a mesma lingua.
 */

/*
 * Tipos de evento e a cor da tarja do card. `color` e o tom pleno usado como
 * acento, `soft` e o fundo tintado do cabecalho e `text` e a variante escura,
 * legivel sobre o `soft`.
 */
export const EVENT_TYPES = [
  { id: 'view', label: 'View', color: '#1A73E8', soft: '#E8F0FE', text: '#1967D2' },
  { id: 'interaction', label: 'Interaction', color: '#188038', soft: '#E6F4EA', text: '#137333' },
  { id: 'ecommerce', label: 'Ecommerce', color: '#F9AB00', soft: '#FEF7E0', text: '#B06000' },
  { id: 'automatic', label: 'Automatic', color: '#A142F4', soft: '#F3E8FD', text: '#8430CE' },
];

export const EVENT_TYPE_MAP = Object.fromEntries(EVENT_TYPES.map((t) => [t.id, t]));

/** Tipos de dado suportados no parametro. */
export const PARAM_TYPES = ['string', 'boolean', 'int', 'float', 'array', 'object'];

/** Plataformas de coleta (multi-selecao). */
export const PLATFORMS = [
  { id: 'web', label: 'Web' },
  { id: 'app', label: 'App' },
  { id: 'server', label: 'Server' },
];

/** Escopos de parametro dentro de um card. */
export const PARAM_SCOPES = {
  eventParams: 'Parâmetros de Evento',
  userParams: 'Propriedades de Usuário',
  itemParams: 'Parâmetros de Item (items[])',
};

/**
 * Parametros padrao do array `items` do GA4 Ecommerce.
 * Injetados automaticamente quando o card vira tipo "ecommerce".
 */
export const GA4_ITEM_PARAMS = [
  { name: 'item_id', type: 'string', required: true },
  { name: 'item_name', type: 'string', required: true },
  { name: 'affiliation', type: 'string', required: false },
  { name: 'coupon', type: 'string', required: false },
  { name: 'discount', type: 'float', required: false },
  { name: 'index', type: 'int', required: false },
  { name: 'item_brand', type: 'string', required: false },
  { name: 'item_category', type: 'string', required: false },
  { name: 'item_category2', type: 'string', required: false },
  { name: 'item_category3', type: 'string', required: false },
  { name: 'item_category4', type: 'string', required: false },
  { name: 'item_category5', type: 'string', required: false },
  { name: 'item_list_id', type: 'string', required: false },
  { name: 'item_list_name', type: 'string', required: false },
  { name: 'item_variant', type: 'string', required: false },
  { name: 'location_id', type: 'string', required: false },
  { name: 'price', type: 'float', required: true },
  { name: 'quantity', type: 'int', required: true },
];

/** Parametros de nivel de evento tipicos do Ecommerce GA4. */
export const GA4_ECOMMERCE_EVENT_PARAMS = [
  { name: 'currency', type: 'string', required: true },
  { name: 'value', type: 'float', required: true },
  { name: 'items', type: 'array', required: true },
];

/** Nomes que o GA4 reserva. Eventos customizados nao podem usar nenhum deles. */
export const RESERVED_EVENT_NAMES = new Set([
  'ad_activeview', 'ad_click', 'ad_exposure', 'ad_query', 'ad_reward',
  'adunit_exposure', 'app_clear_data', 'app_exception', 'app_install',
  'app_remove', 'app_store_refund', 'app_store_subscription_cancel',
  'app_store_subscription_convert', 'app_store_subscription_renew',
  'app_update', 'app_upgrade', 'dynamic_link_app_open', 'dynamic_link_app_update',
  'dynamic_link_first_open', 'error', 'firebase_campaign', 'firebase_in_app_message_action',
  'first_open', 'first_visit', 'in_app_purchase', 'notification_dismiss',
  'notification_foreground', 'notification_open', 'notification_receive',
  'os_update', 'session_start', 'user_engagement',
]);

/** Prefixos reservados para nomes de evento e parametro. */
export const RESERVED_PREFIXES = ['ga_', 'google_', 'firebase_'];

/** Limites oficiais do GA4 relevantes para o planejamento. */
export const GA4_LIMITS = {
  eventNameLength: 40,
  paramNameLength: 40,
  paramValueLength: 100,
  paramsPerEvent: 25,
  userPropertiesPerProperty: 25,
};

/** Paleta de preenchimento para formas e notas adesivas (tons discretos). */
export const SHAPE_COLORS = [
  '#FFFFFF', '#F1F3F4', '#E8F0FE', '#E6F4EA',
  '#FEF7E0', '#FCE8E6', '#F3E8FD', '#202124',
];

export const STICKY_COLORS = ['#FEF7C3', '#D8F0E1', '#DCE6FB', '#FBDDE3', '#F3E8FD', '#F1F3F4'];

/** Cor do icone de pagina na barra lateral. E fixa: so pasta aceita cor propria. */
export const PAGE_COLOR = '#1A73E8';

/** Cor de pasta usada quando o usuario nao escolhe nenhuma. */
export const DEFAULT_FOLDER_COLOR = '#F29900';

/** Paleta oferecida no seletor de cor de pasta. */
export const FOLDER_COLORS = [
  { value: '#F29900', label: 'Laranja' },
  { value: '#1A73E8', label: 'Azul' },
  { value: '#188038', label: 'Verde' },
  { value: '#D93025', label: 'Vermelho' },
  { value: '#A142F4', label: 'Roxo' },
  { value: '#E52592', label: 'Rosa' },
  { value: '#12B5CB', label: 'Ciano' },
  { value: '#5F6368', label: 'Cinza' },
];

/** Geometria padrao dos elementos criados no canvas. */
export const DEFAULTS = {
  eventCardWidth: 320,
  stickySize: 180,
  shapeSize: { width: 200, height: 130 },
  textWidth: 240,
  pinRadius: 14,
  maxPreviewParams: 6,
};
