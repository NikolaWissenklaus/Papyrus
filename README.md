# Papyrus

Ferramenta visual de **planejamento de mensuração e mapas de coleta para o GA4**.
Canvas infinito para desenhar a arquitetura de dados de uma tela, prints de referência,
pins, conectores e cards de evento com parâmetros tipados, e exportar isso como
contrato de coleta para o time de engenharia.

---

## 1. Como rodar

Pré-requisito: **Node.js 18 ou superior** (testado no Node 24).

```bash
npm install
npm start
```

Abra **http://localhost:4173**.

Outros comandos:

| Comando | O que faz |
|---|---|
| `npm start` | Sobe o servidor |
| `npm run dev` | Sobe com auto-reload do back-end (`node --watch`) |
| `PORT=3000 npm start` | Troca a porta |
| `PAPYRUS_DIR=D:\meus-mapas npm start` | Aponta a pasta de trabalho para outro lugar |

No PowerShell, variáveis de ambiente vão assim: `$env:PORT=3000; npm start`.

### Por que Express e não Electron

A ferramenta precisa de acesso real ao sistema de arquivos (criar pastas, ler e gravar JSON,
escolher onde salvar o export), algo impossível num front-end puro no navegador.
Entre Electron e um servidor Node local, o servidor venceu por três motivos: sobe em ~1s sem
build step, roda em qualquer máquina que tenha Node, e permite abrir o mapa em várias abas ou
até compartilhar na rede interna do time. Nada impede empacotar como Electron depois, o
front-end e a API já estão desacoplados.

---

## 2. Estrutura do projeto

```
herculano/                      # raiz do projeto no disco (o app: Papyrus)
├── server/                     # Back-end Express
│   ├── index.js                # Bootstrap, estáticos, montagem das rotas
│   ├── lib/
│   │   ├── paths.js            # Resolução segura de caminhos (anti path-traversal)
│   │   ├── papyrus.js          # Formato do arquivo, validação, varredura da árvore
│   │   └── gcs.js              # Adapter do Google Cloud Storage (opcional)
│   └── routes/
│       ├── tree.js             # CRUD de pastas/páginas, leitura e gravação do canvas
│       ├── assets.js           # Upload de imagens coladas
│       └── system.js           # Grupos, dicionário, export, GCS, import via upload
│
├── public/                     # Front-end (ES modules, sem build step)
│   ├── index.html
│   ├── css/
│   │   ├── tokens.css          # Design system: cores, tipografia, forma
│   │   ├── app.css             # Layout, canvas shell, modais
│   │   └── forms.css           # Inputs, seções do inspetor, tabela de parâmetros
│   └── js/
│       ├── main.js             # Bootstrap, abas, atalhos de teclado
│       ├── store.js            # Estado central, undo/redo, auto-save
│       ├── models.js           # Fábricas dos elementos do canvas
│       ├── constants.js        # Taxonomias, catálogos GA4, limites da plataforma
│       ├── api.js              # Cliente HTTP
│       ├── util.js             # Helpers puros
│       ├── canvas/
│       │   ├── stage.js        # Palco Konva: pan/zoom, ferramentas, seleção, arrasto
│       │   ├── nodes.js        # Elemento do documento → nó Konva
│       │   ├── geometry.js     # Bounding boxes, âncoras, roteamento de conectores
│       │   └── clipboard.js    # Ctrl+C / Ctrl+V (elementos e prints)
│       ├── panels/
│       │   ├── sidebar.js      # Árvore, busca, CRUD, importação
│       │   ├── inspector.js    # Edição do elemento selecionado
│       │   ├── templates.js    # Aba Grupos de Parâmetros
│       │   ├── dictionary.js   # Aba Dicionário Global
│       │   └── exporters.js    # PNG e Trust Factor
│       ├── quality/
│       │   ├── validation.js   # Validador de governança
│       │   └── snippet.js      # Geradores de dataLayer / gtag / JSON Schema
│       └── ui/
│           ├── modal.js        # Diálogos empilháveis e menu de contexto
│           └── toast.js
│
└── papyrus/                    # Criada na primeira execução, seus arquivos
    ├── _assets/                # Imagens coladas no canvas
    └── _system/                # Grupos de parâmetros salvos
```

