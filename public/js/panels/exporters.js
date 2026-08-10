/**
 * panels/exporters.js
 * ---------------------------------------------------------------------------
 * Exportacao visual (PNG/JPG de alta resolucao) e exportacao "Trust Factor".
 *
 * Trust Factor: JSON que contem SOMENTE regra de negocio — nome da pagina como
 * chave raiz e um array de eventos tipados como valor. Nenhuma coordenada, cor
 * ou elemento visual entra no arquivo. E o artefato que vai para o repositorio
 * do time de engenharia e serve de contrato de coleta.
 *
 * Destinos suportados: download pelo navegador e bucket do Google Cloud
 * Storage (quando configurado — ver server/lib/gcs.js). Não existe gravação
 * em pasta do disco: a UI não expõe nada do filesystem do servidor.
 */

import { api } from '../api.js';
import { state, flushSave } from '../store.js';
import { esc, downloadBlob } from '../util.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { exportPNG } from '../canvas/stage.js';
import { validateDoc } from '../quality/validation.js';
import { getExportDefaults } from './settings.js';

/** Consulta o status do GCS sem quebrar a UI se o servidor falhar. */
async function safeGcsStatus() {
  try {
    return await api.gcsStatus();
  } catch {
    return { configured: false, ready: false, reason: null };
  }
}

/** Bloco de opcao "Google Cloud Storage" reutilizado nos dois exportadores. */
function gcsOptionHtml(status, inputName) {
  const disabled = status.ready ? '' : 'disabled';
  const hint = status.ready
    ? `Bucket: <code>${esc(status.bucket)}</code>${status.prefix ? ` · prefixo <code>${esc(status.prefix)}</code>` : ''}`
    : esc(status.reason || 'Não configurado.');

  return `
    <label class="check" style="align-items:flex-start">
      <input type="radio" name="${inputName}" value="gcs" ${disabled} style="margin-top:2px" />
      <span>
        Google Cloud Storage ${status.ready ? '' : '<span class="chip chip--warn" style="margin-left:4px">não configurado</span>'}
        <div class="field__hint" style="margin-top:2px">${hint}</div>
      </span>
    </label>`;
}

/* -------------------------------------------------------------------------- */
/* PNG / JPG                                                                  */
/* -------------------------------------------------------------------------- */

export async function exportPagePNG() {
  if (!state.doc) {
    toast.error('Abra uma página antes de exportar.');
    return;
  }

  const gcs = await safeGcsStatus();
  const hasSelection = state.selection.length > 0;

  // Pré-preenche com os padrões definidos na aba Configurações.
  const def = getExportDefaults();
  const sel = (value, current) => (String(value) === String(current) ? ' selected' : '');

  const options = await openModal({
    title: 'Exportar imagem do canvas',
    subtitle: 'A imagem é recortada no conteúdo — sem áreas vazias sobrando.',
    body: `
      <div class="grid-2">
        <div class="field">
          <label class="field__label">Resolução</label>
          <select class="select" id="png-scale">
            <option value="2"${sel(2, def.scale)}>2× — apresentação</option>
            <option value="3"${sel(3, def.scale)}>3× — alta resolução (recomendado)</option>
            <option value="4"${sel(4, def.scale)}>4× — impressão</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label">Formato</label>
          <select class="select" id="png-format">
            <option value="png"${sel('png', def.format)}>PNG — sem perdas</option>
            <option value="jpeg"${sel('jpeg', def.format)}>JPG — arquivo menor</option>
          </select>
        </div>
      </div>
      <div class="grid-2">
        <div class="field">
          <label class="field__label">Fundo</label>
          <select class="select" id="png-bg">
            <option value="#FFFFFF"${sel('#FFFFFF', def.background)}>Branco</option>
            <option value="#F8F9FA"${sel('#F8F9FA', def.background)}>Cinza claro</option>
            <option value="transparent"${sel('transparent', def.background)}>Transparente (só PNG)</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label">Margem (px)</label>
          <input class="input" type="number" id="png-pad" value="${Number(def.padding) || 0}" min="0" max="300" />
        </div>
      </div>
      ${
        hasSelection
          ? `<label class="check"><input type="checkbox" id="png-selection" />
               Exportar apenas a seleção atual (${state.selection.length} elemento(s))</label>`
          : ''
      }
      <div class="field" style="margin-top:10px">
        <label class="field__label">Destino</label>
        <label class="check"><input type="radio" name="png-dest" value="download" checked /> Download pelo navegador</label>
        ${gcsOptionHtml(gcs, 'png-dest')}
      </div>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--primary" id="png-go">Exportar</button>`,
    // Os valores precisam ser lidos ANTES de fechar o modal — depois do close()
    // o DOM do dialogo ja nao existe mais.
    onMount: (modal, close) => {
      const formatSelect = modal.querySelector('#png-format');
      const bgSelect = modal.querySelector('#png-bg');

      // JPG nao tem canal alfa — fundo transparente viraria preto.
      formatSelect.onchange = () => {
        const transparentOption = bgSelect.querySelector('option[value="transparent"]');
        transparentOption.disabled = formatSelect.value === 'jpeg';
        if (formatSelect.value === 'jpeg' && bgSelect.value === 'transparent') {
          bgSelect.value = '#FFFFFF';
        }
      };
      // Aplica a regra tambem ao estado inicial (padroes podem vir como JPG).
      formatSelect.onchange();

      modal.querySelector('#png-go').onclick = () =>
        close({
          scale: Number(modal.querySelector('#png-scale').value) || 3,
          format: formatSelect.value,
          background: bgSelect.value,
          padding: Number(modal.querySelector('#png-pad').value) || 0,
          onlySelection: Boolean(modal.querySelector('#png-selection')?.checked),
          destination: modal.querySelector('input[name="png-dest"]:checked')?.value || 'download',
        });
    },
  });

  if (!options) return;

  const isJpeg = options.format === 'jpeg';
  const dataUrl = exportPNG({
    pixelRatio: options.scale,
    padding: options.padding,
    background:
      options.background === 'transparent' ? (isJpeg ? '#FFFFFF' : null) : options.background,
    mimeType: isJpeg ? 'image/jpeg' : 'image/png',
    quality: 0.92,
    onlySelection: options.onlySelection,
  });
  if (!dataUrl) return;

  const ext = isJpeg ? 'jpg' : 'png';
  const filename = `${sanitize(state.doc.name)}-${options.scale}x.${ext}`;

  if (options.destination === 'gcs') {
    try {
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      const { gcs: uploaded } = await api.exportGcs({
        filename,
        contentType: isJpeg ? 'image/jpeg' : 'image/png',
        dataBase64: base64,
      });
      toast.ok(`Imagem publicada em ${uploaded.gsUri}`);
    } catch (err) {
      toast.error(err.message);
    }
    return;
  }

  const blob = await (await fetch(dataUrl)).blob();
  downloadBlob(blob, filename);
  toast.ok('Imagem exportada.');
}

