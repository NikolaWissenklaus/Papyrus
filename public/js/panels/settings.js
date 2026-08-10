/**
 * panels/settings.js
 * ---------------------------------------------------------------------------
 * Aba "Configurações".
 *
 * Dois blocos:
 *  1. Exportação de imagem — padrões (resolução, formato, fundo, margem) que
 *     pré-preenchem o modal de exportação. Vivem no localStorage do navegador.
 *  2. Google Cloud Storage — bucket, prefixo, project id e service account
 *     colada como JSON em um campo mascarado (tipo senha). A chave privada
 *     nunca volta ao navegador — a API devolve apenas `hasCredential`.
 *
 * Por decisão de segurança, esta tela NÃO exibe nenhuma informação do servidor
 * (caminhos de pasta, sistema operacional, versão do runtime).
 */

import { api } from '../api.js';
import { on } from '../store.js';
import { esc } from '../util.js';
import { toast } from '../ui/toast.js';

let root = null;

/* -------------------------------------------------------------------------- */
/* Padrões de exportação (localStorage)                                       */
/* -------------------------------------------------------------------------- */

const EXPORT_DEFAULTS_KEY = 'papyrus.exportDefaults';

const BASE_EXPORT_DEFAULTS = {
  scale: '3',
  format: 'png',
  background: '#FFFFFF',
  padding: 60,
};

/** Padrões atuais — consumidos pelo modal de exportação de imagem. */
export function getExportDefaults() {
  try {
    return { ...BASE_EXPORT_DEFAULTS, ...JSON.parse(localStorage.getItem(EXPORT_DEFAULTS_KEY) || '{}') };
  } catch {
    return { ...BASE_EXPORT_DEFAULTS };
  }
}

function saveExportDefaults(patch) {
  const next = { ...getExportDefaults(), ...patch };
  localStorage.setItem(EXPORT_DEFAULTS_KEY, JSON.stringify(next));
  return next;
}

/* -------------------------------------------------------------------------- */
/* Init / render                                                              */
/* -------------------------------------------------------------------------- */

export function initSettings() {
  root = document.getElementById('settings-root');
  on('view', (view) => {
    if (view === 'settings') render();
  });
}

