/**
 * panels/inspector.js
 * ---------------------------------------------------------------------------
 * Painel lateral direito: edicao das propriedades do elemento selecionado.
 *
 * O Card de Evento e editado aqui (e nao dentro do canvas) por uma razao de
 * usabilidade: sao ~20 campos + duas tabelas de parametros. Manter isso legivel
 * dentro de um retangulo desenhado seria hostil. O card no canvas funciona como
 * "resumo executivo"; o inspetor e a ficha completa.
 *
 * Anti-padrao evitado: re-renderizar o painel a cada tecla digitada faria o
 * input perder o foco. Por isso alteracoes originadas AQUI marcam `selfUpdate`
 * e nao disparam re-render do proprio painel — apenas do canvas.
 */

import {
  state, commit, getElement, getSelectedElements, removeElements, on, setSelection,
} from '../store.js';
import {
  EVENT_TYPES, EVENT_TYPE_MAP, PARAM_TYPES, PLATFORMS, SHAPE_COLORS, STICKY_COLORS,
} from '../constants.js';
import { createParam, defaultItemParams } from '../models.js';
import { esc, uid, toSnakeCase } from '../util.js';
import { validateDoc } from '../quality/validation.js';
import { buildDataLayerSnippet, buildGtagSnippet, buildJsonSchema } from '../quality/snippet.js';
import { showCode, openModal, confirm } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { duplicateSelection, centerOn } from '../canvas/stage.js';

let host = null;
let selfUpdate = false;
/** Secoes recolhidas ficam memorizadas entre renders. */
const collapsed = new Set(['userParams', 'agile']);

export function initInspector() {
  host = document.getElementById('inspector');

  // Commits externos em rajada (nudge com seta pressionada, undo repetido)
  // geram no maximo UM rebuild do painel por frame.
  let renderQueued = false;
  const scheduleRender = () => {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => {
      renderQueued = false;
      renderInspector();
    });
  };

  on('selection', () => renderInspector());
  on('doc', () => {
    if (selfUpdate) {
      selfUpdate = false;
      return;
    }
    scheduleRender();
  });

  window.addEventListener('papyrus:focus-inspector', () => {
    // O main.js reabre o inspetor recolhido neste mesmo evento; o foco espera
    // um frame para o painel voltar a ficar visível (elemento oculto não foca).
    requestAnimationFrame(() => host.querySelector('[data-field="name"]')?.focus());
  });
}

/** Aplica uma mutacao sem forcar o re-render do proprio painel. */
function mutate(mutator, coalesceKey) {
  selfUpdate = true;
  commit(mutator, { coalesceKey });
}

/** Mutacao no `data` de um card de evento. */
function mutateEvent(id, patch, coalesceKey) {
  mutate((doc) => {
    const el = doc.elements.find((e) => e.id === id);
    if (el) el.data = { ...el.data, ...patch };
  }, coalesceKey);
}

/* ========================================================================== */
/* Render principal                                                           */
/* ========================================================================== */

export function renderInspector() {
  if (!host) return;
  const selected = getSelectedElements();

  if (!selected.length) {
    host.innerHTML = `
      <div class="inspector__empty">
        <p>Selecione um elemento no canvas para editar suas propriedades.</p>
        <p class="faint" style="font-size:12px;margin-top:18px">
          Dica: <kbd>E</kbd> cria um card de evento, <kbd>Ctrl</kbd>+<kbd>V</kbd> cola um print de tela.
        </p>
      </div>`;
    return;
  }

  if (selected.length > 1) return renderMultiSelection(selected);

  const el = selected[0];
  switch (el.type) {
    case 'event': return renderEventCard(el);
    case 'sticky': return renderSticky(el);
    case 'text': return renderText(el);
    case 'rect':
    case 'ellipse': return renderShape(el);
    case 'image': return renderImage(el);
    case 'pin': return renderPin(el);
    case 'connector': return renderConnector(el);
    default: return (host.innerHTML = '');
  }
}

/* ========================================================================== */
/* Blocos reutilizaveis                                                       */
/* ========================================================================== */

const header = (type, title, stripe) => `
  <div class="inspector__head">
    ${stripe ? `<div class="type-stripe" data-type="${stripe}"></div>` : ''}
    <div class="inspector__type">${esc(type)}</div>
    <div class="inspector__title"><h3>${esc(title)}</h3></div>
    <div class="inspector__actions">
      <button class="btn btn--mini" data-action="duplicate">Duplicar</button>
      <button class="btn btn--mini" data-action="front">Frente</button>
      <button class="btn btn--mini" data-action="back">Trás</button>
      <button class="btn btn--mini" data-action="delete" style="color:var(--vermelho)">Excluir</button>
    </div>
  </div>`;

