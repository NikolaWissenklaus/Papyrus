/*
 * Navegador da pasta `papyrus`: arvore, busca, CRUD e importacao.
 *
 * JSON que nao tem `"json-type": "papyrus"` na raiz aparece esmaecido e nao
 * abre. Quem valida e o servidor, mas a UI mostra o motivo em vez de deixar a
 * pessoa no escuro.
 */

import { api } from '../api.js';
import { state, loadTree, openPage, closePage, flushSave, on } from '../store.js';
import { esc, formatDate, readFileAsText, normalizeName } from '../util.js';
import { prompt, confirm, contextMenu, openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { DEFAULT_FOLDER_COLOR, FOLDER_COLORS, PAGE_COLOR } from '../constants.js';
import { renewEventIds } from '../models.js';

let treeHost = null;
let searchInput = null;

/** Pastas expandidas (persistidas entre sessoes do navegador). */
const expanded = new Set(readExpanded());

function readExpanded() {
  try {
    return JSON.parse(localStorage.getItem('papyrus.expanded') || '[]');
  } catch {
    return [];
  }
}

/** Pasta destino das criacoes: ultima pasta clicada. */
let activeFolder = '';

export function initSidebar() {
  treeHost = document.getElementById('tree');
  searchInput = document.getElementById('tree-search');

  searchInput.addEventListener('input', () => renderTree());

  document.getElementById('btn-new-folder').onclick = () => createFolder();
  document.getElementById('btn-new-page').onclick = () => createPage();
  document.getElementById('btn-import').onclick = () => startImport();
  document.getElementById('btn-empty-new-page').onclick = () => createPage();

  document.getElementById('file-json').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (files.length) await importInline(files);
  });

  on('tree', () => renderTree());
  on('page-opened', () => renderTree());
}

/* Render */

const FOLDER_ICON = '<svg viewBox="0 0 16 16"><path d="M1.5 3.5h4l1.2 1.5h7.8v7.5a1 1 0 01-1 1h-12a1 1 0 01-1-1z"/></svg>';
const PAGE_ICON = '<svg viewBox="0 0 16 16"><path d="M3.5 1.5h6l3.5 3.5v9a1 1 0 01-1 1h-8.5a1 1 0 01-1-1v-11a1 1 0 011-1z"/></svg>';

export function renderTree() {
  const query = (searchInput?.value || '').trim().toLowerCase();
  const nodes = state.tree || [];

  if (!nodes.length) {
    treeHost.innerHTML = `<div class="tree-empty">
      A pasta <strong>papyrus</strong> está vazia.<br />Crie uma página para começar.
    </div>`;
    return;
  }

  const html = renderNodes(nodes, query, 0);
  treeHost.innerHTML = html || '<div class="tree-empty">Nenhum resultado para a busca.</div>';
  bindNodes();
}

/** Retorna true se o no ou algum descendente casa com a busca. */
function matches(node, query) {
  if (!query) return true;
  if (node.name.toLowerCase().includes(query)) return true;
  return (node.children || []).some((child) => matches(child, query));
}

function renderNodes(nodes, query, depth) {
  return nodes
    .filter((node) => matches(node, query))
    .map((node) => {
      if (node.type === 'folder') {
        // Durante a busca, abre tudo para os resultados aparecerem.
        const isOpen = query ? true : expanded.has(node.path);
        return `
          <div class="tree-node" data-path="${esc(node.path)}" data-type="folder" data-open="${isOpen}">
            <span class="tree-node__caret">${isOpen ? '▾' : '▸'}</span>
            <span class="tree-node__icon" style="color:${esc(node.color || DEFAULT_FOLDER_COLOR)}">${FOLDER_ICON}</span>
            <span class="tree-node__label">${highlight(node.name, query)}</span>
            <button class="tree-node__menu" data-menu>⋯</button>
          </div>
          ${isOpen ? `<div class="tree-children">${renderNodes(node.children || [], query, depth + 1)}</div>` : ''}`;
      }

      const isActive = state.currentPath === node.path;
      return `
        <div class="tree-node${isActive ? ' is-active' : ''}${node.invalid ? ' is-invalid' : ''}"
             data-path="${esc(node.path)}" data-type="page"
             title="${node.invalid ? 'Ignorado: falta a chave \"json-type\": \"papyrus\" na raiz do JSON.' : `Atualizado em ${formatDate(node.updatedAt)}`}">
          <span class="tree-node__caret"></span>
          <span class="tree-node__icon"${node.invalid ? '' : ` style="color:${PAGE_COLOR}"`}>${PAGE_ICON}</span>
          <span class="tree-node__label">${highlight(node.name, query)}</span>
          ${node.invalid ? '<span class="tree-node__badge">ignorado</span>' : node.eventCount ? `<span class="tree-node__badge">${node.eventCount}</span>` : ''}
          <button class="tree-node__menu" data-menu>⋯</button>
        </div>`;
    })
    .join('');
}

