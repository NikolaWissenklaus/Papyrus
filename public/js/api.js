/*
 * Unico ponto de contato com o back-end. Tudo passa por request(), que
 * normaliza os erros para a UI sempre receber um Error com mensagem legivel.
 */

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();

  // Resposta que nao e JSON (proxy, pagina de erro, servidor que caiu no meio
  // da requisicao) nao pode virar um SyntaxError criptico na tela.
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
  /* Arvore */
  getTree: () => request('/api/tree'),
  createFolder: (parent, name, color) =>
    request('/api/folders', { method: 'POST', body: { parent, name, color } }),
  setFolderColor: (path, color) =>
    request('/api/folders/color', { method: 'PUT', body: { path, color } }),
  createPage: (parent, name) => request('/api/pages', { method: 'POST', body: { parent, name } }),
  rename: (path, name) => request('/api/entry', { method: 'PATCH', body: { path, name } }),
  remove: (path) => request(`/api/entry${qs({ path })}`, { method: 'DELETE' }),
  move: (path, destination) => request('/api/entry/move', { method: 'POST', body: { path, destination } }),

  /* Paginas */
  readPage: (path) => request(`/api/page${qs({ path })}`),
  savePage: (path, doc) => request('/api/page', { method: 'PUT', body: { path, doc } }),

  /* Assets */
  uploadAsset: (dataUrl) => request('/api/assets', { method: 'POST', body: { dataUrl } }),

  /* Templates */
  getTemplates: () => request('/api/templates'),
  saveTemplates: (groups) => request('/api/templates', { method: 'PUT', body: { groups } }),

  /* Dicionario */
  getDictionary: () => request('/api/dictionary'),

  /* Exportar */
  exportEvents: (body) => request('/api/export/events', { method: 'POST', body }),

  /* Google Cloud Storage */
  gcsStatus: () => request('/api/gcs/status'),
  getGcsSettings: () => request('/api/settings/gcs'),
  saveGcsSettings: (body) => request('/api/settings/gcs', { method: 'PUT', body }),
  testGcs: (body = {}) => request('/api/settings/gcs/test', { method: 'POST', body }),

  /* Importar */
  importInline: (files, destination) => request('/api/import/inline', { method: 'POST', body: { files, destination } }),
};
