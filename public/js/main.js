/**
 * main.js
 * ---------------------------------------------------------------------------
 * Bootstrap da aplicacao: liga o store, o canvas, os paineis e o teclado.
 */

import {
  state, on, loadTree, loadTemplates, setTool, setView, flushSave,
  undo, redo, removeElements, closePage,
} from './store.js';
import {
  initStage, render as renderStage, applyViewport, zoomBy, resetZoom, fitToContent,
  duplicateSelection, selectAll, nudgeSelection, centerOn, isTyping,
} from './canvas/stage.js';
import { copySelection, handlePaste, insertImageFromFile } from './canvas/clipboard.js';
import { initSidebar } from './panels/sidebar.js';
import { initInspector } from './panels/inspector.js';
import { initTemplates } from './panels/templates.js';
import { initDictionary } from './panels/dictionary.js';
import { initSettings } from './panels/settings.js';
import { exportPagePNG, exportTrustFactor } from './panels/exporters.js';
import { validateDoc } from './quality/validation.js';
import { toast } from './ui/toast.js';
import { openModal } from './ui/modal.js';
import { esc, debounce } from './util.js';

/* ========================================================================== */
/* Inicializacao                                                              */
/* ========================================================================== */

async function boot() {
  initStage(document.getElementById('stage-host'));
  initSidebar();
  initInspector();
  initTemplates();
  initDictionary();
  initSettings();

  bindTabs();
  bindToolpad();
  bindTopbar();
  bindPanelToggles();
  bindHistoryButtons();
  bindZoom();
  bindValidationPanel();
  bindKeyboard();
  bindClipboard();
  bindSaveStatus();

  try {
    await Promise.all([loadTree(), loadTemplates()]);
  } catch (err) {
    toast.error(`Falha ao conectar no servidor: ${err.message}`);
  }

  updateEmptyState();
  on('page-opened', ({ doc }) => {
    updateEmptyState();
    if (doc) {
      renderStage();
      applyViewport(doc.viewport);
    }
  });
  // Validar a cada tecla digitada disputaria o frame com o canvas; 250ms
  // depois da última alteração é imperceptível e muito mais leve.
  const scheduleValidation = debounce(refreshValidation, 250);
  on('doc', () => scheduleValidation());
  on('error', (err) => toast.error(err.message));
}

/* ========================================================================== */
/* Abas principais                                                            */
/* ========================================================================== */

function bindTabs() {
  document.querySelectorAll('.topbar .tab').forEach((tab) => {
    tab.onclick = () => {
      const view = tab.dataset.view;
      document.querySelectorAll('.topbar .tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      document.querySelectorAll('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === view));
      setView(view);
    };
  });
}

/* ========================================================================== */
/* Toolpad                                                                    */
/* ========================================================================== */

function bindToolpad() {
  document.querySelectorAll('.tool').forEach((btn) => {
    btn.onclick = () => setTool(btn.dataset.tool);
  });

  on('tool', (tool) => {
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('is-active', b.dataset.tool === tool));
  });

  document.getElementById('file-image').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    for (const file of files) await insertImageFromFile(file);
  });
}

/* ========================================================================== */
/* Topbar                                                                     */
/* ========================================================================== */

function bindTopbar() {
  document.getElementById('btn-export-png').onclick = () => exportPagePNG();
  document.getElementById('btn-export-trust').onclick = () => exportTrustFactor();
  document.getElementById('btn-help').onclick = () => showShortcuts();
}

/* ========================================================================== */
/* Painéis recolhíveis                                                        */
/* ========================================================================== */

const PANELS = {
  sidebar: { class: 'sidebar-collapsed', button: 'btn-toggle-sidebar', storage: 'papyrus.sidebar' },
  inspector: { class: 'inspector-collapsed', button: 'btn-toggle-inspector', storage: 'papyrus.inspector' },
};

export function togglePanel(name, force) {
  const panel = PANELS[name];
  const workspace = document.getElementById('workspace');
  const collapsed = force ?? !workspace.classList.contains(panel.class);

  workspace.classList.toggle(panel.class, collapsed);
  document.getElementById(panel.button).classList.toggle('is-active', collapsed);
  localStorage.setItem(panel.storage, collapsed ? '1' : '0');
}