const section = (key, title, body, badge = '') => `
  <div class="section${collapsed.has(key) ? '' : ' is-open'}" data-section="${key}">
    <button class="section__head">
      ${esc(title)}
      ${badge ? `<span class="section__count">${esc(badge)}</span>` : ''}
      <span class="section__caret">▶</span>
    </button>
    <div class="section__body">${body}</div>
  </div>`;

const field = (label, control, hint = '') => `
  <div class="field">
    <label class="field__label">${esc(label)}</label>
    ${control}
    ${hint ? `<div class="field__hint">${hint}</div>` : ''}
  </div>`;

const input = (fieldName, value, placeholder = '', extraClass = '') =>
  `<input class="input ${extraClass}" data-field="${fieldName}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}" autocomplete="off" />`;

const textarea = (fieldName, value, placeholder = '') =>
  `<textarea class="textarea" data-field="${fieldName}" placeholder="${esc(placeholder)}">${esc(value ?? '')}</textarea>`;

const swatches = (colors, current, fieldName) => `
  <div class="swatches" data-swatch-field="${fieldName}">
    ${colors
      .map(
        (c) => `<button class="swatch" data-color="${c}" aria-pressed="${c === current}"
                  style="background:${c === 'transparent' ? 'repeating-conic-gradient(#eee 0% 25%, #fff 0% 50%) 50%/8px 8px' : c}"
                  title="${c}"></button>`,
      )
      .join('')}
  </div>`;

/* ========================================================================== */
/* Tabela de parametros                                                       */
/* ========================================================================== */

function paramTable(el, scope) {
  const params = el.data?.[scope] || [];

  const rows = params
    .map(
      (p) => `
      <div class="param-row" data-param="${p.id}">
        <input class="input input--mono" data-pfield="name" value="${esc(p.name)}" placeholder="nome_do_parametro" autocomplete="off" />
        <select class="select" data-pfield="type">
          ${PARAM_TYPES.map((t) => `<option value="${t}"${t === p.type ? ' selected' : ''}>${t}</option>`).join('')}
        </select>
        <button class="toggle" data-pfield="required" aria-pressed="${Boolean(p.required)}"
                title="Alternar entre obrigatório e opcional">${p.required ? 'Obrig.' : 'Opc.'}</button>
        <button class="param-row__del" data-pfield="delete" title="Remover parâmetro">×</button>
        <div class="param-row__extra">
          <input class="input" data-pfield="example" value="${esc(p.example ?? '')}"
                 placeholder="valor de exemplo — usado no snippet e no QA" autocomplete="off" />
        </div>
      </div>`,
    )
    .join('');

  return `
    <div class="params" data-scope="${scope}">
      <div class="params__head"><span>Parâmetro</span><span>Tipo</span><span>Obrig.</span><span></span></div>
      ${rows || '<div class="field__hint" style="padding:6px 0">Nenhum parâmetro declarado.</div>'}
    </div>
    <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
      <button class="btn btn--mini" data-action="add-param" data-scope="${scope}">+ Parâmetro</button>
      <button class="btn btn--mini" data-action="import-group" data-scope="${scope}">Importar grupo</button>
      <button class="btn btn--mini" data-action="normalize" data-scope="${scope}" title="Converter todos os nomes para snake_case">snake_case</button>
      ${scope === 'itemParams' ? '<button class="btn btn--mini" data-action="reset-items">Restaurar padrão GA4</button>' : ''}
    </div>`;
}

/* ========================================================================== */
/* Card de Evento                                                             */
/* ========================================================================== */

