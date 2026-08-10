/**
 * api.js
 * ---------------------------------------------------------------------------
 * Unico ponto de contato com o back-end. Todas as chamadas passam por `request`,
 * que normaliza erros para que a UI sempre receba um Error com mensagem legivel.
 */

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();

  // Uma resposta nao-JSON (proxy, pagina de erro, servidor caido no meio da
  // requisicao) nao deve estourar um SyntaxError criptico na UI.
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    throw new Error(payload.error || `Erro ${response.status}`);
  }
  return payload;
}

const qs = (params) =>
  '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();

export const api = {
  /* ------------------------------------------------------------- Arvore -- */
  getTree: () => request('/api/tree'),
  createFolder: (parent, name) => request('/api/folders', { method: 'POST', body: { parent, name } }),
  createPage: (parent, name) => request('/api/pages', { method: 'POST', body: { parent, name } }),
  rename: (path, name) => request('/api/entry', { method: 'PATCH', body: { path, name } }),
  remove: (path) => request(`/api/entry${qs({ path })}`, { method: 'DELETE' }),
  move: (path, destination) => request('/api/entry/move', { method: 'POST', body: { path, destination } }),

  /* ------------------------------------------------------------ Paginas -- */
  readPage: (path) => request(`/api/page${qs({ path })}`),
  savePage: (path, doc) => request('/api/page', { method: 'PUT', body: { path, doc } }),

  /* ------------------------------------------------------------ Assets -- */
  uploadAsset: (dataUrl) => request('/api/assets', { method: 'POST', body: { dataUrl } }),

  /* --------------------------------------------------------- Templates -- */
  getTemplates: () => request('/api/templates'),
  saveTemplates: (groups) => request('/api/templates', { method: 'PUT', body: { groups } }),

  /* -------------------------------------------------------- Dicionario -- */
  getDictionary: () => request('/api/dictionary'),

  /* ---------------------------------------------------------- Exportar -- */
  exportTrust: (body) => request('/api/export/trust', { method: 'POST', body }),

  /* ------------------------------------------- Google Cloud Storage ----- */
  gcsStatus: () => request('/api/gcs/status'),
  exportGcs: (body) => request('/api/export/gcs', { method: 'POST', body }),
  getGcsSettings: () => request('/api/settings/gcs'),
  saveGcsSettings: (body) => request('/api/settings/gcs', { method: 'PUT', body }),
  testGcs: (body = {}) => request('/api/settings/gcs/test', { method: 'POST', body }),

  /* --------------------------------------------------------- Importar -- */
  importInline: (files, destination) => request('/api/import/inline', { method: 'POST', body: { files, destination } }),
};