/* -------------------------------------------------------------------------- */
/* Trust Factor                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {string[]|null} presetPaths quando informado, exporta exatamente essas paginas
 */
export async function exportTrustFactor(presetPaths = null) {
  await flushSave();

  // Aviso preventivo: exportar um mapa com erros de nomenclatura vira retrabalho.
  const issues = state.doc ? validateDoc(state.doc).counts : { error: 0, warn: 0 };
  const gcs = await safeGcsStatus();

  const result = await openModal({
    title: 'Exportar Trust Factor',
    subtitle: 'JSON com as regras de negócio — sem coordenadas, cores ou elementos visuais.',
    wide: true,
    body: `
      ${
        !presetPaths && issues.error
          ? `<div class="card" style="border-color:#FAD2CF;background:var(--danger-bg);margin-bottom:14px;padding:12px 16px">
               <strong style="color:var(--danger);font-size:13px">${issues.error} erro(s) de validação na página atual</strong>
               <div class="field__hint" style="margin-top:2px">Você ainda pode exportar, mas o contrato sairá com inconsistências.</div>
             </div>`
          : ''
      }

      ${
        presetPaths
          ? `<div class="field__hint">Exportando: <code>${presetPaths.map(esc).join(', ')}</code></div>`
          : `<div class="field">
               <label class="field__label">Escopo</label>
               <label class="check"><input type="radio" name="scope" value="page" checked ${state.currentPath ? '' : 'disabled'} />
                 Somente a página aberta ${state.currentPath ? `<span class="faint">(${esc(state.doc?.name || '')})</span>` : '<span class="faint">— nenhuma página aberta</span>'}</label>
               <label class="check"><input type="radio" name="scope" value="workspace" ${state.currentPath ? '' : 'checked'} />
                 Todo o workspace <span class="faint">(todas as páginas do papyrus)</span></label>
             </div>`
      }

      <div class="field">
        <label class="field__label">Nome do arquivo</label>
        <input class="input input--mono" id="tf-name" value="trust-factor-${sanitize(state.doc?.name || 'workspace')}" />
      </div>

      <div class="field">
        <label class="field__label">Destino</label>
        <label class="check"><input type="radio" name="tf-dest" value="download" checked /> Download pelo navegador</label>
        ${gcsOptionHtml(gcs, 'tf-dest')}
      </div>

      <details style="margin-top:14px">
        <summary style="cursor:pointer;font-size:12px;color:var(--text-muted)">Ver estrutura gerada</summary>
        <pre class="code" style="margin-top:8px;max-height:220px">${esc(SAMPLE)}</pre>
      </details>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--primary" id="tf-go">Exportar</button>`,
    onMount: (modal, close) => {
      modal.querySelector('#tf-go').onclick = () => {
        const destination = modal.querySelector('input[name="tf-dest"]:checked')?.value || 'download';
        const scope = modal.querySelector('input[name="scope"]:checked')?.value || 'page';
        close({
          scope,
          destination,
          filename: modal.querySelector('#tf-name').value.trim() || 'trust-factor',
        });
      };
    },
  });

  if (!result) return;

  const paths = presetPaths || (result.scope === 'page' && state.currentPath ? [state.currentPath] : null);

  try {
    const response = await api.exportTrust({
      paths,
      filename: result.filename,
      gcs: result.destination === 'gcs',
    });

    if (response.gcs) {
      toast.ok(`Trust Factor publicado em ${response.gcs.gsUri}`);
    } else {
      downloadBlob(
        new Blob([JSON.stringify(response.payload, null, 2)], { type: 'application/json' }),
        `${sanitize(result.filename)}.json`,
      );
      toast.ok('Trust Factor exportado.');
    }
  } catch (err) {
    toast.error(err.message);
  }
}

const SAMPLE = `{
  "Checkout": [
    {
      "event_name": "begin_checkout",
      "event_type": "ecommerce",
      "platform": ["web", "app"],
      "trigger": "Clique em 'Finalizar compra' no carrinho",
      "governance": { "squad": "Checkout", "owner": "…", "notes": "…" },
      "tracker": { "card_name": "…", "card_id": "ANA-1234", "url": "…" },
      "parameters": {
        "event": [{ "name": "currency", "type": "string", "required": true }],
        "user":  [{ "name": "user_id", "type": "string", "required": false }],
        "items": [{ "name": "item_id", "type": "string", "required": true }]
      }
    }
  ]
}`;

const sanitize = (name) =>
  String(name || 'export')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9-_.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'export';