function renderEventCard(el) {
  const d = el.data || {};
  const type = EVENT_TYPE_MAP[d.eventType] || EVENT_TYPE_MAP.interaction;
  const issues = validateDoc(state.doc).byElement.get(el.id) || [];

  const totalParams =
    (d.eventParams?.length || 0) +
    (d.userParams?.length || 0) +
    (d.eventType === 'ecommerce' ? d.itemParams?.length || 0 : 0);

  host.innerHTML = `
    ${header('Card de Evento', d.name || 'sem_nome', d.eventType)}

    <div class="inspector__actions" style="padding:12px 18px 4px;border-bottom:1px solid var(--border)">
      <button class="btn btn--mini" data-action="snippet-datalayer">dataLayer.push</button>
      <button class="btn btn--mini" data-action="snippet-gtag">gtag()</button>
      <button class="btn btn--mini" data-action="snippet-schema">JSON Schema</button>
      <button class="btn btn--mini" data-action="toggle-collapse">${el.collapsed ? 'Expandir card' : 'Recolher card'}</button>
    </div>

    ${section(
      'identification',
      'Identificação',
      field('Nome do evento', input('name', d.name, 'view_item', 'input--mono'),
        'Padrão GA4: snake_case, até 40 caracteres.') +
      field(
        'Tipo do evento',
        `<select class="select" data-field="eventType">
           ${EVENT_TYPES.map((t) => `<option value="${t.id}"${t.id === d.eventType ? ' selected' : ''}>${t.label}</option>`).join('')}
         </select>`,
        'Define a cor da tarja do card no canvas.',
      ),
    )}

    ${section(
      'technical',
      'Contexto Técnico',
      field(
        'Plataforma',
        `<div class="pill-group" data-platform>
           ${PLATFORMS.map(
             (p) => `<button class="pill" data-platform-id="${p.id}" aria-pressed="${(d.platform || []).includes(p.id)}">${p.label}</button>`,
           ).join('')}
         </div>`,
      ) +
      field('Gatilho (trigger)', textarea('trigger', d.trigger, 'Ex.: clique no botão #btn-comprar da PDP'),
        'Descreva a condição exata de disparo — é o que o time de GTM vai implementar.'),
    )}

    ${section(
      'governance',
      'Governança',
      `<div class="grid-2">
         ${field('Squad responsável', input('squad', d.squad, 'Checkout'))}
         ${field('Pessoa responsável', input('owner', d.owner, 'nome@empresa'))}
       </div>
       ${field('Observações', textarea('notes', d.notes, 'Regras de negócio, exceções, dependências…'))}`,
    )}

    ${section(
      'agile',
      'Integração Ágil',
      `${field('Nome do card', input('ticketName', d.ticketName, 'Implementar view_item na PDP'))}
       <div class="grid-2">
         ${field('ID do card', input('ticketId', d.ticketId, 'ANA-1234', 'input--mono'))}
         ${field('Atalho', `<button class="btn btn--mini" data-action="open-ticket" style="width:100%;padding:7px 12px" ${d.ticketUrl ? '' : 'disabled'}>Abrir card ↗</button>`)}
       </div>
       ${field('URL', input('ticketUrl', d.ticketUrl, 'https://jira.empresa.com/browse/ANA-1234', 'input--mono'))}`,
      d.ticketId || '',
    )}

    ${section('eventParams', 'Parâmetros de Evento', paramTable(el, 'eventParams'), String(d.eventParams?.length || 0))}
    ${section('userParams', 'Propriedades de Usuário', paramTable(el, 'userParams'), String(d.userParams?.length || 0))}

    ${
      d.eventType === 'ecommerce'
        ? section('itemParams', 'Módulo Ecommerce — items[]', paramTable(el, 'itemParams'), String(d.itemParams?.length || 0))
        : ''
    }

    ${section(
      'validation',
      'Validação do card',
      issues.length
        ? issues
            .map(
              (i) => `<div class="issue">
                        <span class="issue__tag" data-level="${i.level}">${i.level === 'error' ? 'erro' : 'aviso'}</span>
                        <span>${esc(i.message)}</span>
                      </div>`,
            )
            .join('')
        : `<div class="field__hint" style="color:var(--ok)">✓ Nenhum problema encontrado. ${totalParams} parâmetro(s) declarado(s).</div>`,
      issues.length ? String(issues.length) : '✓',
    )}
  `;

  bindCommonActions(el);
  bindEventCardFields(el);
}