async function render() {
  root.innerHTML = `
    <div class="page-head">
      <div>
        <h1>Configurações</h1>
        <p>Preferências da ferramenta e integrações de exportação. As alterações valem para todo o workspace.</p>
      </div>
    </div>
    <div id="settings-body">
      <div class="card" style="text-align:center;color:var(--text-muted)">Carregando…</div>
    </div>`;

  let gcs = null;
  try {
    gcs = await api.getGcsSettings();
  } catch (err) {
    root.querySelector('#settings-body').innerHTML =
      `<div class="card" style="color:var(--danger)">${esc(err.message)}</div>`;
    return;
  }

  const body = root.querySelector('#settings-body');
  body.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      ${exportCard()}
      ${gcsCard(gcs)}
    </div>`;

  bindExportCard(body);
  bindGcsCard(body, gcs);
}

/* -------------------------------------------------------------------------- */
/* 1. Padrões de exportação de imagem                                         */
/* -------------------------------------------------------------------------- */

function exportCard() {
  const def = getExportDefaults();
  const opt = (value, label, current) =>
    `<option value="${value}"${String(value) === String(current) ? ' selected' : ''}>${label}</option>`;

  return `
    <div class="card">
      <h3 style="font-size:16px;margin-bottom:4px">Exportação de imagem</h3>
      <p class="field__hint" style="margin:0 0 16px">
        Valores pré-selecionados ao abrir o exportador de PNG/JPG. Salvos automaticamente neste navegador.
      </p>
      <div class="grid-2" style="max-width:640px">
        <div class="field">
          <label class="field__label">Resolução padrão</label>
          <select class="select" data-export-pref="scale">
            ${opt('2', '2× — apresentação', def.scale)}
            ${opt('3', '3× — alta resolução', def.scale)}
            ${opt('4', '4× — impressão', def.scale)}
          </select>
        </div>
        <div class="field">
          <label class="field__label">Formato padrão</label>
          <select class="select" data-export-pref="format">
            ${opt('png', 'PNG — sem perdas', def.format)}
            ${opt('jpeg', 'JPG — arquivo menor', def.format)}
          </select>
        </div>
        <div class="field">
          <label class="field__label">Fundo padrão</label>
          <select class="select" data-export-pref="background">
            ${opt('#FFFFFF', 'Branco', def.background)}
            ${opt('#F8F9FA', 'Cinza claro', def.background)}
            ${opt('transparent', 'Transparente (só PNG)', def.background)}
          </select>
        </div>
        <div class="field">
          <label class="field__label">Margem padrão (px)</label>
          <input class="input" type="number" min="0" max="300" data-export-pref="padding" value="${def.padding}" />
        </div>
      </div>
    </div>`;
}

function bindExportCard(body) {
  body.querySelectorAll('[data-export-pref]').forEach((node) => {
    node.onchange = () => {
      const key = node.dataset.exportPref;
      const value = key === 'padding' ? Math.max(0, Number(node.value) || 0) : node.value;
      saveExportDefaults({ [key]: value });
      toast.ok('Padrão de exportação salvo.');
    };
  });
}

/* -------------------------------------------------------------------------- */
/* 2. Google Cloud Storage                                                    */
/* -------------------------------------------------------------------------- */

function statusChip(status) {
  if (status.ready) return '<span class="chip chip--interaction">Pronto para publicar</span>';
  if (status.configured) return '<span class="chip chip--warn">Configurado — pacote ausente</span>';
  return '<span class="chip">Não configurado</span>';
}

const envChip = '<span class="chip chip--warn" title="Este valor está sendo definido por variável de ambiente e ignora o que for salvo aqui.">env</span>';

function gcsCard(gcs) {
  const { config, envOverrides, status } = gcs;

  return `
    <div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
        <h3 style="font-size:16px">Exportação — Google Cloud Storage</h3>
        <span id="gcs-status-chip">${statusChip(status)}</span>
      </div>
      <p class="field__hint" style="margin:0 0 16px">
        Publica o Trust Factor (JSON) e as imagens do canvas direto em um bucket.
        ${status.ready ? '' : status.reason ? `<br /><strong>${esc(status.reason)}</strong>` : ''}
      </p>

      <div class="grid-2" style="max-width:640px">
        <div class="field">
          <label class="field__label">Bucket ${envOverrides.bucket ? envChip : ''}</label>
          <input class="input input--mono" id="gcs-bucket" value="${esc(config.bucket)}"
                 placeholder="meu-bucket" ${envOverrides.bucket ? 'disabled' : ''} />
        </div>
        <div class="field">
          <label class="field__label">Prefixo (pasta no bucket) ${envOverrides.prefix ? envChip : ''}</label>
          <input class="input input--mono" id="gcs-prefix" value="${esc(config.prefix)}"
                 placeholder="papyrus/" ${envOverrides.prefix ? 'disabled' : ''} />
        </div>
      </div>

      <div class="grid-2" style="max-width:640px">
        <div class="field">
          <label class="field__label">Project ID (opcional) ${envOverrides.projectId ? envChip : ''}</label>
          <input class="input input--mono" id="gcs-project" value="${esc(config.projectId)}"
                 placeholder="meu-projeto-gcp" ${envOverrides.projectId ? 'disabled' : ''} />
          <div class="field__hint">Se vazio, é lido da própria service account.</div>
        </div>
        <div class="field">
          <label class="field__label">
            Service account (JSON) ${envOverrides.keyFilename ? envChip : ''}
            ${hasKey(config, envOverrides) ? '<span class="chip chip--interaction">credencial salva ✓</span>' : ''}
          </label>
          <input class="input input--mono" type="password" id="gcs-keyjson" spellcheck="false"
                 autocomplete="off" ${envOverrides.keyFilename ? 'disabled' : ''}
                 placeholder="${hasKey(config, envOverrides) ? 'Cole um novo JSON para substituir a credencial' : 'Cole aqui o conteúdo do JSON da service account'}" />
          <div class="field__hint">
            O conteúdo fica mascarado e nunca é exibido de volta: ele é validado e armazenado
            com segurança no servidor. A service account precisa do papel
            <strong>Storage Object Creator</strong> (ou superior) no bucket.
          </div>
        </div>
      </div>

      <div style="display:flex;gap:8px;margin-top:6px;align-items:center;flex-wrap:wrap">
        <button class="btn btn--primary" id="gcs-save">Salvar configuração</button>
        <button class="btn btn--ghost" id="gcs-test">Testar conexão</button>
        ${hasKey(config, envOverrides) && !envOverrides.keyFilename
          ? '<button class="btn btn--mini" id="gcs-remove-key" style="color:var(--danger)">Remover credencial</button>'
          : ''}
        <span id="gcs-test-result" class="field__hint"></span>
      </div>
    </div>`;
}

/** Existe credencial utilizável (salva pela UI ou definida via env)? */
const hasKey = (config, envOverrides) => Boolean(config.hasCredential) || envOverrides.keyFilename;

function bindGcsCard(body, gcs) {
  const value = (id) => body.querySelector(id)?.value?.trim() ?? '';
  const testResult = body.querySelector('#gcs-test-result');

  body.querySelector('#gcs-save').onclick = async () => {
    try {
      const keyJson = value('#gcs-keyjson');
      const saved = await api.saveGcsSettings({
        bucket: value('#gcs-bucket'),
        prefix: value('#gcs-prefix'),
        projectId: value('#gcs-project'),
        // A credencial só viaja quando um novo JSON foi colado; sem isso, a
        // salva anteriormente é preservada no servidor.
        ...(keyJson ? { keyJson } : {}),
      });
      toast.ok('Configuração do Storage salva.');
      body.querySelector('#gcs-status-chip').innerHTML = statusChip(saved.status);
      // Re-renderiza para refletir o estado "credencial salva ✓".
      render();
    } catch (err) {
      toast.error(err.message);
    }
  };

  body.querySelector('#gcs-test').onclick = async () => {
    testResult.textContent = 'Testando…';
    try {
      const result = await api.testGcs();
      testResult.innerHTML = `<span style="color:var(--ok)">✓ Conectado ao bucket <code>${esc(result.bucket)}</code>.</span>`;
      toast.ok('Conexão com o GCS funcionando.');
    } catch (err) {
      testResult.innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`;
    }
  };

  body.querySelector('#gcs-remove-key')?.addEventListener('click', async () => {
    try {
      await api.saveGcsSettings({
        bucket: value('#gcs-bucket'),
        prefix: value('#gcs-prefix'),
        projectId: value('#gcs-project'),
        removeKey: true,
      });
      toast.ok('Credencial removida.');
      render();
    } catch (err) {
      toast.error(err.message);
    }
  });

  // Dica proativa: salvar sem testar é o erro mais comum.
  if (!gcs.status.ready && gcs.status.configured) {
    testResult.textContent = gcs.status.reason || '';
  }
}
