/*
 * As duas saidas da ferramenta, com destinos propositalmente diferentes.
 *
 * "Exportar" gera um JSON so com regra de negocio: o nome da pagina como chave
 * raiz e um array de eventos tipados como valor. Coordenada, cor e elemento
 * visual ficam de fora. O nome basta como chave porque o workspace recusa nome
 * repetido, entao duas paginas nunca disputam a mesma chave. O escopo e sempre o workspace inteiro, nunca uma pagina
 * isolada, porque o arquivo precisa valer como retrato completo da coleta. Ele
 * vai direto para o bucket do Google Cloud Storage, ja que o contrato de coleta
 * precisa de um endereco unico. Download solto na maquina de quem exportou vira
 * copia divergente em uma semana.
 *
 * "Tirar foto" gera PNG ou JPG do canvas, sempre pelo navegador. E material de
 * apresentacao e de conversa: tem vida curta e nao precisa ser versionado.
 */

import { api } from '../api.js';
import { state, flushSave } from '../store.js';
import { esc, downloadBlob } from '../util.js';
import { openModal } from '../ui/modal.js';
import { toast } from '../ui/toast.js';
import { exportPNG } from '../canvas/stage.js';
import { validateDoc } from '../quality/validation.js';
import { EVENT_ID_PARAM } from '../models.js';
import { getExportDefaults } from './settings.js';

/** Nome sugerido do arquivo. O export cobre o workspace inteiro, sempre. */
const DEFAULT_FILENAME = 'papyrus';

/** Consulta o status do GCS sem quebrar a UI se o servidor falhar. */
async function safeGcsStatus() {
  try {
    return await api.gcsStatus();
  } catch {
    return { configured: false, ready: false, reason: null };
  }
}

/* Foto do canvas (PNG / JPG) */

