# Papyrus `v2.5.0`

Ferramenta visual de **planejamento de mensuração e mapas de coleta para o GA4**.
Canvas infinito para desenhar a arquitetura de dados de uma tela, prints de referência,
pins, conectores e cards de evento com parâmetros tipados, e exportar isso como
contrato de coleta para o time de engenharia.

<img width="1024" height="559" alt="image" src="https://github.com/user-attachments/assets/b36510bd-326b-4f93-8413-f450dc301165" />

(Imagem gerada por I.A para representar o projeto)

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
Papyrus/                        # raiz do projeto no disco
├── server/                     # Back-end Express
│   ├── index.js                # Bootstrap, estáticos, montagem das rotas
│   ├── lib/
│   │   ├── paths.js            # Resolução segura de caminhos (anti path-traversal)
│   │   ├── papyrus.js          # Formato do arquivo, validação, varredura da árvore
│   │   ├── folder-colors.js    # Cor do ícone de cada pasta da barra lateral
│   │   └── gcs.js              # Adapter do Google Cloud Storage
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
│       │   └── exporters.js    # Tirar foto (PNG/JPG) e Exportar (JSON)
│       ├── quality/
│       │   ├── validation.js   # Validador de governança
│       │   └── snippet.js      # Geradores de dataLayer / gtag / JSON Schema
│       └── ui/
│           ├── modal.js        # Diálogos empilháveis e menu de contexto
│           └── toast.js
│
└── papyrus/                    # Criada na primeira execução, seus arquivos
    ├── _assets/                # Imagens coladas no canvas
    └── _system/                # Grupos de parâmetros, cores de pasta, config do GCS
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
        "eventParams": [
          { "id": "p1", "name": "event_id", "type": "string", "required": true, "example": "d080068080-p1757203200-6k3f9zq" },
          { "id": "p2", "name": "currency", "type": "string", "required": true, "example": "BRL" }
        ],
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
7. **Exporte** o JSON para o bucket, de onde o time de engenharia consome.

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

### O `event_id`

Todo card nasce com um parâmetro `event_id` obrigatório e já preenchido. É a chave que
amarra o planejamento ao dado coletado, então não dá para depender de alguém lembrar de
criá-la. O valor tem três partes separadas por hífen:

| Parte | Formato | Exemplo |
|---|---|---|
| Pasta | `d` + código ASCII de cada letra do nome da pasta onde a página está | `d099111114` (pasta `cor`) |
| Momento | `p` + timestamp da criação, em segundos | `p1757203200` |
| Sorteio | `6` + 6 caracteres aleatórios | `6k3f9zq` |

Os códigos ASCII vão com zero à esquerda (3 dígitos) para o prefixo continuar
identificando a pasta sem ambiguidade. Página na raiz do workspace usa a própria pasta
`papyrus`.

O campo é editável como qualquer outro parâmetro: o valor gerado é um ponto de partida, e
dá para trocar por um id que venha de outro sistema.

**O que não pode é repetir.** Dois cards com o mesmo `event_id` chegam como o mesmo evento
no GA4, então a unicidade é cobrada em dois lugares:

- o **validador do rodapé** acusa erro quando dois cards da página aberta têm o mesmo
  `event_id`, ou quando algum card está sem o campo preenchido;
- o **Dicionário Global** cruza o workspace inteiro e mostra, no topo, todo `event_id`
  usado por mais de um card, dizendo em quais eventos e páginas ele aparece. O validador
  só enxerga a página aberta, então colisão entre páginas aparece aqui.

Cópia de card é card novo, e já nasce com id próprio: colar (`Ctrl + V`), duplicar
(`Ctrl + D`) e duplicar a página inteira geram um `event_id` para cada cópia. Ao colar em
outra pasta, o id sai com o prefixo da pasta de destino. A importação de páginas é a
exceção: ela traz um mapa que já existe, então preserva os ids como estão.

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
- **`event_id` repetido**, todo id usado por mais de um card, com os eventos e páginas onde
  ele aparece. Também em destaque no topo.

Nome de evento repetido não entra nessa lista: o mesmo evento declarado em páginas
diferentes é normal. O que não pode repetir é o `event_id`.
- **Exportar CSV**, o de-para completo, com BOM para o Excel abrir com acentuação correta