---

## 3. A pasta `papyrus`

Tudo que você cria vive em `papyrus/`, em JSON legível por humanos. Pastas e subpastas
na interface são pastas de verdade no disco; cada página de canvas é um `.json`.

### Regra de segurança

Um arquivo só é renderizado se a **raiz do JSON** contiver:

```json
{ "json-type": "papyrus" }
```

Arquivos sem essa chave aparecem esmaecidos na barra lateral, marcados como `ignorado`,
e não abrem. Na importação, eles são recusados e listados com o motivo.

### Anatomia de uma página

```json
{
  "json-type": "papyrus",
  "schemaVersion": 1,
  "id": "uuid",
  "name": "PDP",
  "viewport": { "x": 0, "y": 0, "scale": 1 },
  "elements": [
    {
      "id": "evt_x1y2",
      "type": "event",
      "x": 620, "y": 300, "width": 320,
      "data": {
        "name": "view_item",
        "eventType": "ecommerce",
        "platform": ["web", "app"],
        "trigger": "Carregamento da PDP",
        "squad": "Growth", "owner": "ana@empresa", "notes": "",
        "ticketName": "...", "ticketId": "ANA-1234", "ticketUrl": "https://...",
        "eventParams": [{ "id": "p1", "name": "currency", "type": "string", "required": true, "example": "BRL" }],
        "userParams": [],
        "itemParams": []
      }
    }
  ]
}
```

Imagens **não** são embutidas em base64. Elas vão para `papyrus/_assets/<data>/<uuid>.png`
e o documento guarda só a URL, os JSONs continuam leves e versionáveis no Git.

---

## 4. Como usar

### Fluxo recomendado

1. **Crie uma página** (`+ Página` na barra lateral), uma por tela/jornada.
2. **Cole o print** da tela com `Ctrl + V`.
3. **Marque os pontos de interação** com pins (`P`).
4. **Crie os cards de evento** (`E`) e preencha no inspetor à direita.
5. **Ligue pin ↔ card** com o conector magnético (`C`): clique na origem, depois no destino.
6. **Confira a validação** no rodapé, clique num problema para o canvas voar até o card.
7. **Exporte o Trust Factor** para entregar ao time de engenharia.

### O Card de Evento

| Bloco | Campos |
|---|---|
| Identificação | Nome do evento, Tipo |
| Contexto técnico | Plataforma (Web/App/Server, múltipla), Gatilho |
| Governança | Squad, Pessoa responsável, Observações |
| Integração ágil | Nome do card, ID, URL clicável |
| Parâmetros de evento | Nome, tipo, obrigatório/opcional, valor de exemplo |
| Propriedades de usuário | Idem |
| Módulo Ecommerce | Aparece sozinho ao escolher o tipo **Ecommerce** |

A cor da tarja do card codifica o tipo, é dado, não decoração:

| Tipo | Cor |
|---|---|
| View | Azul |
| Interaction | Verde |
| Ecommerce | Amarelo |
| Automatic | Lilás |

Ao mudar o tipo para **Ecommerce**, os 18 parâmetros padrão do array `items` do GA4 são
injetados automaticamente (`item_id`, `item_name`, `price`, `quantity`, …) e podem ser
editados ou complementados com parâmetros customizados.

### Grupos de Parâmetros

Aba própria. Um grupo é um conjunto nomeado de parâmetros recorrentes, “Contexto de Página”,
“Identificação do Usuário”. No card de evento, **Importar grupo** traz o bloco inteiro.

O importador calcula conflitos em tempo real: se dois grupos selecionados declararem o mesmo
nome de parâmetro, ou se o nome já existir no card, a importação é **bloqueada** e os conflitos
são listados. Existe também um caminho de escape, *“Importar apenas os sem conflito”*.