function bindEventCardFields(el) {
  // IMPORTANTE: apos qualquer commit() o documento e clonado — `el` vira uma
  // referencia OBSOLETA. Handlers que precisam LER o estado atual devem sempre
  // buscar o elemento vivo, senao dois cliques seguidos perdem a 1ª alteracao.
  const live = () => getElement(el.id) || el;

  // --- Campos de texto simples ---
  host.querySelectorAll('[data-field]').forEach((node) => {
    const fieldName = node.dataset.field;

    if (node.tagName === 'SELECT') {
      node.onchange = () => {
        const value = node.value;
        if (fieldName === 'eventType') {
          // Ao virar Ecommerce, injeta automaticamente o bloco items[] do GA4.
          const patch = { eventType: value };
          if (value === 'ecommerce' && !(live().data?.itemParams || []).length) {
            patch.itemParams = defaultItemParams();
          }
          mutateEvent(el.id, patch);
          renderInspector();
        } else {
          mutateEvent(el.id, { [fieldName]: value });
        }
      };
      return;
    }

    node.oninput = () => mutateEvent(el.id, { [fieldName]: node.value }, `${el.id}.${fieldName}`);

    // Normaliza o nome do evento ao sair do campo.
    if (fieldName === 'name') {
      node.onblur = () => {
        const normalized = toSnakeCase(node.value);
        if (normalized && normalized !== node.value) {
          node.value = normalized;
          mutateEvent(el.id, { name: normalized });
          toast.info('Nome normalizado para snake_case.');
        }
      };
    }
    if (fieldName === 'ticketUrl') {
      node.onblur = () => renderInspector();
    }
  });

  // --- Plataformas (multi-seleção) ---
  host.querySelectorAll('[data-platform-id]').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.dataset.platformId;
      const current = new Set(live().data?.platform || []);
      current.has(id) ? current.delete(id) : current.add(id);
      mutateEvent(el.id, { platform: [...current] });
      btn.setAttribute('aria-pressed', String(current.has(id)));
    };
  });

  // --- Tabelas de parâmetros ---
  host.querySelectorAll('.params').forEach((table) => {
    const scope = table.dataset.scope;

    table.querySelectorAll('.param-row').forEach((row) => {
      const paramId = row.dataset.param;

      row.querySelectorAll('[data-pfield]').forEach((node) => {
        const pField = node.dataset.pfield;

        const patchParam = (patch, coalesceKey) =>
          mutate((doc) => {
            const target = doc.elements.find((e) => e.id === el.id);
            const param = target?.data?.[scope]?.find((p) => p.id === paramId);
            if (param) Object.assign(param, patch);
          }, coalesceKey);

        if (pField === 'delete') {
          node.onclick = () => {
            mutate((doc) => {
              const target = doc.elements.find((e) => e.id === el.id);
              if (target) target.data[scope] = target.data[scope].filter((p) => p.id !== paramId);
            });
            renderInspector();
          };
          return;
        }

        if (pField === 'required') {
          node.onclick = () => {
            const next = node.getAttribute('aria-pressed') !== 'true';
            node.setAttribute('aria-pressed', String(next));
            node.textContent = next ? 'Obrig.' : 'Opc.';
            patchParam({ required: next });
          };
          return;
        }

        if (node.tagName === 'SELECT') {
          node.onchange = () => patchParam({ type: node.value });
          return;
        }

        node.oninput = () => patchParam({ [pField]: node.value }, `${paramId}.${pField}`);

        if (pField === 'name') {
          node.onblur = () => {
            const normalized = toSnakeCase(node.value);
            if (normalized && normalized !== node.value) {
              node.value = normalized;
              patchParam({ name: normalized });
            }
          };
        }
      });
    });
  });

  // --- Ações de escopo ---
  host.querySelectorAll('[data-action="add-param"]').forEach((btn) => {
    btn.onclick = () => {
      mutate((doc) => {
        const target = doc.elements.find((e) => e.id === el.id);
        if (target) target.data[btn.dataset.scope] = [...(target.data[btn.dataset.scope] || []), createParam()];
      });
      renderInspector();
      // Foca o campo recém-criado para o usuário já sair digitando.
      const rows = host.querySelectorAll(
        `.params[data-scope="${btn.dataset.scope}"] .param-row [data-pfield="name"]`,
      );
      rows[rows.length - 1]?.focus();
    };
  });

  host.querySelectorAll('[data-action="normalize"]').forEach((btn) => {
    btn.onclick = () => {
      mutate((doc) => {
        const target = doc.elements.find((e) => e.id === el.id);
        for (const p of target?.data?.[btn.dataset.scope] || []) p.name = toSnakeCase(p.name);
      });
      renderInspector();
      toast.ok('Nomes normalizados.');
    };
  });

  host.querySelector('[data-action="reset-items"]')?.addEventListener('click', async () => {
    if (!(await confirm({
      title: 'Restaurar parâmetros padrão',
      message: 'Os parâmetros atuais de items[] serão substituídos pelo conjunto padrão do GA4. Deseja continuar?',
      confirmText: 'Restaurar',
    }))) return;
    mutate((doc) => {
      const target = doc.elements.find((e) => e.id === el.id);
      if (target) target.data.itemParams = defaultItemParams();
    });
    renderInspector();
  });

  host.querySelectorAll('[data-action="import-group"]').forEach((btn) => {
    btn.onclick = () => openGroupImporter(el, btn.dataset.scope);
  });

  // --- Geradores de código ---
  host.querySelector('[data-action="snippet-datalayer"]')?.addEventListener('click', () =>
    showCode({
      title: 'dataLayer.push',
      subtitle: 'Snippet gerado a partir da especificação deste card.',
      code: buildDataLayerSnippet(getElement(el.id)),
      filename: `${el.data.name || 'evento'}.datalayer.js`,
    }),
  );
  host.querySelector('[data-action="snippet-gtag"]')?.addEventListener('click', () =>
    showCode({
      title: 'gtag()',
      subtitle: 'Equivalente usando a API gtag.js.',
      code: buildGtagSnippet(getElement(el.id)),
      filename: `${el.data.name || 'evento'}.gtag.js`,
    }),
  );
  host.querySelector('[data-action="snippet-schema"]')?.addEventListener('click', () =>
    showCode({
      title: 'JSON Schema',
      subtitle: 'Contrato de coleta para validar payloads em testes automatizados.',
      code: buildJsonSchema(getElement(el.id)),
      filename: `${el.data.name || 'evento'}.schema.json`,
    }),
  );

  host.querySelector('[data-action="toggle-collapse"]')?.addEventListener('click', () => {
    mutate((doc) => {
      const target = doc.elements.find((e) => e.id === el.id);
      if (target) target.collapsed = !target.collapsed;
    });
    renderInspector();
  });

  host.querySelector('[data-action="open-ticket"]')?.addEventListener('click', () => {
    const url = live().data?.ticketUrl;
    if (url) window.open(url, '_blank', 'noopener');
  });
}

