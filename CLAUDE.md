# CLAUDE.md — Assistente: Sistema de Inteligência Pessoal
> Leia ANTES de qualquer alteração. Este arquivo é a fonte de verdade do projeto.
> Atualizado em: 2026-03-23 · Projeto recomeçado do zero.

---

## Quem é Pedro e o que é este sistema

Pedro Pertel (Vitória-ES) administra múltiplas frentes simultaneamente. Este sistema é seu **sistema operacional pessoal** — não um portal genérico, mas uma secretária executiva inteligente com IA (Claude) que conhece profundamente cada empresa, interpreta linguagem natural, age no banco de dados e ajuda a tomar decisões.

**Empresas gerenciadas:**
- **CEDTEC** — escola técnica em Vila Velha. Pedro é dono e faz 100% do marketing sozinho (Meta Ads)
- **Pincel Atômico** — sistema de gestão escolar. Pedro é diretor comercial/marketing, tem agência e setor comercial abaixo
- **Sítio Monte da Vitória** — projeto de café arábica nas montanhas capixabas. Fase de investimento, ainda sem receita
- **Gráfica** — sócio
- **Agência de Marketing** — gestor

**Uso real:** principalmente mobile (campo, roça, trânsito). Mobile é a plataforma primária, não secundária.

---

## URLs do projeto

| Recurso | URL |
|---------|-----|
| App em produção | https://assistente-two.vercel.app |
| GitHub | https://github.com/pedropertel/assistente |
| Supabase | https://msbwplsknncnxwsalumd.supabase.co |
| Supabase Dashboard | https://supabase.com/dashboard/project/msbwplsknncnxwsalumd |

---

## Stack — decisões tomadas, não mudar

| Camada | Tecnologia | Detalhe |
|--------|-----------|---------|
| Frontend | HTML + CSS + JS puro | SEM React, Vue, Angular, TypeScript |
| Módulos | ES Modules nativos | SEM Webpack, Vite, Rollup, bundler |
| Banco | Supabase (PostgreSQL) | Projeto `msbwplsknncnxwsalumd` |
| Auth | Supabase Auth | Email/senha |
| Storage | Supabase Storage | Buckets: `documentos`, `agentes` |
| IA | Claude Haiku 4.5 | Via Edge Function `chat-claude` |
| Hospedagem | Vercel | Deploy automático: `git push origin main` |
| PWA | Service Worker + manifest | Instalável no celular |

**Credenciais:**
- Supabase Anon Key: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zYndwbHNrbm5jbnh3c2FsdW1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4NTUzMTAsImV4cCI6MjA4OTQzMTMxMH0.qDSAYC8KQO_PQsdRrwsIdYWdkrwqO2riFiDjJ08zctI`
- ANTHROPIC_API_KEY: nos Secrets da Edge Function do Supabase
- Usuário: pedro.pertel@gmail.com

---

## Estrutura de arquivos

```
assistente/
├── index.html              # HTML estrutural + CSS Design System completo
├── manifest.json           # PWA manifest
├── sw.js                   # Service Worker (cache + push)
├── icon-192.png            # Ícone PWA
├── icon-512.png            # Ícone PWA
├── CLAUDE.md               # Este arquivo
├── js/
│   ├── app.js              # Entry point: auth, init, WINDOW BRIDGE
│   ├── core/
│   │   ├── supabase.js     # ⚠️ Cliente Supabase — instância ÚNICA
│   │   ├── store.js        # Estado global com pub/sub
│   │   ├── router.js       # Navegação entre páginas
│   │   ├── modal.js        # Sistema de modais empilháveis
│   │   ├── toast.js        # Notificações toast
│   │   └── utils.js        # Helpers: fmtDate, fmtMoney, debounce...
│   └── modules/
│       ├── dashboard.js    # Tela inicial com stat cards e gráficos
│       ├── tasks.js        # Kanban de tarefas
│       ├── agenda.js       # Eventos e calendário
│       ├── docs.js         # Gestão de documentos
│       ├── chat.js         # Chat com agentes de IA
│       ├── sitio.js        # Sítio Monte da Vitória
│       ├── cedtec.js       # CEDTEC + Meta Ads
│       └── config.js       # Configurações + gestão de agentes
└── supabase/
    └── functions/
        ├── chat-claude/
        │   └── index.ts    # IA Dispatch — processa mensagens
        ├── meta-sync/
        │   └── index.ts    # Sincroniza campanhas Meta Ads
        └── meta-balance/
            └── index.ts    # Saldo em tempo real Meta
