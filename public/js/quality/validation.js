/*
 * Validador de governanca.
 *
 * Roda continuamente sobre a pagina aberta e aponta problema antes de o mapa
 * virar ticket: nomenclatura fora do padrao GA4, parametro duplicado, limite
 * da plataforma estourado, campo de governanca vazio.
 *
 * Cada issue leva junto o `elementId`, e e assim que o painel consegue dar
 * zoom no card problematico com um clique.
 */

import { isSnakeCase, toSnakeCase } from '../util.js';
import { GA4_LIMITS, RESERVED_EVENT_NAMES, RESERVED_PREFIXES, PARAM_SCOPES } from '../constants.js';
import { EVENT_ID_PARAM } from '../models.js';

/** Valor do event_id de um card, ou string vazia quando o parametro nao existe. */
const eventIdOf = (el) =>
  ((el.data?.eventParams || []).find((p) => p.name === EVENT_ID_PARAM)?.example || '').trim();

const err = (message, elementId, where) => ({ level: 'error', message, elementId, where });
const warn = (message, elementId, where) => ({ level: 'warn', message, elementId, where });

/**
 * @param {object} doc documento papyrus
 * @returns {{issues: Array, byElement: Map<string, Array>, counts: {error:number, warn:number}}}
 */
export function validateDoc(doc) {
  const issues = [];
  const elements = doc?.elements || [];
  const events = elements.filter((el) => el.type === 'event');

  /* event_id repetido: dois cards com a mesma chave viram o mesmo evento no GA4 */
  const eventIdCount = new Map();
  for (const el of events) {
    const id = eventIdOf(el);
    if (!id) continue;
    eventIdCount.set(id, (eventIdCount.get(id) || 0) + 1);
  }

  /* Validacao card a card */
  for (const el of events) {
    const d = el.data || {};
    const where = d.name || '(sem nome)';

    // Nome do evento
    if (!d.name?.trim()) {
      issues.push(err('Evento sem nome.', el.id, where));
    } else {
      if (!isSnakeCase(d.name)) {
        issues.push(
          err(`"${d.name}" não está em snake_case. Sugestão: ${toSnakeCase(d.name)}`, el.id, where),
        );
      }
      if (d.name.length > GA4_LIMITS.eventNameLength) {
        issues.push(
          err(`Nome do evento excede ${GA4_LIMITS.eventNameLength} caracteres.`, el.id, where),
        );
      }
      if (RESERVED_EVENT_NAMES.has(d.name) && d.eventType !== 'automatic') {
        issues.push(
          err(`"${d.name}" é um nome reservado do GA4. Use apenas em eventos Automatic.`, el.id, where),
        );
      }
      if (RESERVED_PREFIXES.some((p) => d.name.startsWith(p))) {
        issues.push(err(`Prefixo reservado pelo GA4 em "${d.name}".`, el.id, where));
      }
    }

    // event_id: precisa existir e nao pode se repetir
    const eventId = eventIdOf(el);
    if (!eventId) {
      issues.push(err(`Sem \`${EVENT_ID_PARAM}\` preenchido.`, el.id, where));
    } else if ((eventIdCount.get(eventId) || 0) > 1) {
      issues.push(
        err(`\`${EVENT_ID_PARAM}\` "${eventId}" repetido em mais de um card. Ele precisa ser único.`, el.id, where),
      );
    }

    // Contexto tecnico
    if (!d.platform?.length) issues.push(warn('Nenhuma plataforma definida.', el.id, where));
    if (!d.trigger?.trim()) issues.push(warn('Gatilho (trigger) não descrito.', el.id, where));

    // Governanca
    if (!d.squad?.trim() && !d.owner?.trim()) {
      issues.push(warn('Sem squad nem responsável definidos.', el.id, where));
    }
    if (d.ticketUrl && !/^https?:\/\//i.test(d.ticketUrl)) {
      issues.push(warn('URL do card precisa começar com http:// ou https://', el.id, where));
    }

    // Parametros
    for (const [scope, scopeLabel] of Object.entries(PARAM_SCOPES)) {
      const params = d[scope] || [];
      if (scope === 'itemParams' && d.eventType !== 'ecommerce') continue;

      const seen = new Map();
      for (const p of params) {
        const name = (p.name || '').trim();

        if (!name) {
          issues.push(err(`${scopeLabel}: parâmetro sem nome.`, el.id, where));
          continue;
        }
        if (!isSnakeCase(name)) {
          issues.push(
            err(`${scopeLabel}: "${name}" fora do snake_case. Sugestão: ${toSnakeCase(name)}`, el.id, where),
          );
        }
        if (name.length > GA4_LIMITS.paramNameLength) {
          issues.push(
            err(`${scopeLabel}: "${name}" excede ${GA4_LIMITS.paramNameLength} caracteres.`, el.id, where),
          );
        }
        if (RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix))) {
          issues.push(err(`${scopeLabel}: prefixo reservado em "${name}".`, el.id, where));
        }
        seen.set(name, (seen.get(name) || 0) + 1);

        // Sem exemplo no obrigatorio o QA trava depois, na hora de conferir.
        if (p.required && !p.example?.toString().trim()) {
          issues.push(warn(`${scopeLabel}: "${name}" é obrigatório e não tem valor de exemplo.`, el.id, where));
        }
      }

      for (const [name, count] of seen) {
        if (count > 1) issues.push(err(`${scopeLabel}: "${name}" está duplicado.`, el.id, where));
      }

      if (scope === 'eventParams' && params.length > GA4_LIMITS.paramsPerEvent) {
        issues.push(
          warn(
            `${params.length} parâmetros de evento. O GA4 registra até ${GA4_LIMITS.paramsPerEvent} por evento.`,
            el.id,
            where,
          ),
        );
      }
    }

    // Regras especificas de Ecommerce
    if (d.eventType === 'ecommerce') {
      if (!d.itemParams?.length) {
        issues.push(warn('Evento Ecommerce sem parâmetros de items[].', el.id, where));
      }
      const eventNames = new Set((d.eventParams || []).map((p) => (p.name || '').trim()));
      for (const required of ['currency', 'value']) {
        if (!eventNames.has(required)) {
          issues.push(warn(`Ecommerce: parâmetro "${required}" não declarado.`, el.id, where));
        }
      }
    }
  }

  /* Conectores orfaos */
  const ids = new Set(elements.map((el) => el.id));
  for (const el of elements) {
    if (el.type !== 'connector') continue;
    if (!ids.has(el.from?.id) || !ids.has(el.to?.id)) {
      issues.push(warn('Conector apontando para elemento inexistente.', el.id, 'conector'));
    }
  }

  /* Indices */
  const byElement = new Map();
  for (const issue of issues) {
    if (!byElement.has(issue.elementId)) byElement.set(issue.elementId, []);
    byElement.get(issue.elementId).push(issue);
  }

  return {
    issues,
    byElement,
    counts: {
      error: issues.filter((i) => i.level === 'error').length,
      warn: issues.filter((i) => i.level === 'warn').length,
    },
  };
}