### Organização da barra lateral

Pastas e páginas têm ícones coloridos. Página é sempre azul e **pasta é personalizável**:
a cor é escolhida na criação (laranja por padrão) e pode ser trocada quando quiser em
**Mudar a cor**, no menu de contexto da pasta. As cores ficam em
`papyrus/_system/folder-colors.json`, indexadas pelo caminho da pasta, e acompanham a
pasta quando ela é renomeada ou arrastada para outro lugar da árvore. Ficam fora das
pastas do usuário de propósito: cor é assunto de interface, não conteúdo do mapa de
coleta, e os JSONs de página continuam limpos.

### Tirar foto

PNG/JPG do canvas recortado no conteúdo (sem áreas vazias), 2× a 4×, fundo
branco/cinza/transparente, com opção de exportar apenas a seleção atual. A escala é
ajustada automaticamente se o mapa for grande demais para o limite de canvas do navegador.
A foto sai sempre pelo navegador: é material de apresentação e conversa, tem vida curta
e não precisa de versionamento.

### Exportar

JSON só com regra de negócio. Nenhuma coordenada, cor ou elemento visual.
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

**O escopo é sempre o workspace inteiro**, todas as páginas da pasta `papyrus`. Não dá
para exportar uma página isolada: contratos parciais circulando em paralelo, cada um
dizendo uma coisa, são o problema que o arquivo único resolve.

**O destino também é único: o bucket do Google Cloud Storage**, sem download. O contrato de
coleta precisa de um endereço só, compartilhado e versionado; um arquivo baixado na máquina
de quem exportou vira cópia divergente no dia seguinte. Sem o GCS configurado, o botão fica
desabilitado e o modal diz o que falta.

O nome do arquivo vem preenchido como `papyrus` e o campo é editável.

**A exportação só acontece com o workspace limpo.** Ao abrir o modal, o Papyrus lê todas as
páginas, roda o validador em cada uma e ainda cruza os `event_id` entre elas. Havendo erro,
os problemas aparecem listados por página e o botão fica desabilitado. Avisos não bloqueiam:
squad em branco ou gatilho sem descrição são coisas de mapa em andamento, e travar por elas
deixaria o export inalcançável.

O servidor repete a checagem de `event_id` por conta própria e recusa a requisição com `409`
se algum id faltar ou se repetir. O arquivo no bucket é lido como verdade pelo time de
engenharia, então essa garantia não pode depender só da tela.

Por segurança, a interface **não expõe nem grava em pastas da máquina do servidor**, não
há caminhos de disco em lugar nenhum da UI ou da API.

### Google Cloud Storage

Destino da exportação. A dependência não é instalada por padrão para manter a ferramenta
leve e offline. Para ativar:

1. Instale a lib oficial: `npm install @google-cloud/storage` (e reinicie o servidor)
2. Abra a aba **Configurações → Exportação, Google Cloud Storage** e informe o bucket,
   o prefixo (pasta dentro do bucket) e a credencial: **cole o conteúdo do JSON da service
   account** no campo mascarado (estilo senha). O conteúdo é validado e gravado pelo servidor
   em `papyrus/_system/gcs-service-account.json`, nunca é exibido de volta nem fica no
   navegador. Depois de salva, aparece a etiqueta “credencial salva ✓”, com opção de remover.
3. Clique em **Testar conexão**, o teste valida a lib, a credencial e o acesso ao bucket.

A service account precisa do papel **Storage Object Creator** (ou superior) e **Storage Bucket Viewer** no bucket.
Também dá para configurar por variáveis de ambiente, que têm prioridade sobre a aba
(os campos aparecem travados com a etiqueta `env`):

```bash
# PowerShell
$env:GCS_BUCKET="meu-bucket"; $env:GCS_PREFIX="papyrus/"; $env:GCS_KEYFILE="C:\chaves\sa.json"; npm start
```

Enquanto não estiver configurado, o botão **Exportar** abre o modal com o destino
explicando o que falta e o botão de confirmação desabilitado. O status pode ser
consultado em `GET /api/gcs/status`.

### Aba Configurações

- **Foto do canvas**, padrões de resolução, formato, fundo e margem que
  pré-preenchem o modal "Tirar foto" (salvos no navegador).