export async function takeCanvasPhoto() {
  if (!state.doc) {
    toast.error('Abra uma página antes de tirar a foto.');
    return;
  }

  const hasSelection = state.selection.length > 0;

  // Pre-preenche com os padroes definidos na aba Configuracoes.
  const def = getExportDefaults();
  const sel = (value, current) => (String(value) === String(current) ? ' selected' : '');

  const options = await openModal({
    title: 'Tirar foto do canvas',
    subtitle: 'A imagem é recortada no conteúdo, sem áreas vazias sobrando.',
    body: `
      <div class="grid-2">
        <div class="field">
          <label class="field__label">Resolução</label>
          <select class="select" id="png-scale">
            <option value="2"${sel(2, def.scale)}>2× (apresentação)</option>
            <option value="3"${sel(3, def.scale)}>3× (alta resolução, recomendado)</option>
            <option value="4"${sel(4, def.scale)}>4× (impressão)</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label">Formato</label>
          <select class="select" id="png-format">
            <option value="png"${sel('png', def.format)}>PNG (sem perdas)</option>
            <option value="jpeg"${sel('jpeg', def.format)}>JPG (arquivo menor)</option>
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
      <div class="field__hint" style="margin-top:10px">A foto é baixada pelo navegador.</div>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--primary" id="png-go">Tirar foto</button>`,
    // Os valores tem de ser lidos antes de fechar o modal: depois do close() o
    // DOM do dialogo ja nao existe.
    onMount: (modal, close) => {
      const formatSelect = modal.querySelector('#png-format');
      const bgSelect = modal.querySelector('#png-bg');

      // JPG nao tem canal alfa, e fundo transparente sairia preto.
      formatSelect.onchange = () => {
        const transparentOption = bgSelect.querySelector('option[value="transparent"]');
        transparentOption.disabled = formatSelect.value === 'jpeg';
        if (formatSelect.value === 'jpeg' && bgSelect.value === 'transparent') {
          bgSelect.value = '#FFFFFF';
        }
      };
      // Vale tambem para o estado inicial, ja que o padrao pode vir como JPG.
      formatSelect.onchange();

      modal.querySelector('#png-go').onclick = () =>
        close({
          scale: Number(modal.querySelector('#png-scale').value) || 3,
          format: formatSelect.value,
          background: bgSelect.value,
          padding: Number(modal.querySelector('#png-pad').value) || 0,
          onlySelection: Boolean(modal.querySelector('#png-selection')?.checked),
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

  const filename = `${sanitize(state.doc.name)}-${options.scale}x.${isJpeg ? 'jpg' : 'png'}`;
  const blob = await (await fetch(dataUrl)).blob();
  downloadBlob(blob, filename);
  toast.ok('Foto salva.');
}

/* Exportar: JSON de eventos para o Google Cloud Storage */

/** Caminho de toda pagina valida da arvore, em profundidade. */
function allPagePaths(nodes = state.tree || [], out = []) {
  for (const node of nodes) {
    if (node.type === 'folder') allPagePaths(node.children || [], out);
    else if (!node.invalid) out.push(node.path);
  }
  return out;
}

/*
 * Audita o workspace inteiro antes de liberar o export.
 *
 * O validador do rodape roda so na pagina aberta, e o arquivo exportado cobre
 * todas. Entao aqui as paginas sao lidas do disco e validadas uma a uma, e no
 * fim vem a checagem que nenhuma delas conseguiria fazer sozinha: event_id
 * repetido entre paginas diferentes.
 *
 * Bloqueia por erro, nao por aviso. Aviso e coisa de mapa em andamento (sem
 * squad, sem gatilho descrito) e travar por isso deixaria o export inalcancavel.
 */
async function auditWorkspace() {
  const docs = await Promise.all(
    allPagePaths().map(async (path) => {
      const { doc } = await api.readPage(path);
      return { path, name: doc?.name || path, doc };
    }),
  );

  const blockers = [];

  for (const { name, doc } of docs) {
    for (const issue of validateDoc(doc).issues) {
      if (issue.level !== 'error') continue;
      blockers.push({ page: name, where: issue.where, message: issue.message });
    }
  }

  const byEventId = new Map();
  for (const { name, doc } of docs) {
    for (const el of doc?.elements || []) {
      if (el.type !== 'event') continue;
      const id = ((el.data?.eventParams || []).find((p) => p.name === EVENT_ID_PARAM)?.example || '').trim();
      if (!id) continue;
      if (!byEventId.has(id)) byEventId.set(id, []);
      byEventId.get(id).push({ page: name, event: el.data?.name || '(sem nome)' });
    }
  }

  for (const [id, uses] of byEventId) {
    // Colisao dentro de uma pagina so o validador ja apontou acima.
    const pages = new Set(uses.map((u) => u.page));
    if (uses.length < 2 || pages.size < 2) continue;
    blockers.push({
      page: [...pages].join(', '),
      where: uses.map((u) => u.event).join(', '),
      message: `event_id "${id}" repetido em mais de uma página.`,
    });
  }

  return blockers;
}

/**
 * O escopo e sempre o workspace inteiro. Exportar uma pagina isolada produzia
 * contratos parciais circulando em paralelo, cada um dizendo uma coisa; o
 * arquivo no bucket precisa valer como retrato completo da coleta.
 */
export async function exportEvents() {
  await flushSave();

  const [blockers, gcs] = await Promise.all([auditWorkspace(), safeGcsStatus()]);
  const blocked = blockers.length > 0;

  const result = await openModal({
    title: 'Exportar',
    subtitle: 'JSON com as regras de negócio: sem coordenadas, cores ou elementos visuais.',
    wide: true,
    body: `
      ${
        blocked
          ? `<div class="card" style="border-color:#FAD2CF;background:var(--danger-bg);margin-bottom:14px;padding:12px 16px">
               <strong style="color:var(--danger);font-size:13px">
                 ${blockers.length} problema(s) impedem a exportação
               </strong>
               <div class="field__hint" style="margin:2px 0 10px">
                 O arquivo é o contrato de coleta do workspace inteiro. Corrija os itens abaixo e tente de novo.
               </div>
               <div style="display:flex;flex-direction:column;gap:5px;max-height:190px;overflow:auto">
                 ${blockers
                   .map(
                     (b) => `<div style="font-size:12px">
                       <code>${esc(b.page)}</code>
                       ${b.where ? `<span class="faint">· ${esc(b.where)}</span>` : ''}
                       <div class="faint">${esc(b.message)}</div>
                     </div>`,
                   )
                   .join('')}
               </div>
             </div>`
          : ''
      }

      <div class="field">
        <label class="field__label">Escopo</label>
        <div class="field__hint">
          Todo o workspace: todas as páginas da pasta <code>papyrus</code>, e não apenas a que está aberta.
        </div>
      </div>

      <div class="field">
        <label class="field__label">Nome do arquivo</label>
        <input class="input input--mono" id="tf-name" value="${DEFAULT_FILENAME}" />
      </div>

      <div class="field">
        <label class="field__label">Destino</label>
        <div class="card" style="padding:12px 16px">
          <strong style="font-size:13px">Google Cloud Storage</strong>
          ${
            gcs.ready
              ? `<div class="field__hint" style="margin-top:2px">Bucket: <code>${esc(gcs.bucket)}</code>${
                  gcs.prefix ? ` · prefixo <code>${esc(gcs.prefix)}</code>` : ''
                }</div>`
              : `<div class="field__hint" style="margin-top:2px;color:var(--warn)">${esc(
                  gcs.reason || 'Não configurado.',
                )}</div>`
          }
        </div>
      </div>

      <details style="margin-top:14px">
        <summary style="cursor:pointer;font-size:12px;color:var(--text-muted)">Ver estrutura gerada</summary>
        <pre class="code" style="margin-top:8px;max-height:220px">${esc(SAMPLE)}</pre>
      </details>`,
    footer: `
      <button class="btn btn--ghost" data-close="null">Cancelar</button>
      <button class="btn btn--primary" id="tf-go" ${gcs.ready && !blocked ? '' : 'disabled'}>Exportar</button>`,
    onMount: (modal, close) => {
      const nameInput = modal.querySelector('#tf-name');

      modal.querySelector('#tf-go').onclick = () =>
        close({ filename: nameInput.value.trim() || DEFAULT_FILENAME });
    },
  });

  if (!result) return;

  try {
    // `paths: null` diz ao servidor para varrer o workspace inteiro.
    const response = await api.exportEvents({ paths: null, filename: result.filename });
    toast.ok(`Exportado para ${response.gcs.gsUri}`);
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
        "event": [{ "name": "event_id", "type": "string", "required": true }],
        "user":  [{ "name": "user_id", "type": "string", "required": false }],
        "items": [{ "name": "item_id", "type": "string", "required": true }]
      }
    }
  ]
}`;

const sanitize = (name) =>
  String(name || 'export')
    .normalize('NFD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/[^a-zA-Z0-9-_.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'export';