### Dicionário Global

Catálogo consolidado de todo o workspace:

- **Eventos**, todos os eventos, em que página vivem, squad, quantidade de parâmetros, link do card
- **Parâmetros**, parâmetros únicos, tipos declarados, número de usos, em quantos eventos é obrigatório
- **De-para**, matriz parâmetro × evento
- **Conflito de tipo**, o mesmo nome declarado como tipos diferentes em eventos distintos.
  É o erro que mais custa caro quando já chegou no BigQuery, então ele aparece em destaque no topo.
- **Exportar CSV**, o de-para completo, com BOM para o Excel abrir com acentuação correta

### Exportação

**Imagem (PNG/JPG)**, recorta o conteúdo (sem áreas vazias), 2× a 4×, fundo
branco/cinza/transparente, com opção de exportar apenas a seleção atual. A escala é
ajustada automaticamente se o mapa for grande demais para o limite de canvas do navegador.

**Trust Factor**, JSON só com regra de negócio. Nenhuma coordenada, cor ou elemento visual.
A chave raiz é o nome da página; o valor é o array de eventos:

```json
{
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
        "user":  [{ "name": "user_id",  "type": "string", "required": false }],
        "items": [{ "name": "item_id",  "type": "string", "required": true }]
      }
    }
  ]
}
```

Você escolhe o escopo (página aberta ou workspace inteiro) e o destino: download pelo
navegador ou um bucket do Google Cloud Storage. Por segurança, a interface **não expõe
nem grava em pastas da máquina do servidor**, não há caminhos de disco em lugar nenhum
da UI ou da API.

### Google Cloud Storage (opcional)

A estrutura de publicação em GCS já vem pronta, mas desativada por padrão para manter a
ferramenta leve e offline. Para ativar:

1. Instale a lib oficial: `npm install @google-cloud/storage` (e reinicie o servidor)
2. Abra a aba **Configurações → Exportação, Google Cloud Storage** e informe o bucket,
   o prefixo (pasta dentro do bucket) e a credencial: **cole o conteúdo do JSON da service
   account** no campo mascarado (estilo senha). O conteúdo é validado e gravado pelo servidor
   em `papyrus/_system/gcs-service-account.json`, nunca é exibido de volta nem fica no
   navegador. Depois de salva, aparece a etiqueta “credencial salva ✓”, com opção de remover.
3. Clique em **Testar conexão**, o teste valida a lib, a credencial e o acesso ao bucket.

A service account precisa do papel **Storage Object Creator** (ou superior) no bucket.
Também dá para configurar por variáveis de ambiente, que têm prioridade sobre a aba
(os campos aparecem travados com a etiqueta `env`):

```bash
# PowerShell
$env:GCS_BUCKET="meu-bucket"; $env:GCS_PREFIX="papyrus/"; $env:GCS_KEYFILE="C:\chaves\sa.json"; npm start
```

Quando configurado, a opção **Google Cloud Storage** aparece habilitada nos modais de
exportação (Trust Factor e imagem). O status pode ser consultado em `GET /api/gcs/status`.

### Aba Configurações

- **Exportação de imagem**, padrões de resolução, formato, fundo e margem que
  pré-preenchem o exportador (salvos no navegador).
- **Google Cloud Storage**, bucket, prefixo, project id, service account e teste de conexão.

A aba não exibe nenhuma informação do servidor (caminhos, sistema operacional, runtime).

---

## 5. Features de Quality of Life

Além do escopo pedido, foram incluídas as seguintes:

**1. Validador de governança contínuo (rodapé do canvas).**
Roda a cada alteração e aponta, antes de o mapa virar ticket:
nome fora de snake_case (com sugestão de correção), nomes reservados do GA4 e prefixos
proibidos (`ga_`, `google_`, `firebase_`), estouro dos limites oficiais (40 caracteres em nomes,
25 parâmetros por evento), parâmetros duplicados no mesmo escopo, eventos duplicados na página,
parâmetro obrigatório sem valor de exemplo, evento Ecommerce sem `currency`/`value` ou sem
`items[]`, campos de governança vazios e conectores órfãos.
Clicar em um problema centraliza o canvas no card responsável.