function bindPanelToggles() {
  for (const name of Object.keys(PANELS)) {
    document.getElementById(PANELS[name].button).onclick = () => togglePanel(name);
    // Restaura o estado da última sessão.
    if (localStorage.getItem(PANELS[name].storage) === '1') togglePanel(name, true);
  }

  // Duplo clique num card de evento reabre o inspetor se estiver recolhido.
  window.addEventListener('papyrus:focus-inspector', () => togglePanel('inspector', false));
}

/* ========================================================================== */
/* Botões de undo/redo                                                        */
/* ========================================================================== */

function bindHistoryButtons() {
  const undoBtn = document.getElementById('btn-undo');
  const redoBtn = document.getElementById('btn-redo');

  undoBtn.onclick = () => undo();
  redoBtn.onclick = () => redo();

  on('history', ({ undo: canUndo, redo: canRedo }) => {
    undoBtn.disabled = !canUndo;
    redoBtn.disabled = !canRedo;
  });
  on('page-opened', () => {
    undoBtn.disabled = true;
    redoBtn.disabled = true;
  });
}

function bindSaveStatus() {
  const node = document.getElementById('save-status');
  const labels = { idle: '—', saving: 'salvando…', saved: 'salvo', error: 'erro ao salvar' };

  on('save-status', (status) => {
    node.dataset.state = status;
    node.textContent = labels[status] || '—';
  });

  // Garante que nada se perca ao fechar a aba.
  window.addEventListener('beforeunload', () => {
    if (state.saveStatus === 'saving') flushSave();
  });
}

/* ========================================================================== */
/* Zoom                                                                       */
/* ========================================================================== */

function bindZoom() {
  document.getElementById('zoom-in').onclick = () => zoomBy(1.2);
  document.getElementById('zoom-out').onclick = () => zoomBy(1 / 1.2);
  document.getElementById('zoom-level').onclick = () => resetZoom();
  document.getElementById('zoom-fit').onclick = () => fitToContent();

  window.addEventListener('papyrus:zoom', (e) => {
    document.getElementById('zoom-level').textContent = `${Math.round(e.detail * 100)}%`;
  });
}

/* ========================================================================== */
/* Painel de validacao                                                        */
/* ========================================================================== */

function bindValidationPanel() {
  const toggle = document.getElementById('validation-toggle');
  const body = document.getElementById('validation-body');

  toggle.onclick = () => {
    body.hidden = !body.hidden;
    if (!body.hidden) refreshValidation();
  };
}

function refreshValidation() {
  const dot = document.getElementById('validation-dot');
  const label = document.getElementById('validation-label');
  const body = document.getElementById('validation-body');

  if (!state.doc) {
    dot.dataset.level = '';
    label.textContent = 'Validação';
    body.innerHTML = '';
    return;
  }

  const { issues, counts } = validateDoc(state.doc);

  dot.dataset.level = counts.error ? 'error' : counts.warn ? 'warn' : '';
  label.textContent = issues.length
    ? `${counts.error} erro(s) · ${counts.warn} aviso(s)`
    : 'Sem problemas';

  if (body.hidden) return;

  body.innerHTML = issues.length
    ? issues
        .slice(0, 80)
        .map(
          (i) => `
        <div class="issue" data-goto="${esc(i.elementId)}">
          <span class="issue__tag" data-level="${i.level}">${i.level === 'error' ? 'erro' : 'aviso'}</span>
          <span>
            ${esc(i.message)}
            <div class="issue__where">${esc(i.where || '')}</div>
          </span>
        </div>`,
        )
        .join('')
    : '<div class="field__hint" style="color:var(--ok);padding:6px">✓ Nenhum problema encontrado nesta página.</div>';

  body.querySelectorAll('[data-goto]').forEach((row) => {
    row.onclick = () => centerOn(row.dataset.goto);
  });
}

/* ========================================================================== */
/* Estado vazio                                                               */
/* ========================================================================== */

function updateEmptyState() {
  document.getElementById('canvas-empty').classList.toggle('is-visible', !state.doc);
}

/* ========================================================================== */
/* Clipboard                                                                  */
/* ========================================================================== */

function bindClipboard() {
  document.addEventListener('paste', (e) => {
    if (state.view !== 'canvas') return;
    handlePaste(e);
  });

  document.addEventListener('copy', (e) => {
    if (state.view !== 'canvas' || isTyping(e) || !state.selection.length) return;
    copySelection();
  });
}

/* ========================================================================== */
/* Atalhos de teclado                                                         */
/* ========================================================================== */

