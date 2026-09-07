/*
 * Aba "Dicionario Global".
 *
 * Catalogo consolidado do workspace inteiro: eventos, parametros unicos e o
 * de-para entre eles. Quem faz a agregacao, varrendo a pasta papyrus, e o
 * back-end. Aqui a gente so apresenta e filtra.
 *
 * O painel tambem avisa quando o mesmo parametro aparece com tipos diferentes.
 * Esse e o erro de schema que sai mais caro depois que ja chegou no BigQuery.
 */

import { api } from '../api.js';
import { on, state } from '../store.js';
import { esc, downloadBlob, formatDate } from '../util.js';
import { EVENT_TYPE_MAP } from '../constants.js';
import { toast } from '../ui/toast.js';
import { openModal } from '../ui/modal.js';

let root = null;
let data = null;
let activeTab = 'events';
let query = '';

export function initDictionary() {
  root = document.getElementById('dictionary-root');
  on('view', (view) => {
    if (view === 'dictionary') refresh();
  });
}

export async function refresh() {
  root.innerHTML = '<div class="card" style="text-align:center;color:var(--text-muted)">Consolidando workspace…</div>';
  try {
    data = await api.getDictionary();
    render();
  } catch (err) {
    root.innerHTML = `<div class="card" style="color:var(--danger)">${esc(err.message)}</div>`;
  }
}

/* Render */

