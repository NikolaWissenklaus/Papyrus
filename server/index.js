/**
 * server/index.js
 * ---------------------------------------------------------------------------
 * Servidor Express do Papyrus.
 *
 * Por que Express e nao Electron?
 *  - Zero build step, inicia em ~1s e roda em qualquer maquina com Node.
 *  - Da acesso real ao file system (requisito da pasta `papyrus`), coisa que um
 *    front-end puro no navegador nao teria.
 *  - Permite abrir a ferramenta em varias abas/monitores e, se quiser, expor na
 *    rede interna do time — algo que o Electron dificultaria.
 */

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PAPYRUS_ROOT, PROJECT_ROOT, ensureBaseStructure } from './lib/paths.js';
import treeRoutes from './routes/tree.js';
import assetRoutes from './routes/assets.js';
import systemRoutes from './routes/system.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4173;

const app = express();

// --- Restrição de IP --------------------------------------------------------
// Adicione os IPs permitidos (inclua localhost para testes locais)
const ALLOWED_IPS = [
  '127.0.0.1',       // Localhost IPv4
  '::1',             // Localhost IPv6
  '',                // Substitua pelo IP externo ou IP da rede interna desejado
];

// Se o servidor rodar atrás de um proxy reverso (Nginx, Cloudflare, Docker, etc.),
// descomente a linha abaixo para ler o IP real do cabeçalho X-Forwarded-For:
// app.set('trust proxy', true);

app.use((req, res, next) => {
  // Normaliza o IP (o Node/Express costuma retornar ::ffff:192.168.x.x para IPv4)
  const rawIp = req.ip || req.socket.remoteAddress || '';
  const clientIp = rawIp.replace(/^.*:/, '');

  const isAllowed = ALLOWED_IPS.some((allowed) => {
    return clientIp === allowed || rawIp === allowed;
  });

  if (!isAllowed) {
    console.warn(`[segurança] Bloqueado acesso não autorizado do IP: ${rawIp}`);
    return res.status(403).json({ error: 'Acesso não autorizado para este endereço IP.' });
  }

  next();
});

// Documentos de canvas com muitas imagens/parametros podem passar do default (100kb).
app.use(express.json({ limit: '60mb' }));

// Documentos de canvas com muitas imagens/parametros podem passar do default (100kb).
app.use(express.json({ limit: '60mb' }));

// --- Front-end estatico -----------------------------------------------------
app.use(express.static(path.join(PROJECT_ROOT, 'public')));

// Konva servido a partir do node_modules: a ferramenta funciona 100% offline.
app.get('/vendor/konva.min.js', (_req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(PROJECT_ROOT, 'node_modules', 'konva', 'konva.min.js'));
});

// Imagens coladas no canvas sao servidas direto da pasta papyrus.
app.use('/papyrus', express.static(PAPYRUS_ROOT));

// --- API --------------------------------------------------------------------
app.use('/api', treeRoutes);
app.use('/api', assetRoutes);
app.use('/api', systemRoutes);

// --- Tratamento de erros ----------------------------------------------------
app.use((err, _req, res, _next) => {
  console.error('[papyrus]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Erro interno.' });
});

await ensureBaseStructure();

const server = app.listen(PORT, () => {
  console.log('');
  console.log('  ██  PAPYRUS — mapa de coletas GA4');
  console.log('  ─────────────────────────────────────────────');
  console.log(`  App .......... http://localhost:${PORT}`);
  console.log(`  Papyrus ...... ${PAPYRUS_ROOT}`);
  console.log('  ─────────────────────────────────────────────');
  console.log('');
});

// Sem este handler, uma porta ocupada derruba o processo com um stack trace do
// Node que nao diz o que fazer. O cenario mais comum e o proprio Papyrus ja
// estar rodando em outra janela do terminal.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  A porta ${PORT} ja esta em uso.`);
    console.error('');
    console.error('  Provavelmente o Papyrus ja esta rodando — tente abrir');
    console.error(`  http://localhost:${PORT} antes de subir outra instancia.`);
    console.error('');
    console.error('  Se quiser rodar em outra porta:');
    console.error('     PowerShell   $env:PORT=4174; npm start');
    console.error('     Bash         PORT=4174 npm start');
    console.error('');
    console.error('  Para encerrar a instancia atual (PowerShell):');
    console.error(`     Get-NetTCPConnection -LocalPort ${PORT} -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
    console.error('');
    process.exit(1);
  }
  throw err;
});