function highlight(name, query) {
  if (!query) return esc(name);
  const index = name.toLowerCase().indexOf(query);
  if (index < 0) return esc(name);
  return `${esc(name.slice(0, index))}<mark style="background:#FEEFC3;color:inherit;border-radius:3px">${esc(
    name.slice(index, index + query.length),
  )}</mark>${esc(name.slice(index + query.length))}`;
}

/* Interacao */

function bindNodes() {
  treeHost.querySelectorAll('.tree-node').forEach((node) => {
    const path = node.dataset.path;
    const type = node.dataset.type;

    node.onclick = async (e) => {
      if (e.target.closest('[data-menu]')) return;

      if (type === 'folder') {
        activeFolder = path;
        expanded.has(path) ? expanded.delete(path) : expanded.add(path);
        localStorage.setItem('papyrus.expanded', JSON.stringify([...expanded]));
        renderTree();
        return;
      }

      activeFolder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      await open(path);
    };

    node.querySelector('[data-menu]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = e.target.getBoundingClientRect();
      openNodeMenu(rect.left, rect.bottom + 4, path, type);
    });

    node.oncontextmenu = (e) => {
      e.preventDefault();
      openNodeMenu(e.clientX, e.clientY, path, type);
    };

    // Drag & drop para reorganizar
    node.draggable = true;
    node.ondragstart = (e) => {
      e.dataTransfer.setData('text/papyrus-path', path);
      e.dataTransfer.effectAllowed = 'move';
    };
    if (type === 'folder') {
      node.ondragover = (e) => {
        if (e.dataTransfer.types.includes('text/papyrus-path')) {
          e.preventDefault();
          node.classList.add('is-drop-target');
        }
      };
      node.ondragleave = () => node.classList.remove('is-drop-target');
      node.ondrop = async (e) => {
        e.preventDefault();
        node.classList.remove('is-drop-target');
        const source = e.dataTransfer.getData('text/papyrus-path');
        if (!source || source === path) return;
        try {
          await api.move(source, path);
          await loadTree();
          toast.ok('Movido.');
        } catch (err) {
          toast.error(err.message);
        }
      };
    }
  });
}

function openNodeMenu(x, y, path, type) {
  const items =
    type === 'folder'
      ? [
          { label: 'Nova página aqui', onClick: () => createPage(path) },
          { label: 'Nova subpasta', onClick: () => createFolder(path) },
          { label: 'Importar para esta pasta', onClick: () => startImport(path) },
          '-',
          { label: 'Renomear', onClick: () => rename(path) },
          { label: 'Mudar a cor', onClick: () => changeFolderColor(path) },
          { label: 'Excluir pasta', danger: true, onClick: () => remove(path, 'folder') },
        ]
      : [
          { label: 'Abrir', onClick: () => open(path) },
          { label: 'Duplicar', onClick: () => duplicatePage(path) },
          '-',
          { label: 'Renomear', onClick: () => rename(path) },
          { label: 'Excluir página', danger: true, onClick: () => remove(path, 'page') },
        ];

  contextMenu(x, y, items);
}

/* Operacoes */

async function open(path) {
  try {
    await openPage(path);
  } catch (err) {
    toast.error(err.message);
  }
}

/* Cor da pasta */

/** Paleta usada tanto na criacao quanto na edicao. E o componente do inspetor. */
function colorSwatches(current) {
  return `<div class="swatches" id="folder-color">
    ${FOLDER_COLORS.map(
      (c) => `<button type="button" class="swatch" data-color="${c.value}"
                aria-pressed="${c.value.toUpperCase() === String(current).toUpperCase()}"
                style="background:${c.value}" title="${esc(c.label)}"></button>`,
    ).join('')}
  </div>`;
}

/** Liga os botoes da paleta e devolve um getter da cor selecionada. */
function bindSwatches(modal, initial) {
  let selected = initial;
  const buttons = modal.querySelectorAll('#folder-color .swatch');

  buttons.forEach((swatch) => {
    swatch.onclick = () => {
      buttons.forEach((s) => s.setAttribute('aria-pressed', 'false'));
      swatch.setAttribute('aria-pressed', 'true');
      selected = swatch.dataset.color;
    };
  });

  return () => selected;
}

/** Busca um no na arvore ja carregada (para saber a cor atual da pasta). */
function findNode(nodes, path) {
  for (const node of nodes) {
    if (node.path === path) return node;
    const found = node.children ? findNode(node.children, path) : null;
    if (found) return found;
  }
  return null;
}