function render() {
  if (!data) return;
  const { totals, conflicts } = data;
  const collisions = data.eventIdCollisions || [];

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Dicionário Global</h1>
        <p>
          Catálogo consolidado de todas as páginas da pasta <code>papyrus</code>.
          Gerado em ${formatDate(data.generatedAt)}.
        </p>
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn--ghost" id="dict-csv">Exportar CSV</button>
        <button class="btn btn--primary" id="dict-refresh">Atualizar</button>
      </div>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat__value">${totals.pages}</div><div class="stat__label">Páginas</div></div>
      <div class="stat"><div class="stat__value">${totals.events}</div><div class="stat__label">Eventos</div></div>
      <div class="stat"><div class="stat__value">${totals.parameters}</div><div class="stat__label">Parâmetros únicos</div></div>
      <div class="stat${conflicts.length ? ' stat--alert' : ''}">
        <div class="stat__value">${conflicts.length}</div><div class="stat__label">Conflitos de tipo</div>
      </div>
      <div class="stat${collisions.length ? ' stat--alert' : ''}">
        <div class="stat__value">${collisions.length}</div><div class="stat__label">event_id repetidos</div>
      </div>
    </div>

    ${collisions.length ? collisionBanner(collisions) : ''}
    ${conflicts.length ? conflictBanner(conflicts) : ''}

    <div style="display:flex;gap:12px;align-items:center;margin:22px 0 14px">
      <div class="tabs" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-button);padding:4px">
        <button class="tab${activeTab === 'events' ? ' is-active' : ''}" data-tab="events">Eventos</button>
        <button class="tab${activeTab === 'params' ? ' is-active' : ''}" data-tab="params">Parâmetros</button>
        <button class="tab${activeTab === 'matrix' ? ' is-active' : ''}" data-tab="matrix">De-para</button>
      </div>
      <input class="input input--search" id="dict-search" placeholder="Filtrar…" value="${esc(query)}" style="max-width:280px" />
    </div>

    <div id="dict-body">${renderTab()}</div>`;

  bind();
}

const collisionBanner = (collisions) => `
  <div class="card" style="border-color:#FAD2CF;background:var(--danger-bg)">
    <strong style="color:var(--danger);font-size:13px">
      ${collisions.length} <code>event_id</code> usado(s) por mais de um card
    </strong>
    <p class="field__hint" style="margin:6px 0 10px">
      O <code>event_id</code> é a chave que liga o planejamento ao dado coletado. Repetido, dois
      eventos diferentes chegam como o mesmo no GA4. Cada card precisa do seu.
    </p>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${collisions
        .map(
          (c) => `<div style="font-size:12px">
            <code>${esc(c.id)}</code>
            <span class="faint">em ${c.uses.map((u) => `${esc(u.event)} (${esc(u.page)})`).join(', ')}</span>
          </div>`,
        )
        .join('')}
    </div>
  </div>`;

const conflictBanner = (conflicts) => `
  <div class="card" style="border-color:#FAD2CF;background:var(--danger-bg)">
    <strong style="color:var(--danger);font-size:13px">
      ${conflicts.length} parâmetro(s) declarados com tipos divergentes
    </strong>
    <p class="field__hint" style="margin:6px 0 10px">
      O mesmo nome com tipos diferentes vira coluna inconsistente no BigQuery e quebra relatórios. Padronize antes de implementar.
    </p>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${conflicts
        .map((c) => `<span class="chip chip--danger"><code>${esc(c.name)}</code>: ${c.types.map(esc).join(' / ')}</span>`)
        .join('')}
    </div>
  </div>`;

function renderTab() {
  const q = query.trim().toLowerCase();

  if (activeTab === 'events') {
    const rows = data.events.filter(
      (e) =>
        !q ||
        e.event_name.toLowerCase().includes(q) ||
        e.page.toLowerCase().includes(q) ||
        (e.governance.squad || '').toLowerCase().includes(q),
    );

    return table(
      ['Evento', 'Tipo', 'Página', 'Plataforma', 'Squad / Responsável', 'Params', 'Card'],
      rows.map((e) => {
        const type = EVENT_TYPE_MAP[e.event_type];
        const paramCount =
          e.parameters.event.length + e.parameters.user.length + (e.parameters.items?.length || 0);
        return `
          <tr>
            <td><code>${esc(e.event_name)}</code></td>
            <td><span class="chip chip--${e.event_type}">${esc(type?.label || e.event_type)}</span></td>
            <td>${esc(e.page)}</td>
            <td class="muted">${e.platform.map(esc).join(', ') || '—'}</td>
            <td class="muted">${esc([e.governance.squad, e.governance.owner].filter(Boolean).join(' · ') || '—')}</td>
            <td>${paramCount}</td>
            <td>${
              e.tracker.url
                ? `<a href="${esc(e.tracker.url)}" target="_blank" rel="noopener" style="color:var(--azul)">${esc(e.tracker.card_id || 'abrir')}</a>`
                : `<span class="faint">${esc(e.tracker.card_id || '—')}</span>`
            }</td>
          </tr>`;
      }),
      rows.length,
    );
  }

  if (activeTab === 'params') {
    const rows = data.parameters.filter((p) => !q || p.name.toLowerCase().includes(q));

    return table(
      ['Parâmetro', 'Escopo', 'Tipo(s)', 'Usos', 'Obrigatório em', 'Eventos'],
      rows.map(
        (p) => `
        <tr>
          <td><code>${esc(p.name)}</code></td>
          <td><span class="chip">${scopeLabel(p.scope)}</span></td>
          <td>${p.types.map((t) => `<span class="chip${p.types.length > 1 ? ' chip--danger' : ''}">${esc(t)}</span>`).join(' ')}</td>
          <td>${p.usageCount}</td>
          <td>${p.requiredIn}</td>
          <td class="muted" style="max-width:320px">
            ${[...new Set(p.usedBy.map((u) => u.event))].slice(0, 6).map(esc).join(', ')}
            ${new Set(p.usedBy.map((u) => u.event)).size > 6 ? ' …' : ''}
          </td>
        </tr>`,
      ),
      rows.length,
    );
  }

  // De-para: matriz parametro x evento
  const params = data.parameters.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 60);
  const events = [...new Set(data.events.map((e) => e.event_name))].slice(0, 40);

  if (!params.length || !events.length) return emptyState();

  return `
    <div class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th style="position:sticky;left:0;z-index:2;background:var(--surface)">Parâmetro</th>
            ${events.map((e) => `<th style="writing-mode:vertical-rl;transform:rotate(180deg);height:130px;white-space:nowrap">${esc(e)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${params
            .map((p) => {
              const used = new Set(p.usedBy.map((u) => u.event));
              return `<tr>
                <td style="position:sticky;left:0;background:var(--surface);z-index:1"><code>${esc(p.name)}</code></td>
                ${events
                  .map(
                    (e) =>
                      `<td style="text-align:center">${
                        used.has(e) ? '<span style="color:var(--azul);font-weight:700">●</span>' : '<span class="faint">·</span>'
                      }</td>`,
                  )
                  .join('')}
              </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    </div>
    <div class="field__hint" style="margin-top:8px">
      Exibindo até 60 parâmetros × 40 eventos. Use o filtro para reduzir o recorte.
    </div>`;
}

const scopeLabel = (scope) =>
  ({ event: 'evento', user: 'usuário', items: 'items[]' })[scope] || scope;

const table = (headers, rows, count) => `
  <div class="table-scroll">
    <table class="table">
      <thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('') || `<tr><td colspan="${headers.length}" style="text-align:center;color:var(--text-faint);padding:32px">Nenhum resultado.</td></tr>`}</tbody>
    </table>
  </div>
  <div class="field__hint" style="margin-top:8px">${count} registro(s).</div>`;

const emptyState = () => `
  <div class="card" style="text-align:center;padding:48px;color:var(--text-muted)">
    Nenhum evento mapeado ainda. Crie cards de evento nas páginas do canvas.
  </div>`;

/* Interacao */

function bind() {
  root.querySelector('#dict-refresh').onclick = () => refresh();
  root.querySelector('#dict-csv').onclick = () => exportCSV();

  root.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = () => {
      activeTab = btn.dataset.tab;
      render();
    };
  });

  const search = root.querySelector('#dict-search');
  search.oninput = () => {
    query = search.value;
    root.querySelector('#dict-body').innerHTML = renderTab();
  };
  if (query) {
    search.focus();
    search.setSelectionRange(query.length, query.length);
  }
}

/** Exporta o de-para completo em CSV, formato que o time de dados le direto. */
function exportCSV() {
  const rows = [['pagina', 'evento', 'tipo_evento', 'plataforma', 'squad', 'responsavel', 'escopo', 'parametro', 'tipo', 'obrigatorio']];

  for (const e of data.events) {
    for (const [scope, list] of Object.entries(e.parameters)) {
      for (const p of list) {
        rows.push([
          e.page, e.event_name, e.event_type, e.platform.join('|'),
          e.governance.squad, e.governance.owner,
          scope, p.name, p.type, p.required ? 'sim' : 'nao',
        ]);
      }
    }
  }

  const csv = rows
    .map((r) => r.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(';'))
    .join('\r\n');

  // BOM, senao o Excel abre com a acentuacao quebrada.
  downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), 'papyrus-dicionario.csv');
  toast.ok('CSV gerado.');
}
