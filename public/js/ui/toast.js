/* Notificacoes efemeras no rodape. */

const host = () => document.getElementById('toasts');

function push(message, variant, ttl) {
  const el = document.createElement('div');
  el.className = `toast${variant ? ` toast--${variant}` : ''}`;
  el.textContent = message;
  host().appendChild(el);

  setTimeout(() => {
    el.style.transition = 'opacity .2s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 220);
  }, ttl);
}

export const toast = {
  info: (msg, ttl = 3000) => push(msg, null, ttl),
  ok: (msg, ttl = 3000) => push(msg, 'ok', ttl),
  error: (msg, ttl = 5200) => push(msg, 'error', ttl),
};
