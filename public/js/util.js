/*
 * Utilitarios puros. Nada aqui conhece o DOM da aplicacao.
 */

/** Identificador curto e legivel para elementos do canvas. */
export function uid(prefix = 'el') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`;
}

/** Clone profundo. structuredClone e nativo em todos os browsers atuais. */
export function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

/** Adia a execucao ate `wait` ms sem novas chamadas. */
export function debounce(fn, wait = 300) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(timer);
  wrapped.flush = (...args) => {
    clearTimeout(timer);
    fn(...args);
  };
  return wrapped;
}

/** Escapa HTML para interpolacao segura em template strings. */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}

/** Converte texto livre em snake_case valido para GA4. */
export function toSnakeCase(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove os acentos separados pelo NFD
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** Verifica se o texto ja esta em snake_case canonico. */
export function isSnakeCase(value) {
  return /^[a-z][a-z0-9_]*$/.test(String(value || ''));
}

/** Trunca com reticencias. */
export function truncate(value, max) {
  const str = String(value ?? '');
  return str.length > max ? `${str.slice(0, max - 1)}…` : str;
}

/** Formata uma data ISO em "01/08/2026 14:32". */
export function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Le um File como data URL. */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Le um File como texto. */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/** Copia para a area de transferencia com fallback para navegadores antigos. */
export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

/** Dispara download de um blob no navegador. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Retorna um valor entre min e max. */
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Carrega uma imagem e resolve com o elemento HTMLImageElement. */
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Falha ao carregar imagem: ${src}`));
    img.src = src;
  });
}

/**
 * Forma de comparacao de um nome de pasta ou pagina.
 *
 * Precisa casar com `normalizeName` de server/lib/names.js: as duas pontas
 * decidem a mesma colisao, e divergir faria a UI liberar um nome que o servidor
 * recusa em seguida.
 */
export function normalizeName(name) {
  return String(name || '')
    .trim()
    .normalize('NFC')
    .toLowerCase();
}