/* ========================================================================== */
/* Importador de Grupos de Parametros                                         */
/* ========================================================================== */

/**
 * Regra de negocio central: dois grupos nao podem trazer o mesmo nome de
 * parametro para o mesmo evento, e nenhum grupo pode colidir com um parametro
 * ja existente no card. O modal calcula os conflitos em tempo real e so libera
 * a importacao limpa.
 */
async function openGroupImporter(el, scope) {
  const groups = state.templates || [];

  if (!groups.length) {
    toast.info('Nenhum grupo salvo ainda. Crie um na aba “Grupos de Parâmetros”.');
    return;
  }

  await openModal({
    title: 'Importar grupo de parâmetros',
    subtitle: 'Selecione um ou mais grupos. Conflitos de nome são bloqueados automaticamente.',
    wide: true,
    body: `
      <div id="group-picker">
        ${groups
          .map(
            (g) => `
          <label class="check" style="padding:8px 0;border-bottom:1px solid var(--border)">
            <input type="checkbox" value="${g.id}" />
            <span style="flex:1">
              <strong>${esc(g.name)}</strong>
              <span class="faint" style="font-size:12px"> — ${g.params.length} parâmetro(s)</span>
              ${g.description ? `<div class="field__hint">${esc(g.description)}</div>` : ''}
              <div class="group-card__params" style="margin-top:6px">
                ${g.params.slice(0, 8).map((p) => `<span class="chip">${esc(p.name)}</span>`).join('')}
                ${g.params.length > 8 ? `<span class="chip">+${g.params.length - 8}</span>` : ''}
              </div>
            </span>
          </label>`,
          )
          .join('')}
      </div>
      <div id="conflict-box" style="margin-top:14px"></div>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--ghost" id="import-clean" hidden>Importar apenas os sem conflito</button>
      <button class="btn btn--primary" id="import-ok">Importar</button>`,
    onMount: (root, close) => {
      const box = root.querySelector('#conflict-box');
      const okBtn = root.querySelector('#import-ok');
      const cleanBtn = root.querySelector('#import-clean');
      const existing = new Set((el.data[scope] || []).map((p) => (p.name || '').trim()).filter(Boolean));

      /** Recalcula conflitos a cada mudança de seleção. */
      function analyze() {
        const selectedIds = [...root.querySelectorAll('#group-picker input:checked')].map((i) => i.value);
        const selectedGroups = groups.filter((g) => selectedIds.includes(g.id));

        const seen = new Map();       // nome -> grupos que o declaram
        const conflicts = [];

        for (const g of selectedGroups) {
          for (const p of g.params) {
            const name = (p.name || '').trim();
            if (!name) continue;
            if (existing.has(name)) {
              conflicts.push({ name, reason: 'já existe neste card', group: g.name });
            }
            if (seen.has(name)) {
              conflicts.push({ name, reason: `também está em "${seen.get(name)}"`, group: g.name });
            } else {
              seen.set(name, g.name);
            }
          }
        }

        const blocked = new Set(conflicts.map((c) => c.name));

        if (conflicts.length) {
          box.innerHTML = `
            <div class="card" style="border-color:#FAD2CF;background:var(--danger-bg);padding:14px 16px">
              <strong style="color:var(--danger);font-size:13px">
                ${conflicts.length} conflito(s) de nome — importação bloqueada
              </strong>
              <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px">
                ${[...new Map(conflicts.map((c) => [c.name + c.reason, c])).values()]
                  .map((c) => `<div style="font-size:12px"><code>${esc(c.name)}</code> (${esc(c.group)}) — ${esc(c.reason)}</div>`)
                  .join('')}
              </div>
            </div>`;
          okBtn.disabled = true;
          cleanBtn.hidden = false;
        } else {
          box.innerHTML = selectedGroups.length
            ? `<div class="field__hint" style="color:var(--ok)">✓ ${
                selectedGroups.reduce((n, g) => n + g.params.length, 0)
              } parâmetro(s) prontos para importar, sem conflitos.</div>`
            : '';
          okBtn.disabled = !selectedGroups.length;
          cleanBtn.hidden = true;
        }

        return { selectedGroups, blocked };
      }

      function doImport(skipBlocked) {
        const { selectedGroups, blocked } = analyze();
        const seen = new Set(existing);
        const incoming = [];

        for (const g of selectedGroups) {
          for (const p of g.params) {
            const name = (p.name || '').trim();
            if (!name || seen.has(name)) continue;
            if (skipBlocked && blocked.has(name)) continue;
            seen.add(name);
            incoming.push(createParam({ ...p, id: uid('p') }));
          }
        }

        if (!incoming.length) {
          toast.error('Nada para importar.');
          return;
        }

        mutate((doc) => {
          const target = doc.elements.find((e) => e.id === el.id);
          if (!target) return;
          target.data[scope] = [...(target.data[scope] || []), ...incoming];
          target.data.linkedGroups = [
            ...new Set([...(target.data.linkedGroups || []), ...selectedGroups.map((g) => g.id)]),
          ];
        });

        close(true);
        renderInspector();
        toast.ok(`${incoming.length} parâmetro(s) importado(s).`);
      }

      root.querySelectorAll('#group-picker input').forEach((cb) => (cb.onchange = analyze));
      okBtn.onclick = () => doImport(false);
      cleanBtn.onclick = () => doImport(true);
      analyze();
    },
  });
}

