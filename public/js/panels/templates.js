/*
 * Aba "Grupos de Parametros".
 *
 * Um grupo e um conjunto nomeado de parametros que se repetem, do tipo
 * "Contexto de Pagina", "Identificacao do Usuario" ou "Dados do Produto". O
 * card de evento importa o grupo inteiro, e e assim que o mesmo parametro
 * mantem nome e tipo iguais no workspace todo.
 */

import { state, loadTemplates, saveTemplates, newTemplateGroup, on } from '../store.js';
import { PARAM_TYPES, PARAM_SCOPES } from '../constants.js';
import { createParam } from '../models.js';
import { esc, uid, toSnakeCase, copyToClipboard } from '../util.js';
import { prompt, confirm, openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';

let root = null;

export function initTemplates() {
  root = document.getElementById('templates-root');
  on('templates', () => render());
  on('view', (view) => view === 'templates' && render());
}

function render() {
  const groups = state.templates || [];
  const totalParams = groups.reduce((n, g) => n + g.params.length, 0);

  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Grupos de Parâmetros</h1>
        <p>
          Blocos reutilizáveis de parâmetros. Ao importar um grupo em um card de evento,
          o Papyrus bloqueia automaticamente conflitos de nome entre grupos e com os
          parâmetros já declarados no card.
        </p>
      </div>
      <button class="btn btn--primary" id="new-group">+ Novo grupo</button>
    </div>

    <div class="stat-row">
      <div class="stat"><div class="stat__value">${groups.length}</div><div class="stat__label">Grupos salvos</div></div>
      <div class="stat"><div class="stat__value">${totalParams}</div><div class="stat__label">Parâmetros no total</div></div>
      <div class="stat"><div class="stat__value">${new Set(groups.flatMap((g) => g.params.map((p) => p.name))).size}</div><div class="stat__label">Nomes únicos</div></div>
    </div>

    ${
      groups.length
        ? `<div class="group-list">${groups.map(groupCard).join('')}</div>`
        : `<div class="card" style="text-align:center;padding:56px 24px;color:var(--text-muted)">
             <h3 style="margin-bottom:6px">Nenhum grupo criado</h3>
             <p style="font-size:13px;margin:0 0 16px">
               Comece por um conjunto que se repete em quase todo evento, como contexto de página.
             </p>
             <button class="btn btn--primary" id="new-group-empty">Criar primeiro grupo</button>
           </div>`
    }`;

  root.querySelector('#new-group')?.addEventListener('click', createGroup);
  root.querySelector('#new-group-empty')?.addEventListener('click', createGroup);

  root.querySelectorAll('[data-edit]').forEach((btn) => {
    btn.onclick = () => editGroup(btn.dataset.edit);
  });
  root.querySelectorAll('[data-duplicate]').forEach((btn) => {
    btn.onclick = () => duplicateGroup(btn.dataset.duplicate);
  });
  root.querySelectorAll('[data-delete]').forEach((btn) => {
    btn.onclick = () => deleteGroup(btn.dataset.delete);
  });
  root.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.onclick = async () => {
      const group = groups.find((g) => g.id === btn.dataset.copy);
      await copyToClipboard(JSON.stringify(group.params.map(({ name, type, required }) => ({ name, type, required })), null, 2));
      toast.ok('Parâmetros copiados como JSON.');
    };
  });
}

const groupCard = (g) => `
  <div class="group-card">
    <div class="group-card__head">
      <h4>${esc(g.name)}</h4>
      <span class="chip">${g.params.length}</span>
    </div>
    ${g.description ? `<div class="field__hint" style="margin:0">${esc(g.description)}</div>` : ''}
    <div class="group-card__params">
      ${g.params.slice(0, 10).map((p) => `<span class="chip" title="${esc(p.type)}${p.required ? ' · obrigatório' : ''}">${esc(p.name || '—')}${p.required ? ' *' : ''}</span>`).join('')}
      ${g.params.length > 10 ? `<span class="chip">+${g.params.length - 10}</span>` : ''}
      ${!g.params.length ? '<span class="faint" style="font-size:12px">Sem parâmetros</span>' : ''}
    </div>
    <div class="group-card__foot">
      <button class="btn btn--mini" data-edit="${g.id}">Editar</button>
      <button class="btn btn--mini" data-duplicate="${g.id}">Duplicar</button>
      <button class="btn btn--mini" data-copy="${g.id}">Copiar JSON</button>
      <button class="btn btn--mini" data-delete="${g.id}" style="margin-left:auto;color:var(--vermelho)">Excluir</button>
    </div>
  </div>`;

/* Operacoes */

async function createGroup() {
  const name = await prompt({
    title: 'Novo grupo de parâmetros',
    label: 'Nome do grupo',
    subtitle: 'Ex.: Contexto de Página, Identificação do Usuário, Dados do Produto',
  });
  if (!name) return;

  const group = newTemplateGroup(name);
  group.params = [createParam()];
  await saveTemplates([...(state.templates || []), group]);
  editGroup(group.id);
}

async function duplicateGroup(id) {
  const source = state.templates.find((g) => g.id === id);
  if (!source) return;

  const copy = {
    ...structuredClone(source),
    id: uid('grp'),
    name: `${source.name} (cópia)`,
    params: source.params.map((p) => ({ ...p, id: uid('p') })),
  };
  await saveTemplates([...state.templates, copy]);
  toast.ok('Grupo duplicado.');
}

async function deleteGroup(id) {
  const group = state.templates.find((g) => g.id === id);
  const ok = await confirm({
    title: 'Excluir grupo',
    message: `Excluir "${group?.name}"? Cards de evento que já importaram estes parâmetros não são afetados.`,
  });
  if (!ok) return;

  await saveTemplates(state.templates.filter((g) => g.id !== id));
  toast.ok('Grupo excluído.');
}

/**
 * Editor do grupo. Trabalha sobre uma copia local e so grava ao salvar, entao
 * dar cancelar nao suja o arquivo.
 */
async function editGroup(id) {
  const original = state.templates.find((g) => g.id === id);
  if (!original) return;

  const draft = structuredClone(original);

  await openModal({
    title: 'Editar grupo',
    subtitle: 'Os parâmetros abaixo serão inseridos em bloco nos cards de evento.',
    wide: true,
    body: `
      <div class="grid-2">
        <div class="field">
          <label class="field__label">Nome do grupo</label>
          <input class="input" id="g-name" value="${esc(draft.name)}" />
        </div>
        <div class="field">
          <label class="field__label">Escopo sugerido</label>
          <select class="select" id="g-scope">
            ${Object.entries(PARAM_SCOPES)
              .map(([k, v]) => `<option value="${k}"${k === draft.scope ? ' selected' : ''}>${v}</option>`)
              .join('')}
          </select>
        </div>
      </div>
      <div class="field">
        <label class="field__label">Descrição</label>
        <input class="input" id="g-desc" value="${esc(draft.description || '')}" placeholder="Quando usar este grupo?" />
      </div>
      <div class="field__label" style="margin-top:8px">Parâmetros</div>
      <div id="g-params"></div>
      <button class="btn btn--mini" id="g-add" style="margin-top:10px">+ Parâmetro</button>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--primary" id="g-save">Salvar grupo</button>`,
    onMount: (modal, close) => {
      const listHost = modal.querySelector('#g-params');

      function renderParams() {
        listHost.innerHTML = `
          <div class="params">
            <div class="params__head"><span>Parâmetro</span><span>Tipo</span><span>Obrig.</span><span></span></div>
            ${draft.params
              .map(
                (p) => `
              <div class="param-row" data-param="${p.id}">
                <input class="input input--mono" data-pfield="name" value="${esc(p.name)}" placeholder="nome_do_parametro" />
                <select class="select" data-pfield="type">
                  ${PARAM_TYPES.map((t) => `<option value="${t}"${t === p.type ? ' selected' : ''}>${t}</option>`).join('')}
                </select>
                <button class="toggle" data-pfield="required" aria-pressed="${Boolean(p.required)}">${p.required ? 'Obrig.' : 'Opc.'}</button>
                <button class="param-row__del" data-pfield="delete">×</button>
                <div class="param-row__extra">
                  <input class="input" data-pfield="example" value="${esc(p.example || '')}" placeholder="valor de exemplo" />
                </div>
              </div>`,
              )
              .join('') || '<div class="field__hint">Nenhum parâmetro ainda.</div>'}
          </div>`;

        listHost.querySelectorAll('.param-row').forEach((row) => {
          const param = draft.params.find((p) => p.id === row.dataset.param);

          row.querySelectorAll('[data-pfield]').forEach((node) => {
            const f = node.dataset.pfield;
            if (f === 'delete') {
              node.onclick = () => {
                draft.params = draft.params.filter((p) => p.id !== param.id);
                renderParams();
              };
            } else if (f === 'required') {
              node.onclick = () => {
                param.required = !param.required;
                node.setAttribute('aria-pressed', String(param.required));
                node.textContent = param.required ? 'Obrig.' : 'Opc.';
              };
            } else if (node.tagName === 'SELECT') {
              node.onchange = () => (param.type = node.value);
            } else {
              node.oninput = () => (param[f] = node.value);
              if (f === 'name') {
                node.onblur = () => {
                  const normalized = toSnakeCase(node.value);
                  if (normalized && normalized !== node.value) {
                    node.value = normalized;
                    param.name = normalized;
                  }
                };
              }
            }
          });
        });
      }

      modal.querySelector('#g-add').onclick = () => {
        draft.params.push(createParam());
        renderParams();
        listHost.querySelector('.param-row:last-of-type [data-pfield="name"]')?.focus();
      };

      modal.querySelector('#g-save').onclick = async () => {
        draft.name = modal.querySelector('#g-name').value.trim() || draft.name;
        draft.scope = modal.querySelector('#g-scope').value;
        draft.description = modal.querySelector('#g-desc').value.trim();
        draft.params = draft.params.filter((p) => p.name?.trim());

        // Nome repetido dentro do proprio grupo deixaria a importacao invalida.
        const names = draft.params.map((p) => p.name);
        const duplicated = names.filter((n, i) => names.indexOf(n) !== i);
        if (duplicated.length) {
          toast.error(`Parâmetro duplicado no grupo: ${[...new Set(duplicated)].join(', ')}`);
          return;
        }

        await saveTemplates(state.templates.map((g) => (g.id === draft.id ? draft : g)));
        close(true);
        toast.ok('Grupo salvo.');
      };

      renderParams();
    },
  });
}

export { loadTemplates };
