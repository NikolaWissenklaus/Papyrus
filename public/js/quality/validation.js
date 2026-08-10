/**
 * quality/validation.js
 * ---------------------------------------------------------------------------
 * Quality of Life #1 — Validador de governanca.
 *
 * Roda continuamente sobre a pagina aberta e aponta problemas ANTES de o mapa
 * virar ticket de desenvolvimento: nomenclatura fora do padrao GA4, parametros
 * duplicados, limites da plataforma estourados, campos de governanca vazios.
 *
 * Cada issue carrega o `elementId` para que o painel consiga dar zoom no card
 * problematico com um clique.
 */

import { isSnakeCase, toSnakeCase } from '../util.js';
import { GA4_LIMITS, RESERVED_EVENT_NAMES, RESERVED_PREFIXES, PARAM_SCOPES } from '../constants.js';

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

  /* ---------------------------------------------------- Nomes duplicados -- */
  const nameCount = new Map();
  for (const el of events) {
    const name = (el.data?.name || '').trim();
    if (!name) continue;
    nameCount.set(name, (nameCount.get(name) || 0) + 1);
  }

  /* --------------------------------------------------- Validacao por card -- */
  for (const el of events) {
    const d = el.data || {};
    const where = d.name || '(sem nome)';

    // --- Nome do evento ---
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
      if ((nameCount.get(d.name.trim()) || 0) > 1) {
        issues.push(warn(`Evento "${d.name}" está duplicado nesta página.`, el.id, where));
      }
    }

    // --- Contexto técnico ---
    if (!d.platform?.length) issues.push(warn('Nenhuma plataforma definida.', el.id, where));
    if (!d.trigger?.trim()) issues.push(warn('Gatilho (trigger) não descrito.', el.id, where));

    // --- Governança ---
    if (!d.squad?.trim() && !d.owner?.trim()) {
      issues.push(warn('Sem squad nem responsável definidos.', el.id, where));
    }
    if (d.ticketUrl && !/^https?:\/\//i.test(d.ticketUrl)) {
      issues.push(warn('URL do card precisa começar com http:// ou https://', el.id, where));
    }

    // --- Parâmetros ---
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

        // Parâmetro obrigatório deve ter exemplo — é o que destrava o QA depois.
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
            `${params.length} parâmetros de evento — o GA4 registra até ${GA4_LIMITS.paramsPerEvent} por evento.`,
            el.id,
            where,
          ),
        );
      }
    }

    // --- Regras específicas de Ecommerce ---
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

  /* ------------------------------------------------- Conectores órfãos ---- */
  const ids = new Set(elements.map((el) => el.id));
  for (const el of elements) {
    if (el.type !== 'connector') continue;
    if (!ids.has(el.from?.id) || !ids.has(el.to?.id)) {
      issues.push(warn('Conector apontando para elemento inexistente.', el.id, 'conector'));
    }
  }

  /* ------------------------------------------------------------ Índices --- */
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