/* ========================================================================== */
/* Demais elementos                                                           */
/* ========================================================================== */

function renderSticky(el) {
  host.innerHTML = `
    ${header('Nota adesiva', 'Sticky note')}
    ${section('sticky', 'Aparência',
      field('Texto', textarea('text', el.text)) +
      field('Cor', swatches(STICKY_COLORS, el.fill, 'fill')) +
      field('Tamanho da fonte',
        `<input class="input" type="number" min="10" max="48" data-field="fontSize" value="${el.fontSize || 14}" />`),
    )}`;
  bindCommonActions(el);
  bindSimpleFields(el, { fontSize: Number });
}

function renderText(el) {
  host.innerHTML = `
    ${header('Texto', 'Caixa de texto')}
    ${section('text', 'Conteúdo e estilo',
      field('Texto', textarea('text', el.text)) +
      `<div class="grid-2">
         ${field('Tamanho', `<input class="input" type="number" min="8" max="96" data-field="fontSize" value="${el.fontSize || 18}" />`)}
         ${field('Estilo',
           `<select class="select" data-field="fontStyle">
              ${['normal', 'bold', 'italic', 'italic bold'].map((s) => `<option value="${s}"${s === el.fontStyle ? ' selected' : ''}>${s}</option>`).join('')}
            </select>`)}
       </div>` +
      field('Alinhamento',
        `<select class="select" data-field="align">
           ${['left', 'center', 'right'].map((a) => `<option value="${a}"${a === el.align ? ' selected' : ''}>${a}</option>`).join('')}
         </select>`) +
      field('Cor', swatches(['#202124', '#5F6368', '#1A73E8', '#D93025', '#188038'], el.fill, 'fill')),
    )}`;
  bindCommonActions(el);
  bindSimpleFields(el, { fontSize: Number });
}

function renderShape(el) {
  host.innerHTML = `
    ${header('Forma', el.type === 'rect' ? 'Retângulo' : 'Círculo')}
    ${section('shape', 'Aparência',
      field('Rótulo interno', input('label', el.label, 'opcional')) +
      field('Preenchimento', swatches(['transparent', ...SHAPE_COLORS], el.fill, 'fill')) +
      field('Cor da borda', swatches(['#5F6368', '#202124', '#1A73E8', '#D93025', '#188038', '#F9AB00'], el.stroke, 'stroke')) +
      `<div class="grid-2">
         ${field('Espessura', `<input class="input" type="number" min="0" max="12" data-field="strokeWidth" value="${el.strokeWidth}" />`)}
         ${el.type === 'rect'
           ? field('Cantos', `<input class="input" type="number" min="0" max="60" data-field="cornerRadius" value="${el.cornerRadius ?? 0}" />`)
           : field('Opacidade', `<input class="input" type="number" min="0.1" max="1" step="0.1" data-field="opacity" value="${el.opacity ?? 1}" />`)}
       </div>` +
      `<div class="grid-2">
         ${field('Largura', `<input class="input" type="number" data-field="width" value="${Math.round(el.width)}" />`)}
         ${field('Altura', `<input class="input" type="number" data-field="height" value="${Math.round(el.height)}" />`)}
       </div>`,
    )}`;
  bindCommonActions(el);
  bindSimpleFields(el, {
    strokeWidth: Number, cornerRadius: Number, opacity: Number, width: Number, height: Number,
  });
}

