# TypeRedirect

Sistema de redirecionamento de Typebots com controle de acesso por período.

## Como funciona

- Você cria links no painel admin
- Cada link tem uma URL única: `seudominio.com/online/abc123`
- Na primeira vez que o lead acessa, é redirecionado para o Typebot
- Se acessar novamente antes do período configurado, vê a página "Offline"
- Após o período (ex: 20 dias), o acesso é liberado automaticamente

---

## Deploy no EasyPanel

### 1. Suba o projeto no GitHub

```bash
git init
git add .
git commit -m "primeiro commit"
git remote add origin https://github.com/seuusuario/typebot-redirect.git
git push -u origin main
```

### 2. No EasyPanel

1. Crie um novo **App** → escolha **GitHub** como fonte
2. Selecione o repositório `typebot-redirect`
3. EasyPanel vai detectar o `Dockerfile` automaticamente

### 3. Crie o banco PostgreSQL

1. No EasyPanel, vá em **Services** → **+ New Service** → **PostgreSQL**
2. Dê um nome (ex: `typebot-db`)
3. Copie a `Connection String` gerada

### 4. Configure as variáveis de ambiente

No seu App no EasyPanel, vá em **Environment** e adicione:

```
DATABASE_URL=postgresql://... (cole a connection string do passo 3)
ADMIN_USER=admin
ADMIN_PASS=suasenhaforte
SESSION_SECRET=qualquer_string_longa_e_aleatoria
PORT=3000
BLOCK_DAYS=20
BASE_URL=https://e-volutionn.com
```

### 5. Configure o domínio

No EasyPanel, vá em **Domains** e aponte `e-volutionn.com` para o app.

### 6. Deploy!

Clique em **Deploy**. Em 1-2 minutos estará no ar.

---

## Uso diário

1. Acesse `seudominio.com/painel`
2. Faça login com as credenciais do `.env`
3. Cole o nome e URL do Typebot → clique **Criar link**
4. A URL gerada é copiada automaticamente → mande no Telegram

---

## Estrutura de arquivos

```
typebot-redirect/
├── src/
│   └── index.js          # Servidor principal (Express + PostgreSQL)
├── public/
│   ├── painel/
│   │   ├── index.html    # Painel admin
│   │   └── login.html    # Tela de login
├── Dockerfile            # Para deploy no EasyPanel
├── package.json
├── .env.example          # Modelo das variáveis de ambiente
└── .gitignore
```