**2. Geradores de código no card.**
Três botões que fecham o ciclo “planejei → implemento” sem redigitação:
- `dataLayer.push`, com o `push({ ecommerce: null })` recomendado pelo Google e a estrutura
  `ecommerce.items[]` montada, comentários de obrigatoriedade e cabeçalho com squad/gatilho/card
- `gtag()`, equivalente na API gtag.js
- **JSON Schema**, contrato de coleta para validar payloads em testes automatizados

**3. Normalização automática para snake_case.** Ao sair do campo de nome (evento ou parâmetro),
o texto é convertido, acentos incluídos. Há também um botão `snake_case` que normaliza a
tabela inteira de uma vez.

**4. Detecção de conflito de tipo entre páginas** no Dicionário Global.

**5. Auto-save com coalescência de histórico.** Grava sozinho 700ms após a última alteração.
Digitar um nome inteiro consome **um** passo de undo, não trinta.

**6. Alinhar e distribuir** em seleção múltipla (6 alinhamentos + 2 distribuições).

**7. Colar texto vira nota adesiva.** Ctrl+V com texto na área de transferência cria um sticky
já preenchido, útil ao trazer requisitos de fora.

**8. Copiar/colar entre páginas e abas.** O clipboard grava JSON assinado no sistema, então dá
para copiar cards de uma página e colar em outra, inclusive em outra aba do navegador.
Conectores internos à seleção são religados às cópias.

**9. Duplicar página** e **exportar Trust Factor** direto pelo menu de contexto da barra lateral.

**10. Drag & drop na árvore** para mover páginas entre pastas.

**11. Ctrl+clique no card do Jira/Trello** abre o ticket direto do canvas.

**12. Painéis recolhíveis.** A barra lateral e o inspetor abrem/fecham pelos botões da
barra superior ou pelos atalhos `[` e `]`, o estado fica salvo entre sessões. Dar duplo
clique em um card de evento reabre o inspetor automaticamente.

**13. Undo/redo na barra superior** com estado habilitado/desabilitado em tempo real.

**14. Exportar apenas a seleção** no exportador de imagem, além de formato JPG para
arquivos menores.

---

## 6. Atalhos de teclado

| Ação | Atalho |
|---|---|
| Selecionar / Navegar | `V` / `H` ou `Espaço` |
| Card de evento | `E` |
| Nota adesiva / Texto | `N` / `T` |
| Retângulo / Círculo | `R` / `O` |
| Pin / Conector | `P` / `C` |
| Colar print ou elementos | `Ctrl + V` |
| Copiar seleção | `Ctrl + C` |
| Duplicar | `Ctrl + D` |
| Desfazer / Refazer | `Ctrl + Z` / `Ctrl + Shift + Z` |
| Selecionar tudo | `Ctrl + A` |
| Salvar agora | `Ctrl + S` |
| Excluir seleção | `Delete` |
| Mover 1px / 10px | Setas / `Shift` + Setas |
| Zoom | `Ctrl + Scroll` |
| Zoom 100% / Enquadrar | `Ctrl + 0` / `Shift + 1` |
| Barra lateral / Inspetor | `[` / `]` |
| Esta lista | `?` |

Duplo clique em nota adesiva ou texto edita direto no canvas.

---

## 7. API do back-end