function renderImage(el) {
  host.innerHTML = `
    ${header('Imagem', 'Print de referência')}
    ${section('image', 'Ajustes',
      `<div class="grid-2">
         ${field('Largura', `<input class="input" type="number" data-field="width" value="${Math.round(el.width)}" />`)}
         ${field('Altura', `<input class="input" type="number" data-field="height" value="${Math.round(el.height)}" />`)}
       </div>` +
      field('Opacidade', `<input class="input" type="number" min="0.1" max="1" step="0.1" data-field="opacity" value="${el.opacity ?? 1}" />`) +
      field('Cantos arredondados', `<input class="input" type="number" min="0" max="40" data-field="cornerRadius" value="${el.cornerRadius ?? 0}" />`) +
      `<div class="field__hint">Arquivo: <code>${esc(el.url)}</code></div>`,
    )}`;
  bindCommonActions(el);
  bindSimpleFields(el, { width: Number, height: Number, opacity: Number, cornerRadius: Number });
}

function renderPin(el) {
  host.innerHTML = `
    ${header('Pin', `Referência ${el.label}`)}
    ${section('pin', 'Marcador',
      field('Rótulo', `<input class="input" data-field="label" value="${esc(el.label ?? '')}" placeholder="1" maxlength="3" autocomplete="off" />`, 'Até 3 caracteres.') +
      field('Cor', swatches(['#EA4335', '#1A73E8', '#34A853', '#FBBC04', '#202124'], el.color, 'color')) +
      field('Nota', textarea('note', el.note, 'O que este ponto da tela representa?')),
    )}
    <div class="section__body">
      <div class="field__hint">
        Use a ferramenta <strong>Conector</strong> para ligar este pin ao card de evento correspondente.
      </div>
    </div>`;
  bindCommonActions(el);
  bindSimpleFields(el);
}

function renderConnector(el) {
  const from = getElement(el.from?.id);
  const to = getElement(el.to?.id);
  const describe = (e) => (!e ? '—' : e.type === 'event' ? e.data?.name : e.type === 'pin' ? `pin ${e.label}` : e.type);

  host.innerHTML = `
    ${header('Conector', `${describe(from)} → ${describe(to)}`)}
    ${section('connector', 'Estilo',
      field('Rótulo', input('label', el.label, 'ex.: dispara')) +
      field('Cor', swatches(['#5F6368', '#202124', '#1A73E8', '#D93025', '#188038'], el.stroke, 'stroke')) +
      `<div class="grid-2">
         ${field('Espessura', `<input class="input" type="number" min="1" max="8" data-field="strokeWidth" value="${el.strokeWidth}" />`)}
         ${field('Traçado',
           `<select class="select" data-field="dash">
              <option value="false"${!el.dash ? ' selected' : ''}>Sólido</option>
              <option value="true"${el.dash ? ' selected' : ''}>Tracejado</option>
            </select>`)}
       </div>` +
      `<label class="check"><input type="checkbox" data-field="arrow" ${el.arrow !== false ? 'checked' : ''} /> Exibir ponta de seta</label>`,
    )}`;
  bindCommonActions(el);
  bindSimpleFields(el, { strokeWidth: Number, dash: (v) => v === 'true' });
}

function renderMultiSelection(selected) {
  const counts = selected.reduce((acc, el) => ({ ...acc, [el.type]: (acc[el.type] || 0) + 1 }), {});

  host.innerHTML = `
    <div class="inspector__head">
      <div class="inspector__type">Seleção múltipla</div>
      <div class="inspector__title"><h3>${selected.length} elementos</h3></div>
      <div class="inspector__actions">
        <button class="btn btn--mini" data-action="duplicate">Duplicar</button>
        <button class="btn btn--mini" data-action="front">Frente</button>
        <button class="btn btn--mini" data-action="back">Trás</button>
        <button class="btn btn--mini" data-action="delete" style="color:var(--vermelho)">Excluir</button>
      </div>
    </div>
    ${section('align', 'Alinhar e distribuir',
      `<div style="display:flex;gap:6px;flex-wrap:wrap">
         <button class="btn btn--mini" data-align="left">Esquerda</button>
         <button class="btn btn--mini" data-align="centerX">Centro V</button>
         <button class="btn btn--mini" data-align="right">Direita</button>
         <button class="btn btn--mini" data-align="top">Topo</button>
         <button class="btn btn--mini" data-align="centerY">Centro H</button>
         <button class="btn btn--mini" data-align="bottom">Base</button>
       </div>
       <div style="display:flex;gap:6px;margin-top:8px">
         <button class="btn btn--mini" data-align="distributeX">Distribuir na horizontal</button>
         <button class="btn btn--mini" data-align="distributeY">Distribuir na vertical</button>
       </div>`)}
    ${section('summary', 'Composição',
      Object.entries(counts).map(([type, n]) => `<div class="issue"><span class="chip">${esc(type)}</span><span>${n}</span></div>`).join(''))}`;

  bindCommonActions(selected[0]);
  bindAlignment(selected);
}

/* ========================================================================== */
/* Bindings compartilhados                                                    */
/* ========================================================================== */

