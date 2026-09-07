/*
 * Adapter de Google Cloud Storage, destino do JSON que sai pelo botao
 * "Exportar".
 *
 * A dependencia `@google-cloud/storage` nao vem instalada por padrao, para a
 * ferramenta continuar leve e funcionando offline. O import e dinamico e so
 * acontece na hora do upload. Sem o pacote, a API responde com o passo a passo
 * da instalacao.
 *
 * A configuracao pode vir de duas fontes, e o env sempre vence o arquivo.
 *
 * Por variavel de ambiente:
 *   GCS_BUCKET   nome do bucket (obrigatorio)
 *   GCS_PREFIX   pasta base dentro do bucket (opcional, ex: "papyrus/")
 *   GCS_KEYFILE  caminho do JSON da service account (opcional quando o ambiente
 *                ja tem GOOGLE_APPLICATION_CREDENTIALS ou ADC)
 *
 * Ou pelo arquivo `papyrus/_system/gcs.json`:
 *   { "bucket": "meu-bucket", "prefix": "papyrus/", "keyFilename": "C:/chaves/sa.json" }
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { SYSTEM_DIR } from './paths.js';

const CONFIG_FILE = path.join(SYSTEM_DIR, 'gcs.json');
const KEY_FILE = path.join(SYSTEM_DIR, 'gcs-service-account.json');

/** Configuração gravada em disco (sem env). Nunca lança. */
export async function readGcsFileConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
    return typeof parsed === 'object' && parsed ? parsed : {};
  } catch {
    return {};
  }
}

/** Lê a configuração consolidada (env > arquivo). Nunca lança. */
export async function getGcsConfig() {
  const fileConfig = await readGcsFileConfig();

  return {
    bucket: process.env.GCS_BUCKET || fileConfig.bucket || '',
    prefix: process.env.GCS_PREFIX ?? fileConfig.prefix ?? '',
    keyFilename: process.env.GCS_KEYFILE || fileConfig.keyFilename || '',
    projectId: process.env.GCS_PROJECT_ID || fileConfig.projectId || '',
  };
}

/** Indica quais campos estão sendo sobrescritos por variável de ambiente. */
export function gcsEnvOverrides() {
  return {
    bucket: Boolean(process.env.GCS_BUCKET),
    prefix: process.env.GCS_PREFIX != null,
    keyFilename: Boolean(process.env.GCS_KEYFILE),
    projectId: Boolean(process.env.GCS_PROJECT_ID),
  };
}

/**
 * Grava a configuracao vinda da aba Configuracoes.
 *
 * A credencial chega sempre como `keyJson`, o conteudo colado da service
 * account. Ela e validada, salva em arquivo proprio dentro de `_system/` e
 * referenciada por caminho, entao o gcs.json em si nunca carrega a chave
 * privada. Sem `keyJson` a credencial ja salva continua valendo, e
 * `removeKey: true` apaga.
 */