async function changeFolderColor(path) {
  const current = findNode(state.tree || [], path)?.color || DEFAULT_FOLDER_COLOR;

  const color = await openModal({
    title: 'Cor da pasta',
    subtitle: path,
    body: `<div class="field">
             <label class="field__label">Escolha a cor</label>
             ${colorSwatches(current)}
           </div>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--primary" id="color-ok">Aplicar</button>`,
    onMount: (modal, close) => {
      const readColor = bindSwatches(modal, current);
      modal.querySelector('#color-ok').onclick = () => close(readColor());
    },
  });
  if (!color) return;

  try {
    await api.setFolderColor(path, color);
    await loadTree();
    toast.ok('Cor da pasta atualizada.');
  } catch (err) {
    toast.error(err.message);
  }
}

/* Nome unico no workspace */

/*
 * Espelho da regra que vale no servidor (server/lib/names.js): dentro de
 * `papyrus` nao existem dois nomes iguais, nem entre paginas, nem entre pastas,
 * nem de uma pasta com uma pagina.
 *
 * O servidor continua sendo a autoridade e recusa de novo o que passar daqui.
 * A copia da regra existe pelo aviso: sem ela o modal fecha, o toast de erro
 * aparece e o nome digitado se perde, que e exatamente o texto que a pessoa
 * precisa ter em maos para corrigir.
 */
function findNameConflict(name, ignorePath = null, nodes = state.tree || []) {
  const key = normalizeName(name);

  for (const node of nodes) {
    if (node.path !== ignorePath && normalizeName(node.name) === key) return node;
    if (node.type === 'folder') {
      const hit = findNameConflict(name, ignorePath, node.children || []);
      if (hit) return hit;
    }
  }
  return null;
}

/** Mensagem do conflito, com o nome e o lugar do que ja existe. */
function conflictMessage(node) {
  const dir = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
  const where = dir ? `na pasta "${dir}"` : 'na raiz do papyrus';
  const what = node.type === 'folder' ? 'uma pasta' : 'uma página';

  return (
    `Já existe ${what} chamada "${node.name}" ${where}. ` +
    'Nomes de páginas e pastas são únicos no workspace inteiro, então escolha outro nome.'
  );
}

/** Devolve a mensagem do problema, ou nada se o nome estiver livre. */
function validateName(name, ignorePath = null) {
  const hit = findNameConflict(name, ignorePath);
  return hit ? conflictMessage(hit) : null;
}

/**
 * Primeiro nome livre para uma copia: "X (cópia)", depois "X (cópia 2)".
 * A sugestao ja nasce valida para duplicar continuar sendo um clique e um
 * Enter, mesmo com a regra de nome unico no caminho.
 */
function suggestCopyName(baseName) {
  const first = `${baseName} (cópia)`;
  if (!findNameConflict(first)) return first;

  for (let i = 2; i < 500; i += 1) {
    const candidate = `${baseName} (cópia ${i})`;
    if (!findNameConflict(candidate)) return candidate;
  }
  return first;
}

async function createFolder(parent = activeFolder) {
  const result = await openModal({
    title: 'Nova pasta',
    subtitle: parent ? `Dentro de: ${parent}` : 'Na raiz do papyrus',
    body: `
      <div class="field">
        <label class="field__label">Nome da pasta</label>
        <input class="input" id="folder-name" autocomplete="off" />
        <div class="field__hint" id="folder-error" style="color:var(--danger)" hidden></div>
      </div>
      <div class="field">
        <label class="field__label">Cor</label>
        ${colorSwatches(DEFAULT_FOLDER_COLOR)}
        <div class="field__hint">Dá para mudar depois pelo menu da pasta.</div>
      </div>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--primary" id="folder-ok">Criar</button>`,
    onMount: (modal, close) => {
      const input = modal.querySelector('#folder-name');
      const readColor = bindSwatches(modal, DEFAULT_FOLDER_COLOR);

      const error = modal.querySelector('#folder-error');

      const submit = () => {
        const name = input.value.trim();
        if (!name) return;

        const problem = validateName(name);
        if (problem) {
          error.textContent = problem;
          error.hidden = false;
          input.focus();
          input.select();
          return;
        }
        close({ name, color: readColor() });
      };

      input.focus();
      input.oninput = () => {
        error.hidden = true;
      };
      input.onkeydown = (e) => {
        if (e.key === 'Enter') submit();
      };
      modal.querySelector('#folder-ok').onclick = submit;
    },
  });
  if (!result) return;

  try {
    const folder = await api.createFolder(parent, result.name, result.color);
    expanded.add(folder.path);
    await loadTree();
    toast.ok(`Pasta "${folder.name}" criada.`);
  } catch (err) {
    toast.error(err.message);
  }
}