function bindCommonActions(el) {
  host.querySelectorAll('.section__head').forEach((btn) => {
    btn.onclick = () => {
      const wrapper = btn.closest('.section');
      const key = wrapper.dataset.section;
      wrapper.classList.toggle('is-open');
      wrapper.classList.contains('is-open') ? collapsed.delete(key) : collapsed.add(key);
    };
  });

  const actions = {
    duplicate: () => duplicateSelection(),
    delete: () => removeElements(state.selection),
    front: () => reorder('front'),
    back: () => reorder('back'),
  };

  host.querySelectorAll('[data-action]').forEach((btn) => {
    const fn = actions[btn.dataset.action];
    if (fn) btn.addEventListener('click', fn);
  });

  function reorder(direction) {
    const set = new Set(state.selection);
    commit((doc) => {
      const moving = doc.elements.filter((e) => set.has(e.id));
      const rest = doc.elements.filter((e) => !set.has(e.id));
      doc.elements = direction === 'front' ? [...rest, ...moving] : [...moving, ...rest];
    });
  }
}

/** Liga campos `data-field` diretamente a propriedades na raiz do elemento. */
function bindSimpleFields(el, casts = {}) {
  host.querySelectorAll('[data-field]').forEach((node) => {
    const fieldName = node.dataset.field;
    const cast = casts[fieldName] || ((v) => v);

    const apply = (value) =>
      mutate((doc) => {
        const target = doc.elements.find((e) => e.id === el.id);
        if (target) target[fieldName] = value;
      }, `${el.id}.${fieldName}`);

    if (node.type === 'checkbox') {
      node.onchange = () => apply(node.checked);
    } else if (node.tagName === 'SELECT') {
      node.onchange = () => apply(cast(node.value));
    } else {
      node.oninput = () => {
        // Campos numericos vazios ou invalidos nao devem virar 0 — isso faria
        // largura/altura colapsarem e o elemento "sumir" do canvas.
        if (node.type === 'number') {
          if (node.value.trim() === '' || Number.isNaN(Number(node.value))) return;
        }
        apply(cast(node.value));
      };
    }
  });

  host.querySelectorAll('[data-swatch-field]').forEach((group) => {
    const fieldName = group.dataset.swatchField;
    group.querySelectorAll('.swatch').forEach((sw) => {
      sw.onclick = () => {
        group.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', 'false'));
        sw.setAttribute('aria-pressed', 'true');
        mutate((doc) => {
          const target = doc.elements.find((e) => e.id === el.id);
          if (target) target[fieldName] = sw.dataset.color;
        });
      };
    });
  });
}

/** Alinhamento e distribuicao em selecoes multiplas. */
function bindAlignment(selected) {
  host.querySelectorAll('[data-align]').forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.align;
      const ids = selected.filter((el) => el.type !== 'connector').map((el) => el.id);
      if (ids.length < 2) return;

      commit((doc) => {
        const items = doc.elements.filter((e) => ids.includes(e.id));
        const box = (e) => ({ w: e.width || 40, h: e.height || 40 });

        const xs = items.map((e) => e.x);
        const ys = items.map((e) => e.y);
        const rights = items.map((e) => e.x + box(e).w);
        const bottoms = items.map((e) => e.y + box(e).h);

        switch (mode) {
          case 'left': { const v = Math.min(...xs); items.forEach((e) => (e.x = v)); break; }
          case 'right': { const v = Math.max(...rights); items.forEach((e) => (e.x = v - box(e).w)); break; }
          case 'top': { const v = Math.min(...ys); items.forEach((e) => (e.y = v)); break; }
          case 'bottom': { const v = Math.max(...bottoms); items.forEach((e) => (e.y = v - box(e).h)); break; }
          case 'centerX': {
            const c = (Math.min(...xs) + Math.max(...rights)) / 2;
            items.forEach((e) => (e.x = Math.round(c - box(e).w / 2)));
            break;
          }
          case 'centerY': {
            const c = (Math.min(...ys) + Math.max(...bottoms)) / 2;
            items.forEach((e) => (e.y = Math.round(c - box(e).h / 2)));
            break;
          }
          case 'distributeX': {
            const sorted = [...items].sort((a, b) => a.x - b.x);
            const start = sorted[0].x;
            const end = sorted.at(-1).x;
            const step = (end - start) / (sorted.length - 1);
            sorted.forEach((e, i) => (e.x = Math.round(start + step * i)));
            break;
          }
          case 'distributeY': {
            const sorted = [...items].sort((a, b) => a.y - b.y);
            const start = sorted[0].y;
            const end = sorted.at(-1).y;
            const step = (end - start) / (sorted.length - 1);
            sorted.forEach((e, i) => (e.y = Math.round(start + step * i)));
            break;
          }
        }
      });
    };
  });
}

export { centerOn, setSelection };