const TOOL_KEYS = {
  v: 'select', h: 'hand', e: 'event', n: 'sticky',
  t: 'text', r: 'rect', o: 'ellipse', p: 'pin', c: 'connector',
};

function bindKeyboard() {
  window.addEventListener('keydown', (e) => {
    if (isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;

    // --- Com modificador ---
    if (mod) {
      switch (e.key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          e.shiftKey ? redo() : undo();
          return;
        case 'y':
          e.preventDefault();
          redo();
          return;
        case 'd':
          e.preventDefault();
          duplicateSelection();
          return;
        case 'a':
          e.preventDefault();
          selectAll();
          return;
        case 's':
          e.preventDefault();
          if (state.doc) flushSave().then(() => toast.ok('Salvo.'));
          return;
        case '=':
        case '+':
          e.preventDefault();
          zoomBy(1.2);
          return;
        case '-':
          e.preventDefault();
          zoomBy(1 / 1.2);
          return;
        case '0':
          e.preventDefault();
          resetZoom();
          return;
        default:
          return;
      }
    }

    if (state.view !== 'canvas') return;

    // --- Sem modificador ---
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selection.length) {
        e.preventDefault();
        removeElements(state.selection);
      }
      return;
    }

    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      e.preventDefault();
      showShortcuts();
      return;
    }

    if (e.key === '[') {
      e.preventDefault();
      togglePanel('sidebar');
      return;
    }
    if (e.key === ']') {
      e.preventDefault();
      togglePanel('inspector');
      return;
    }

    if (e.key === '!' || (e.shiftKey && e.key === '1')) {
      e.preventDefault();
      fitToContent();
      return;
    }

    if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? 10 : 1;
      const map = {
        ArrowUp: [0, -step], ArrowDown: [0, step],
        ArrowLeft: [-step, 0], ArrowRight: [step, 0],
      };
      const [dx, dy] = map[e.key];
      if (state.selection.length) {
        e.preventDefault();
        nudgeSelection(dx, dy);
      }
      return;
    }

    const tool = TOOL_KEYS[e.key.toLowerCase()];
    if (tool) setTool(tool);
  });
}

/* ========================================================================== */
/* Ajuda                                                                      */
/* ========================================================================== */

const SHORTCUTS = [
  ['Selecionar', 'V'], ['Navegar (pan)', 'H ou Espaço'],
  ['Card de evento', 'E'], ['Nota adesiva', 'N'],
  ['Texto', 'T'], ['Retângulo', 'R'],
  ['Círculo', 'O'], ['Pin', 'P'],
  ['Conector', 'C'], ['Colar print / elementos', 'Ctrl + V'],
  ['Copiar seleção', 'Ctrl + C'], ['Duplicar', 'Ctrl + D'],
  ['Desfazer', 'Ctrl + Z'], ['Refazer', 'Ctrl + Shift + Z'],
  ['Selecionar tudo', 'Ctrl + A'], ['Salvar agora', 'Ctrl + S'],
  ['Excluir seleção', 'Delete'], ['Mover 1px / 10px', 'Setas / Shift + Setas'],
  ['Zoom', 'Ctrl + Scroll'], ['Zoom 100%', 'Ctrl + 0'],
  ['Enquadrar conteúdo', 'Shift + 1'], ['Barra lateral', '['],
  ['Inspetor', ']'], ['Esta ajuda', '?'],
];

function showShortcuts() {
  openModal({
    title: 'Atalhos de teclado',
    subtitle: 'Tudo que dá para fazer sem tirar a mão do teclado.',
    wide: true,
    body: `<div class="shortcut-grid">
      ${SHORTCUTS.map(([label, keys]) => `
        <div class="shortcut">
          <span>${esc(label)}</span>
          <span>${keys.split(' ').map((k) => (k === '+' || k === 'ou' || k === '/' ? k : `<kbd>${esc(k)}</kbd>`)).join(' ')}</span>
        </div>`).join('')}
    </div>
    <div class="field__hint" style="margin-top:18px">
      <strong>Fluxo recomendado:</strong> cole o print da tela (Ctrl+V) → marque os pontos de interação com pins (P)
      → crie os cards de evento (E) → conecte pin e card (C) → valide no rodapé → exporte o Trust Factor.
    </div>`,
    footer: `<button class="btn btn--primary" data-close="ok">Fechar</button>`,
  });
}

/* ========================================================================== */

boot();