```

---

## ⚠️ Regras que NUNCA podem ser violadas

### REGRA 1 — Window Bridge é obrigatório
Toda função chamada por `onclick` no HTML deve estar exposta no `window` via `app.js`.
**Sem isso: o clique não faz nada — sem erro visível, sem feedback.**

```js
// app.js — EXPOR TUDO que o HTML usa em onclick
window.signIn = signIn;
window.signOut = signOut;
window.goPage = (p) => router.goPage(p);
window.closeModal = () => modal.close();
window.showToast = (msg, type) => toast.show(msg, type);
// + todas as funções de módulos usadas no HTML
```

### REGRA 2 — Supabase: uma única instância
Criar o cliente APENAS em `js/core/supabase.js`. Nunca chamar `createClient()` em outro lugar.

```js
// js/core/supabase.js — ÚNICA instância
export const supabase = supabaseJs.createClient(SUPABASE_URL, SUPABASE_KEY);

// Em qualquer módulo — importar, não recriar:
import { supabase } from '../core/supabase.js';
```

### REGRA 3 — Auth via onAuthStateChange
`onAuthStateChange` é a ÚNICA fonte de verdade de login. Flag `appInitialized` evita dupla chamada.

```js
let appInitialized = false;
supabase.auth.onAuthStateChange((event, session) => {
  if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
    if (!appInitialized) { appInitialized = true; initApp(session); }
  }
  if (event === 'SIGNED_OUT') showLogin();
});
```

### REGRA 4 — Mobile primeiro
Todo CSS deve funcionar em 375px. Touch targets mínimo 44px. Sidebar vira drawer em mobile.

### REGRA 5 — Nunca refatorar sem pedir permissão
Refatorações não solicitadas quebraram o projeto anterior. Se identificar algo, **perguntar antes**.

### REGRA 6 — Um módulo por sessão
Não tocar em módulos que não foram pedidos. Módulos se comunicam via `store.js`.

### REGRA 7 — Sempre fazer deploy após alterar
```bash
git add .
git commit -m "tipo: descrição clara"
git push origin main
# Edge Functions (quando alteradas):
supabase functions deploy chat-claude --project-ref msbwplsknncnxwsalumd
```

---

## Regras de comportamento do Claude Code

- Leia este arquivo inteiro antes de começar qualquer sessão
- Faça mudanças **cirúrgicas** — apenas o necessário
- Antes de alterar um arquivo: leia ele completo primeiro
- Após qualquer alteração: faça o deploy e confirme que funciona
- Se não tiver certeza sobre algo: pergunte antes de implementar
- Atualize o vault (arquivos `.md`) após cada sessão conforme instrução do prompt

---

## Window Bridge — funções expostas no window

> Esta seção deve ser atualizada pelo Claude Code após cada sessão que adicionar novas funções.

```js
// AUTH
window.signIn = signIn;
window.signOut = signOut;

// NAVEGAÇÃO (com lazy load de módulos)
window.goPage = (page) => { router.goPage(page); /* carrega módulo */ };
window.toggleSidebar = toggleSidebar;

// MODAL
window.closeModal = () => modal.close();

// TOAST
window.showToast = (msg, type) => toast.show(msg, type);

// TEMA
window.toggleTheme = toggleTheme;