| Método | Rota | Função |
|---|---|---|
| `GET` | `/api/tree` | Árvore completa da pasta papyrus |
| `POST` | `/api/folders` | Cria pasta |
| `POST` | `/api/pages` | Cria página de canvas |
| `GET` | `/api/page?path=` | Lê página (valida `json-type`) |
| `PUT` | `/api/page` | Grava página |
| `PATCH` | `/api/entry` | Renomeia |
| `DELETE` | `/api/entry?path=` | Exclui |
| `POST` | `/api/entry/move` | Move |
| `POST` | `/api/assets` | Upload de imagem |
| `GET`/`PUT` | `/api/templates` | Grupos de parâmetros |
| `GET` | `/api/dictionary` | Dicionário global consolidado |
| `POST` | `/api/export/trust` | Exportação Trust Factor |
| `GET` | `/api/gcs/status` | Diagnóstico da configuração do Google Cloud Storage |
| `POST` | `/api/export/gcs` | Upload genérico para o bucket configurado |
| `GET`/`PUT` | `/api/settings/gcs` | Lê/grava a configuração do GCS (aba Configurações) |
| `POST` | `/api/settings/gcs/test` | Testa lib + credencial + acesso ao bucket |
| `POST` | `/api/import/inline` | Importa arquivos enviados pelo navegador |

Todo caminho recebido é resolvido contra a raiz do papyrus e rejeitado se escapar dela.
A API não expõe caminhos absolutos nem a estrutura de pastas do host, o navegador de
diretórios do SO e a importação/gravação por caminho de disco foram removidos de propósito
para permitir rodar a ferramenta em um servidor compartilhado.

---

## 8. Notas de implementação

**Renderização do canvas.** Render incremental com diff por fingerprint: a cada alteração,
cada elemento é comparado (JSON) com a versão que gerou seu nó Konva, só o que mudou é
reconstruído; o restante é reaproveitado e reordenado para manter o Z correto. Conectores
são sempre recalculados (dependem da posição/altura dos elementos ancorados), mas são
baratos. Vários commits no mesmo frame são agrupados em um único render
(`requestAnimationFrame`). Durante um arrasto nada é reconstruído: o Konva move os nós e
só os conectores são recalculados em tempo real.

**Custo de pintura.** Todo conteúdo interno dos cards (textos, divisores, marcadores) tem
`listening: false`, o Konva deixa de desenhar o hit-canvas desses shapes, que era o item
mais caro do frame. Formas com sombra usam `perfectDrawEnabled: false` e
`shadowForStrokeEnabled: false`, e o `pixelRatio` é limitado a 2 em monitores com escala
alta do Windows. A validação de governança roda com debounce de 250ms em vez de a cada tecla.

**Conectores magnéticos.** `from`/`to` guardam apenas `{ id, anchor }`. A posição real é
recalculada no render escolhendo o par de âncoras mais curto entre os dois elementos, por isso
a seta sempre sai e chega pelo lado natural, mesmo depois de mover ou redimensionar os cards.

**Por que o card é editado no painel e não dentro do canvas.** São cerca de 20 campos e duas
tabelas de parâmetros; espremer isso dentro de um retângulo desenhado seria hostil. O card no
canvas funciona como resumo executivo, o inspetor é a ficha completa. O painel não se
re-renderiza quando a alteração vem dele mesmo, senão o input perderia o foco a cada tecla.

**Undo/redo por snapshot.** Mais confiável que comandos invertidos e irrelevante em custo nesta
escala. Limite de 80 passos.

**Offline.** O Konva é servido do `node_modules`. A única dependência externa é o Google Fonts;
sem internet, o fallback é Helvetica/Arial e nada quebra.

---

## 9. O que foi verificado

- **28 testes de API** cobrindo CRUD, validação do `json-type`, bloqueio de path traversal,
  dicionário (incluindo detecção de conflito de tipo), Trust Factor (com e sem gravação em
  disco, confirmando ausência de dados visuais no output), upload de assets, importação com
  arquivos válidos e inválidos.
- **Navegador real (Chromium/Playwright)**, sem nenhum erro de console: criação de página e
  card, normalização snake_case, injeção automática do módulo Ecommerce, geração do snippet
  `dataLayer`, painel de validação, conectores, copiar/colar, undo, bloqueio de conflito entre
  grupos, modais empilhados (exportador + seletor de pastas) e download do PNG.
