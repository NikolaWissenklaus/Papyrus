/**
 * quality/snippet.js
 * ---------------------------------------------------------------------------
 * Quality of Life #2 — Geracao de codigo a partir do card.
 *
 * Transforma a especificacao desenhada no canvas em codigo pronto para o time
 * de front-end: `dataLayer.push` (GTM) ou `gtag('event', ...)`. Fecha o ciclo
 * "planejei -> implemento" sem retrabalho de digitacao e sem erro de nomenclatura.
 */

import { EVENT_TYPE_MAP } from '../constants.js';

/** Valor de exemplo para cada tipo declarado. */
function sampleValue(param) {
  if (param.example) {
    const raw = String(param.example).trim();
    if (param.type === 'int' || param.type === 'float') {
      return Number.isNaN(Number(raw)) ? JSON.stringify(raw) : raw;
    }
    if (param.type === 'boolean') return /^(true|1|sim)$/i.test(raw) ? 'true' : 'false';
    if (param.type === 'array' || param.type === 'object') return raw;
    return JSON.stringify(raw);
  }

  switch (param.type) {
    case 'int': return '0';
    case 'float': return '0.0';
    case 'boolean': return 'false';
    case 'array': return '[]';
    case 'object': return '{}';
    default: return `'<${param.name || 'valor'}>'`;
  }
}

const indent = (level) => '  '.repeat(level);

/** Serializa uma lista de parametros como propriedades de objeto. */
function serializeParams(params, level, { skip = [] } = {}) {
  return (params || [])
    .filter((p) => p.name && !skip.includes(p.name))
    .map((p) => {
      const comment = p.required ? ' // obrigatório' : '';
      return `${indent(level)}${p.name}: ${sampleValue(p)},${comment}`;
    })
    .join('\n');
}

/**
 * Gera o snippet `dataLayer.push`.
 * Em eventos Ecommerce, monta a estrutura aninhada `ecommerce.items[]`
 * e antecede com o `push({ ecommerce: null })` recomendado pelo Google.
 */
export function buildDataLayerSnippet(el) {
  const d = el.data || {};
  const type = EVENT_TYPE_MAP[d.eventType]?.label || 'Interaction';
  const isEcom = d.eventType === 'ecommerce';

  const header = [
    `/**`,
    ` * ${d.name || 'sem_nome'} — ${type}`,
    ` * Plataforma: ${(d.platform || []).join(', ') || '—'}`,
    ` * Gatilho: ${d.trigger || '—'}`,
    ` * Squad: ${d.squad || '—'} · Responsável: ${d.owner || '—'}`,
    d.ticketId || d.ticketUrl ? ` * Card: ${d.ticketId || ''} ${d.ticketUrl || ''}`.trimEnd() : null,
    ` * Gerado pelo Papyrus`,
    ` */`,
  ]
    .filter(Boolean)
    .join('\n');

  const lines = [header, 'window.dataLayer = window.dataLayer || [];'];

  if (isEcom) {
    lines.push('', '// Limpa o objeto ecommerce anterior (recomendação oficial do GA4).');
    lines.push("window.dataLayer.push({ ecommerce: null });");
  }

  lines.push('', 'window.dataLayer.push({');
  lines.push(`${indent(1)}event: '${d.name || 'sem_nome'}',`);

  const eventParams = serializeParams(d.eventParams, 1, { skip: isEcom ? ['items'] : [] });
  if (eventParams) lines.push(eventParams);

  if (isEcom && (d.itemParams || []).length) {
    lines.push(`${indent(1)}ecommerce: {`);
    lines.push(`${indent(2)}items: [`);
    lines.push(`${indent(3)}{`);
    lines.push(serializeParams(d.itemParams, 4));
    lines.push(`${indent(3)}},`);
    lines.push(`${indent(2)}],`);
    lines.push(`${indent(1)}},`);
  }

  lines.push('});');

  if ((d.userParams || []).length) {
    lines.push('', '// Propriedades de usuário (enviar antes ou junto do evento).');
    lines.push('window.dataLayer.push({');
    lines.push(`${indent(1)}user_properties: {`);
    lines.push(serializeParams(d.userParams, 2));
    lines.push(`${indent(1)}},`);
    lines.push('});');
  }

  if (d.notes?.trim()) {
    lines.push('', `/* Observações: ${d.notes.replace(/\*\//g, '* /')} */`);
  }

  return lines.filter((l) => l !== '').join('\n').replace(/\n{3,}/g, '\n\n');
}

/** Gera o snippet equivalente com a API `gtag()`. */
export function buildGtagSnippet(el) {
  const d = el.data || {};
  const isEcom = d.eventType === 'ecommerce';

  const lines = [`gtag('event', '${d.name || 'sem_nome'}', {`];
  const eventParams = serializeParams(d.eventParams, 1, { skip: isEcom ? ['items'] : [] });
  if (eventParams) lines.push(eventParams);

  if (isEcom && (d.itemParams || []).length) {
    lines.push(`${indent(1)}items: [`);
    lines.push(`${indent(2)}{`);
    lines.push(serializeParams(d.itemParams, 3));
    lines.push(`${indent(2)}},`);
    lines.push(`${indent(1)}],`);
  }
  lines.push('});');

  if ((d.userParams || []).length) {
    lines.push('', "gtag('set', 'user_properties', {");
    lines.push(serializeParams(d.userParams, 1));
    lines.push('});');
  }

  return lines.join('\n');
}

/**
 * Quality of Life #3 — JSON Schema do evento.
 * Util para validar payloads em testes automatizados / contratos de coleta.
 */
export function buildJsonSchema(el) {
  const d = el.data || {};
  const typeMap = {
    string: 'string', boolean: 'boolean', int: 'integer',
    float: 'number', array: 'array', object: 'object',
  };

  const toProps = (params) => {
    const properties = {};
    const required = [];
    for (const p of params || []) {
      if (!p.name) continue;
      properties[p.name] = {
        type: typeMap[p.type] || 'string',
        ...(p.description ? { description: p.description } : {}),
        ...(p.example ? { examples: [p.example] } : {}),
      };
      if (p.required) required.push(p.name);
    }
    return { properties, required };
  };

  const base = toProps(d.eventParams);
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: d.name || 'sem_nome',
    description: `${d.trigger || ''}`.trim() || undefined,
    type: 'object',
    properties: { event: { const: d.name }, ...base.properties },
    required: ['event', ...base.required],
    additionalProperties: true,
  };

  if (d.eventType === 'ecommerce' && (d.itemParams || []).length) {
    const items = toProps(d.itemParams);
    schema.properties.ecommerce = {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object', ...items } },
      },
      required: ['items'],
    };
  }

  return JSON.stringify(schema, null, 2);
}