// TAREFAS
window.openNewTask = () => tasks.openNewTask();
window.openEditTask = (id) => tasks.openEditTask(id);
window.deleteTask = (id) => tasks.deleteTask(id);
window.moveTask = (id, status) => tasks.moveTask(id, status);
window.taskSave = (id) => tasks.saveTask(id);
window.tasksFilter = (id) => tasks.filterTasks(id);
window.tasksShowCol = (status) => tasks.showCol(status);

// AGENDA
window.openNewEvent = () => agenda.openNewEvent();
window.openEditEvent = (id) => agenda.openEditEvent(id);
window.deleteEvent = (id) => agenda.deleteEvent(id);
window.eventSave = (id) => agenda.saveEvent(id);
window.agendaPrevMonth = () => agenda.prevMonth();
window.agendaNextMonth = () => agenda.nextMonth();
window.agendaClickDay = (y, m, d) => agenda.clickDay(y, m, d);
window.evToggleDiaInteiro = () => agenda.toggleDiaInteiro();

// DOCUMENTOS
window.openNewFolder = () => docs.openNewFolder();
window.navigateFolder = (id) => docs.navigateFolder(id);
window.triggerUpload = () => docs.triggerUpload();
window.downloadDoc = (id) => docs.downloadDoc(id);
window.deleteDoc = (id) => docs.deleteDoc(id);
window.openFileViewer = (url, tipo) => docs.openFileViewer(url, tipo);
window.shareDoc = (id) => docs.shareDoc(id);
window.docsSaveFolder = () => docs.saveFolder();
window.docsHandleFiles = (files) => docs.handleFiles(files);
window.docsContextFolder = (id, e) => docs.contextFolder(id, e);
window.docsContextFile = (id, e) => docs.contextFile(id, e);
window.docsRenameFolder = (id) => docs.renameFolder(id);
window.docsDeleteFolder = (id) => docs.deleteFolder(id);
window.docsDeleteFile = (id) => docs.deleteDoc(id);

// CHAT
window.sendMsg = () => chat.sendMsg();
window.clearChat = () => chat.clearChat();
window.toggleMic = () => chat.toggleMic();
window.selectAgente = (slug) => chat.selectAgente(slug);
window.saveMemoria = (slug, texto) => chat.saveMemoria(slug, texto);
window.showAgentGrid = () => chat.showAgentGrid();
window.dismissMemoria = () => chat.dismissMemoria();
window.chatKeyDown = (e) => chat.keyDown(e);

// SÍTIO
window.sitioTab = (t) => sitio.tab(t);
window.openNewLanc = () => sitio.openNewLanc();
window.openEditLanc = (id) => sitio.openEditLanc(id);
window.deleteLanc = (id) => sitio.deleteLanc(id);
window.openNewCentro = () => sitio.openNewCentro();
window.openEditCentro = (id) => sitio.openEditCentro(id);
window.deleteCentro = (id) => sitio.deleteCentro(id);
window.sitioSaveLanc = (id) => sitio.saveLanc(id);
window.sitioSaveCentro = (id) => sitio.saveCentro(id);
window.sitioViewAttach = (url) => sitio.viewAttach(url);
window.sitioFilterCentro = (v) => sitio.setFilterCentro(v);
window.sitioFilterTipo = (v) => sitio.setFilterTipo(v);
window.sitioToggleDatas = () => sitio.toggleDatas();

// CEDTEC
window.cedtecTab = (t) => cedtec.tab(t);
window.cedtecSyncMeta = () => cedtec.syncMeta();
window.cedtecOpenRecarga = () => cedtec.openRecarga();
window.cedtecSaveRecarga = () => cedtec.saveRecarga();
window.cedtecDeleteRecarga = (id) => cedtec.deleteRecarga(id);

