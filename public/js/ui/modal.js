/**
 * ui/modal.js
 * ---------------------------------------------------------------------------
 * Camada de dialogos da aplicacao. Todos os modais sao promise-based:
 *   const nome = await prompt({ title: 'Nova pasta' });   // string | null
 */

import { esc } from '../util.js';

const layer = () => document.getElementById('modal-layer');

/**
 * Modal generico e EMPILHAVEL: cada chamada cria o proprio backdrop, entao um
 * modal pode abrir outro sem que o de baixo seja destruido.
 *
 * @returns {Promise<any>} valor passado para close(), ou null se cancelado.
 */
export function openModal({ title, subtitle, body, footer, wide = false, onMount }) {
  return new Promise((resolve) => {
    const host = layer();
    host.hidden = false;

    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.innerHTML = `
      <div class="modal${wide ? ' modal--wide' : ''}" role="dialog" aria-modal="true">
        <div class="modal__head">
          <h3>${esc(title)}</h3>
          ${subtitle ? `<p>${esc(subtitle)}</p>` : ''}
        </div>
        <div class="modal__body">${body || ''}</div>
        ${footer ? `<div class="modal__foot">${footer}</div>` : ''}
      </div>`;
    host.appendChild(backdrop);

    const close = (value = null) => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (!host.children.length) host.hidden = true;
      resolve(value);
    };

    const onKey = (e) => {
      // Só o modal do topo da pilha reage ao Escape.
      if (e.key === 'Escape' && backdrop === host.lastElementChild) {
        e.stopPropagation();
        close(null);
      }
    };
    document.addEventListener('keydown', onKey, true);

    backdrop.onmousedown = (e) => {
      if (e.target === backdrop) close(null);
    };

    backdrop.querySelectorAll('[data-close]').forEach((btn) => {
      btn.onclick = () => close(btn.dataset.close === 'null' ? null : btn.dataset.close);
    });

    onMount?.(backdrop.querySelector('.modal'), close);
  });
}

/** Caixa de texto simples. */
export function prompt({ title, subtitle, label = 'Nome', value = '', confirmText = 'Criar' }) {
  return openModal({
    title,
    subtitle,
    body: `
      <div class="field">
        <label class="field__label">${esc(label)}</label>
        <input class="input" id="prompt-input" value="${esc(value)}" autocomplete="off" />
      </div>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--primary" id="prompt-ok">${esc(confirmText)}</button>`,
    onMount: (root, close) => {
      const input = root.querySelector('#prompt-input');
      const submit = () => {
        const v = input.value.trim();
        if (v) close(v);
      };
      input.focus();
      input.select();
      input.onkeydown = (e) => {
        if (e.key === 'Enter') submit();
      };
      root.querySelector('#prompt-ok').onclick = submit;
    },
  });
}

/** Confirmacao destrutiva. */
export function confirm({ title, message, confirmText = 'Excluir', danger = true }) {
  return openModal({
    title,
    body: `<p style="font-size:13.5px;line-height:1.6;color:var(--text-muted);margin:0 0 4px">${esc(message)}</p>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-close="yes">${esc(confirmText)}</button>`,
  }).then((v) => v === 'yes');
}

/** Exibe um bloco de codigo com acoes de copiar/baixar. */
export function showCode({ title, subtitle, code, filename }) {
  return openModal({
    title,
    subtitle,
    wide: true,
    body: `
      <pre class="code" id="code-block">${esc(code)}</pre>
      <div class="code-actions">
        <button class="btn btn--ghost" id="code-download">Baixar .js</button>
        <button class="btn btn--primary" id="code-copy">Copiar</button>
      </div>`,
    footer: `<button class="btn btn--ghost" data-close="null">Fechar</button>`,
    onMount: (root) => {
      root.querySelector('#code-copy').onclick = async () => {
        const { copyToClipboard } = await import('../util.js');
        const { toast } = await import('./toast.js');
        await copyToClipboard(code);
        toast.ok('Snippet copiado.');
      };
      root.querySelector('#code-download').onclick = async () => {
        const { downloadBlob } = await import('../util.js');
        downloadBlob(new Blob([code], { type: 'text/javascript' }), filename || 'snippet.js');
      };
    },
  });
}

/*
 * Nota: o antigo `pickPath` (navegador de diretorios do SO) foi removido de
 * proposito — a ferramenta nao exibe nem navega pastas do servidor.
 */

/** Menu de contexto ancorado em coordenadas de tela. */
export function contextMenu(x, y, items) {
  document.querySelector('.ctx-menu')?.remove();

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = items
    .map((item) =>
      item === '-'
        ? '<div class="ctx-sep"></div>'
        : `<button class="ctx-item${item.danger ? ' ctx-item--danger' : ''}">${esc(item.label)}</button>`,
    )
    .join('');

  document.body.appendChild(menu);

  // Mantem o menu dentro da viewport.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(y, window.innerHeight - rect.height - 8)}px`;

  const actionable = items.filter((i) => i !== '-');
  menu.querySelectorAll('.ctx-item').forEach((btn, i) => {
    btn.onclick = () => {
      menu.remove();
      actionable[i].onClick?.();
    };
  });

  const dismiss = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('mousedown', dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', dismiss, true), 0);
}