- **Google Cloud Storage**, bucket, prefixo, project id, service account e teste de conexão.

A aba não exibe nenhuma informação do servidor (caminhos, sistema operacional, runtime).

---

## 5. O que a ferramenta faz além do básico

### Validador de governança contínuo

Fica no rodapé do canvas, roda a cada alteração e aponta o problema antes de o mapa virar
ticket: nome fora de snake_case (com sugestão de correção), nome reservado do GA4 e prefixo
proibido (`ga_`, `google_`, `firebase_`), estouro dos limites oficiais (40 caracteres no nome,
25 parâmetros por evento), parâmetro duplicado no mesmo escopo, evento duplicado na página,
parâmetro obrigatório sem valor de exemplo, evento Ecommerce sem `currency`, sem `value` ou
sem `items[]`, campo de governança vazio e conector órfão. Clicar no problema centraliza o
canvas no card responsável.

### Geradores de código no card

São três botões, e a ideia é ir do planejamento para a implementação sem redigitar nada:

- `dataLayer.push`, já com o `push({ ecommerce: null })` recomendado pelo Google, a estrutura
  `ecommerce.items[]` montada, comentário de obrigatoriedade e cabeçalho com squad, gatilho e card
- `gtag()`, o equivalente na API gtag.js
- **JSON Schema**, para validar payload em teste automatizado

### Nomes sempre em snake_case

Ao sair do campo de nome, de evento ou de parâmetro, o texto é convertido, acentos incluídos.
O botão `snake_case` normaliza a tabela inteira de uma vez.

### Histórico e auto-save

Grava sozinho 700ms depois da última alteração. Digitar um nome inteiro consome **um** passo
de undo, e não trinta. O undo e o redo também estão na barra superior, com o estado
habilitado ou desabilitado em tempo real.

### Trabalho com vários elementos

Alinhar e distribuir em seleção múltipla (seis alinhamentos e duas distribuições). O
clipboard grava JSON assinado no sistema, então dá para copiar cards de uma página e colar
em outra, inclusive em outra aba do navegador; conector interno à seleção é religado às
cópias. Colar texto puro cria uma nota adesiva já preenchida, o que ajuda ao trazer
requisito de fora.

### Navegação e organização

Drag and drop na árvore para mover página entre pastas, duplicar página e exportar pelo
menu de contexto da barra lateral, e pasta colorida, com a cor escolhida na criação e
editável depois, para separar jornada, squad ou fase do projeto em uma árvore grande.

A barra lateral e o inspetor recolhem pelos botões da barra superior ou pelos atalhos `[` e
`]`, e o estado fica salvo entre sessões. Duplo clique em um card de evento reabre o
inspetor. Ctrl+clique no card do Jira ou do Trello abre o ticket direto do canvas.

### Outros

Conflito de tipo entre páginas aparece no Dicionário Global. A foto do canvas pode sair
apenas com a seleção atual, e em JPG quando o arquivo precisa ser menor. E todo card novo
já vem com o `event_id` automático, derivado da pasta, do momento da criação e de um
sorteio; os detalhes estão em [O `event_id`](#o-event_id).

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
| `GET` | `/api/tree` | Árvore completa da pasta papyrus (com a cor de cada pasta) |
| `POST` | `/api/folders` | Cria pasta (aceita `color`) |
| `PUT` | `/api/folders/color` | Troca a cor de uma pasta |
| `POST` | `/api/pages` | Cria página de canvas |
| `GET` | `/api/page?path=` | Lê página (valida `json-type`) |
| `PUT` | `/api/page` | Grava página |
| `PATCH` | `/api/entry` | Renomeia |
| `DELETE` | `/api/entry?path=` | Exclui |
| `POST` | `/api/entry/move` | Move |
| `POST` | `/api/assets` | Upload de imagem |
| `GET`/`PUT` | `/api/templates` | Grupos de parâmetros |
| `GET` | `/api/dictionary` | Dicionário global consolidado |
| `POST` | `/api/export/events` | Exporta o JSON de eventos para o bucket |
| `GET` | `/api/gcs/status` | Diagnóstico da configuração do Google Cloud Storage |
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

<img width="1901" height="942" alt="image" src="https://github.com/user-attachments/assets/0110f0cf-acde-4f89-bfde-efb4113aec6d" />

---