// CONFIGURAÇÕES
window.configTab = (t) => config.tab(t);
window.openNewAgente = () => config.openNewAgente();
window.openEditAgente = (id) => config.openEditAgente(id);
window.toggleAgente = (id, ativo) => config.toggleAgente(id, ativo);
window.uploadAgentePhoto = (id) => config.uploadAgentePhoto(id);
window.uploadAgenteFile = (id) => config.uploadAgenteFile(id);
window.deleteMemoriaAgente = (id, idx) => config.deleteMemoria(id, idx);
window.configSaveAgente = (id) => config.saveAgente(id);
window.configAgTab = (t) => config.agTab(t);
window.configAutoSlug = () => config.autoSlug();
window.configTestMeta = () => config.testMeta();
window.configSaveMeta = () => config.saveMeta();
```

---

## Banco de dados — tabelas

```
entidades              — 6 empresas/entidades fixas
agentes                — personalidades de IA (nome, foto, cor, persona, contexto, memorias, inteligencia)
tarefas                — kanban (titulo, entidade_id, status, prioridade, data_vencimento, lembrete_em)
eventos                — agenda (titulo, data_inicio, data_fim, local, entidade_id, dia_inteiro)
pastas                 — hierarquia de documentos (self-referential)
documentos             — arquivos (arquivo_url no Storage bucket "documentos")
chat_mensagens         — histórico (role, conteudo, contexto, agente_slug)
configuracoes          — chave/valor genérico

cedtec_conta_meta      — saldo e gastos Meta Ads
cedtec_recargas        — histórico de recargas da conta Meta
meta_conexoes          — credenciais Meta API (ad_account_id, access_token, status)
meta_campanhas_cache   — cache campanhas (unique: campaign_id)

sitio_categorias       — centros de custo (nome, cor, icone, tipo)
sitio_lancamentos      — lançamentos financeiros (valor, centro_custo_id, tipo, comprovante_url)

grafica_pedidos        — pedidos da gráfica (pendente implementação)
grafica_parcelas       — parcelas a receber (pendente implementação)
```

RLS habilitado em todas. Policy `allow_all` com `USING (true)`.

---

## Edge Function: chat-claude

**Modelo:** `claude-haiku-4-5-20251001` · **verify_jwt:** false

**Com agente específico** (agente_slug presente):
- Monta system prompt com: persona + contexto + memórias + inteligência + hora Brasília
- Passa histórico das últimas 10 mensagens
- Pode retornar `memory_suggest` para Pedro confirmar

**Sem agente** (chat geral):
- Dispatch em 2 etapas: classifica domínio → responde com system prompt especializado
- Domínios: `tarefas | agenda | cedtec | sitio | grafica | geral`

**Retorno:**
```json
{
  "reply": "texto",
  "action": "tarefa | evento | gasto | null",
  "actionData": {},
  "agente": "marcos",
  "memory_suggest": "texto opcional"
}
```

---

## Agentes — arquitetura resumida

| Arquivo | Quem mantém | Frequência |
|---------|-------------|-----------|
| `— Persona.md` | Pedro escreve | Raramente |
| `— Contexto.md` | Sistema automático + Pedro | Frequente |
| `— Memórias.md` | Agente sugere, Pedro confirma | Após conversas |
| `— Inteligência.md` | Pedro adiciona + agente contribui | Conforme evolui |

Slugs: `marcos`, `bruno`, `marcela`, `alemao`
Histórico separado: `chat_mensagens WHERE agente_slug = '{slug}'`

---

## Status atual do projeto

> ✅ Repositório criado: github.com/pedropertel/assistente
> ✅ Vercel configurado: assistente-two.vercel.app
> ✅ Código: Fase 1 (Fundação) + Fase 2 (Módulos Core) concluídas (2026-03-24)
> ✅ Banco: 16 tabelas criadas, RLS, dados iniciais (2026-03-24)
> ✅ Módulos: Dashboard, Tarefas, Agenda, Documentos, Chat IA, Sítio, CEDTEC, Configurações
> 🔴 Edge Function chat-claude: deploy pendente (supabase functions deploy)