export async function saveGcsConfig({ bucket, prefix, projectId, keyJson, removeKey } = {}) {
  const existing = await readGcsFileConfig();
  const config = {
    bucket: String(bucket || '').trim(),
    prefix: String(prefix || '').trim(),
    projectId: String(projectId || '').trim(),
    keyFilename: existing.keyFilename || '',
  };

  if (removeKey) {
    config.keyFilename = '';
    try {
      await fs.rm(KEY_FILE, { force: true });
    } catch {
      /* arquivo ja inexistente */
    }
  }

  if (!removeKey && keyJson && String(keyJson).trim()) {
    let parsed;
    try {
      parsed = JSON.parse(keyJson);
    } catch {
      const err = new Error('O conteúdo colado não é um JSON válido.');
      err.status = 400;
      throw err;
    }
    if (!parsed.client_email || !parsed.private_key) {
      const err = new Error(
        'O JSON não parece uma service account (faltam client_email/private_key).',
      );
      err.status = 400;
      throw err;
    }
    await fs.mkdir(SYSTEM_DIR, { recursive: true });
    await fs.writeFile(KEY_FILE, JSON.stringify(parsed, null, 2), 'utf8');
    config.keyFilename = KEY_FILE;
    if (!config.projectId && parsed.project_id) config.projectId = parsed.project_id;
  }

  await fs.mkdir(SYSTEM_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  return config;
}

/**
 * Testa a conexao de ponta a ponta: lib instalada, credencial valida e bucket
 * acessivel. Qualquer falha vira erro com mensagem legivel.
 *
 * Aceita os valores que estao na tela, em `draft`, para dar para testar antes
 * de salvar. E o que a aba Configuracoes manda. O que nao vier no draft cai no
 * que ja esta salvo ou no env.
 *
 * @param {{bucket?:string, prefix?:string, projectId?:string, keyJson?:string}} [draft]
 */
export async function testGcs(draft = {}) {
  const saved = await getGcsConfig();
  const config = {
    bucket: String(draft.bucket || '').trim() || saved.bucket,
    prefix: (draft.prefix != null ? String(draft.prefix) : saved.prefix).trim(),
    projectId: String(draft.projectId || '').trim() || saved.projectId,
    keyFilename: saved.keyFilename,
  };

  // Env sempre vence. Valor fixado por variavel de ambiente aparece com o campo
  // desabilitado na UI, e o draft nao sobrescreve.
  if (process.env.GCS_BUCKET) config.bucket = saved.bucket;
  if (process.env.GCS_PROJECT_ID) config.projectId = saved.projectId;

  if (!config.bucket) {
    const err = new Error('Informe o nome do bucket antes de testar.');
    err.status = 400;
    throw err;
  }

  // Credencial colada e ainda nao salva: usa direto, sem gravar em disco.
  let credentials = null;
  if (draft.keyJson && String(draft.keyJson).trim() && !process.env.GCS_KEYFILE) {
    let parsed;
    try {
      parsed = JSON.parse(draft.keyJson);
    } catch {
      const err = new Error('O conteúdo colado não é um JSON válido.');
      err.status = 400;
      throw err;
    }
    if (!parsed.client_email || !parsed.private_key) {
      const err = new Error(
        'O JSON não parece uma service account (faltam client_email/private_key).',
      );
      err.status = 400;
      throw err;
    }
    credentials = parsed;
    if (!config.projectId && parsed.project_id) config.projectId = parsed.project_id;
  }

  if (!credentials && !config.keyFilename && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const err = new Error(
      'Nenhuma credencial disponível: cole o JSON da service account no campo acima antes de testar.',
    );
    err.status = 400;
    throw err;
  }

  const Storage = await loadStorageLib();
  if (!Storage) {
    const err = new Error(
      'Pacote @google-cloud/storage não instalado. Rode "npm install @google-cloud/storage" e reinicie o servidor.',
    );
    err.status = 501;
    throw err;
  }

  const storage = new Storage({
    ...(credentials ? { credentials } : config.keyFilename ? { keyFilename: config.keyFilename } : {}),
    ...(config.projectId ? { projectId: config.projectId } : {}),
  });

  try {
    const [exists] = await storage.bucket(config.bucket).exists();
    if (!exists) {
      const err = new Error(`O bucket "${config.bucket}" não existe ou a credencial não tem acesso a ele.`);
      err.status = 400;
      throw err;
    }
  } catch (cause) {
    if (cause.status) throw cause;
    const err = new Error(`Falha na autenticação/conexão: ${cause.message}`);
    err.status = 400;
    throw err;
  }

  return { ok: true, bucket: config.bucket, prefix: config.prefix };
}

/** Verifica se a lib oficial esta instalada, sem carrega-la a toa. */
async function loadStorageLib() {
  try {
    const mod = await import('@google-cloud/storage');
    return mod.Storage;
  } catch {
    return null;
  }
}

/**
 * Diagnostico que a UI usa para habilitar, ou explicar, a opcao de GCS.
 * @returns {{configured:boolean, ready:boolean, bucket:string, prefix:string, reason:string|null}}
 */
export async function gcsStatus() {
  const config = await getGcsConfig();

  if (!config.bucket) {
    return {
      configured: false,
      ready: false,
      bucket: '',
      prefix: '',
      reason: 'Configure o bucket e a credencial na aba Configurações.',
    };
  }

  const Storage = await loadStorageLib();
  if (!Storage) {
    return {
      configured: true,
      ready: false,
      bucket: config.bucket,
      prefix: config.prefix,
      reason: 'Pacote não instalado. Rode: npm install @google-cloud/storage',
    };
  }

  return { configured: true, ready: true, bucket: config.bucket, prefix: config.prefix, reason: null };
}

/**
 * Sobe um buffer para o bucket configurado.
 * @param {{filename:string, contentType:string, buffer:Buffer}} params
 * @returns {Promise<{bucket:string, object:string, gsUri:string}>}
 */
export async function uploadToGcs({ filename, contentType, buffer }) {
  const config = await getGcsConfig();
  if (!config.bucket) {
    const err = new Error('GCS não configurado: informe o bucket na aba Configurações.');
    err.status = 400;
    throw err;
  }

  const Storage = await loadStorageLib();
  if (!Storage) {
    const err = new Error(
      'Pacote @google-cloud/storage não instalado. Rode "npm install @google-cloud/storage" e reinicie o servidor.',
    );
    err.status = 501;
    throw err;
  }

  const storage = new Storage({
    ...(config.keyFilename ? { keyFilename: config.keyFilename } : {}),
    ...(config.projectId ? { projectId: config.projectId } : {}),
  });

  const prefix = config.prefix ? config.prefix.replace(/\/+$/, '') + '/' : '';
  const object = `${prefix}${filename}`;

  await storage.bucket(config.bucket).file(object).save(buffer, {
    contentType,
    resumable: false,
    metadata: { cacheControl: 'no-cache' },
  });

  return { bucket: config.bucket, object, gsUri: `gs://${config.bucket}/${object}` };
}