async function createPage(parent = activeFolder) {
  const name = await prompt({
    title: 'Nova página de canvas',
    subtitle: parent ? `Dentro de: ${parent}` : 'Na raiz do papyrus',
    label: 'Nome da página (ex.: PDP, Checkout, Home)',
    validate: (value) => validateName(value),
  });
  if (!name) return;

  try {
    const page = await api.createPage(parent, name);
    if (parent) expanded.add(parent);
    await loadTree();
    await openPage(page.path);
    toast.ok(`Página "${page.name}" criada.`);
  } catch (err) {
    toast.error(err.message);
  }
}

async function rename(path) {
  const current = path.split('/').pop().replace(/\.json$/i, '');
  const name = await prompt({
    title: 'Renomear',
    label: 'Novo nome',
    value: current,
    confirmText: 'Renomear',
    // O proprio item nao conflita consigo mesmo: so a caixa da letra pode mudar.
    validate: (value) => validateName(value, path),
  });
  if (!name || name === current) return;

  try {
    const wasOpen = state.currentPath === path;
    if (wasOpen) await flushSave();

    const result = await api.rename(path, name);
    await loadTree();
    if (wasOpen) {
      closePage();
      await openPage(result.path);
    }
    toast.ok('Renomeado.');
  } catch (err) {
    toast.error(err.message);
  }
}

async function remove(path, type) {
  const label = type === 'folder' ? 'a pasta' : 'a página';
  const ok = await confirm({
    title: `Excluir ${type === 'folder' ? 'pasta' : 'página'}`,
    message:
      type === 'folder'
        ? `Excluir ${label} "${path}" apagará TODO o seu conteúdo, incluindo subpastas e páginas. Esta ação não pode ser desfeita.`
        : `Excluir ${label} "${path}"? Esta ação não pode ser desfeita.`,
  });
  if (!ok) return;

  try {
    await api.remove(path);
    if (state.currentPath === path || state.currentPath?.startsWith(`${path}/`)) closePage();
    await loadTree();
    toast.ok('Excluído.');
  } catch (err) {
    toast.error(err.message);
  }
}

async function duplicatePage(path) {
  try {
    const { doc } = await api.readPage(path);
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const baseName = path.split('/').pop().replace(/\.json$/i, '');

    // A copia precisa de nome proprio, ja que nome se repetir e proibido. A
    // sugestao ja vem livre, entao o caminho comum continua sendo confirmar.
    const chosen = await prompt({
      title: 'Duplicar página',
      subtitle: `Cópia de "${baseName}"`,
      label: 'Nome da nova página',
      value: suggestCopyName(baseName),
      confirmText: 'Duplicar',
      validate: (value) => validateName(value),
    });
    if (!chosen) return;

    const page = await api.createPage(parent, chosen);

    // Os cards da copia sao cards novos, e cada um precisa do proprio event_id.
    // A pasta vem do destino, que nem sempre e a da pagina aberta no canvas.
    renewEventIds(doc.elements || [], parent ? parent.split('/').pop() : '');

    await api.savePage(page.path, { ...doc, id: crypto.randomUUID(), name: page.name });
    await loadTree();
    toast.ok('Página duplicada.');
  } catch (err) {
    toast.error(err.message);
  }
}

/* Importacao */

/*
 * A importacao acontece so por upload pelo navegador. A UI nunca navega nem
 * exibe pastas da maquina onde o servidor roda.
 */

/** Pasta de destino do upload em andamento (setada pelo menu de contexto). */
let importDestination = '';

function startImport(destination = activeFolder) {
  importDestination = destination;
  document.getElementById('file-json').click();
}

async function importInline(files) {
  try {
    const payload = await Promise.all(
      files.map(async (f) => ({ name: f.name, content: await readFileAsText(f) })),
    );
    const report = await api.importInline(payload, importDestination);
    await loadTree();
    reportImport(report);
  } catch (err) {
    toast.error(err.message);
  }
}

function reportImport(report) {
  const imported = report.imported?.length || 0;
  const ignored = report.ignored?.length || 0;

  if (imported) toast.ok(`${imported} página(s) importada(s).`);
  if (!imported && !ignored) toast.info('Nada foi importado.');

  if (ignored) {
    openModal({
      title: 'Arquivos ignorados',
      subtitle: `${ignored} arquivo(s) não foram importados.`,
      body: report.ignored
        .map(
          (i) => `<div class="issue">
                    <span class="issue__tag" data-level="warn">ignorado</span>
                    <span><code>${esc(i.file)}</code><div class="issue__where">${esc(i.reason)}</div></span>
                  </div>`,
        )
        .join(''),
      footer: `<button class="btn btn--primary" data-close="ok">Entendi</button>`,
    });
  }
}
