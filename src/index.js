require('dotenv').config();
const express = require('express');
const session = require('express-session');
const { Pool } = require('pg');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const BLOCK_DAYS = parseInt(process.env.BLOCK_DAYS || '20');

// PostgreSQL
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Inicializa tabelas
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      id VARCHAR(12) PRIMARY KEY,
      label VARCHAR(255) NOT NULL,
      typebot_url TEXT NOT NULL,
      block_days INT NOT NULL DEFAULT ${BLOCK_DAYS},
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS acessos (
      id SERIAL PRIMARY KEY,
      link_id VARCHAR(12) NOT NULL REFERENCES links(id),
      fingerprint VARCHAR(255) NOT NULL,
      ultimo_acesso TIMESTAMP NOT NULL DEFAULT NOW(),
      total_acessos INT NOT NULL DEFAULT 1,
      UNIQUE(link_id, fingerprint)
    );
  `);
  console.log('✅ Banco de dados pronto');
}

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'segredo_padrao',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 horas
}));
app.use(express.static(path.join(__dirname, '../public')));

// ─── Middleware de autenticação do painel ───────────────────────
function authGuard(req, res, next) {
  if (req.session.logado) return next();
  res.redirect('/painel/login');
}

// ─── Gera fingerprint do cliente ────────────────────────────────
function getFingerprint(req) {
  const ua = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  // Combina IP + User-Agent como fingerprint simples
  const str = ip.split(',')[0].trim() + '|' + ua;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

// ═══════════════════════════════════════════════════════════════
// ROTAS DE REDIRECIONAMENTO — /chatwhatsapp/:id
// ═══════════════════════════════════════════════════════════════

app.get('/chatwhatsapp/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query('SELECT * FROM links WHERE id = $1', [id]);
    if (!rows.length || !rows[0].active) {
      return res.sendFile(path.join(__dirname, '../public/offline.html'));
    }

    const link = rows[0];
    const fingerprint = getFingerprint(req);
    const blockMs = link.block_days * 24 * 60 * 60 * 1000;
    const agora = new Date();

    // Verifica acesso anterior
    const { rows: acessos } = await pool.query(
      'SELECT * FROM acessos WHERE link_id = $1 AND fingerprint = $2',
      [id, fingerprint]
    );

    if (acessos.length > 0) {
      const ultimoAcesso = new Date(acessos[0].ultimo_acesso);
      const diff = agora - ultimoAcesso;

      if (diff < blockMs) {
        // Bloqueado — ainda dentro do período
        const diasRestantes = Math.ceil((blockMs - diff) / (1000 * 60 * 60 * 24));
        return res.send(paginaOffline(diasRestantes));
      } else {
        // Período passou — libera e atualiza
        await pool.query(
          'UPDATE acessos SET ultimo_acesso = $1, total_acessos = total_acessos + 1 WHERE link_id = $2 AND fingerprint = $3',
          [agora, id, fingerprint]
        );
        return res.redirect(link.typebot_url);
      }
    } else {
      // Primeiro acesso — registra e redireciona
      await pool.query(
        'INSERT INTO acessos (link_id, fingerprint, ultimo_acesso) VALUES ($1, $2, $3)',
        [id, fingerprint, agora]
      );
      return res.redirect(link.typebot_url);
    }
  } catch (err) {
    console.error(err);
    res.status(500).send('Erro interno');
  }
});

// ═══════════════════════════════════════════════════════════════
// PAINEL ADMIN
// ═══════════════════════════════════════════════════════════════

// Login
app.get('/painel/login', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/painel/login.html'));
});

app.post('/painel/login', (req, res) => {
  const { usuario, senha } = req.body;
  if (usuario === process.env.ADMIN_USER && senha === process.env.ADMIN_PASS) {
    req.session.logado = true;
    return res.redirect('/painel');
  }
  res.redirect('/painel/login?erro=1');
});

app.get('/painel/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/painel/login');
});

// Painel principal
app.get('/painel', authGuard, (req, res) => {
  res.sendFile(path.join(__dirname, '../public/painel/index.html'));
});

// ─── API do painel ───────────────────────────────────────────────

// Listar links
app.get('/api/links', authGuard, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT l.*, COUNT(a.id) as total_leads
    FROM links l
    LEFT JOIN acessos a ON a.link_id = l.id
    GROUP BY l.id
    ORDER BY l.created_at DESC
  `);
  const base = process.env.BASE_URL || `http://localhost:${PORT}`;
  res.json(rows.map(r => ({ ...r, url_gerada: `${base}/chatwhatsapp/${r.id}` })));
});

// Criar link
app.post('/api/links', authGuard, async (req, res) => {
  const { label, typebot_url, block_days } = req.body;
  if (!label || !typebot_url) return res.status(400).json({ erro: 'label e typebot_url são obrigatórios' });

  const id = nanoid(8);
  const dias = parseInt(block_days) || BLOCK_DAYS;

  await pool.query(
    'INSERT INTO links (id, label, typebot_url, block_days) VALUES ($1, $2, $3, $4)',
    [id, label, typebot_url, dias]
  );

  const base = process.env.BASE_URL || `http://localhost:${PORT}`;
  res.json({ id, url_gerada: `${base}/chatwhatsapp/${id}` });
});

// Ativar/desativar link
app.patch('/api/links/:id', authGuard, async (req, res) => {
  const { active } = req.body;
  await pool.query('UPDATE links SET active = $1 WHERE id = $2', [active, req.params.id]);
  res.json({ ok: true });
});

// Deletar link
app.delete('/api/links/:id', authGuard, async (req, res) => {
  await pool.query('DELETE FROM acessos WHERE link_id = $1', [req.params.id]);
  await pool.query('DELETE FROM links WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// Stats de um link
app.get('/api/links/:id/stats', authGuard, async (req, res) => {
  const { rows } = await pool.query(
    'SELECT fingerprint, ultimo_acesso, total_acessos FROM acessos WHERE link_id = $1 ORDER BY ultimo_acesso DESC LIMIT 50',
    [req.params.id]
  );
  res.json(rows);
});

// ═══════════════════════════════════════════════════════════════
// PÁGINA DE OFFLINE (HTML inline para quando está bloqueado)
// ═══════════════════════════════════════════════════════════════

function paginaOffline(diasRestantes) {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Indisponível</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f0f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 40px 32px;
      max-width: 380px;
      width: 100%;
      text-align: center;
    }
    .icon {
      width: 64px; height: 64px;
      background: #1f1f1f;
      border: 1px solid #333;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      margin: 0 auto 24px;
      font-size: 28px;
    }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 10px; }
    p { font-size: 14px; color: #888; line-height: 1.6; margin-bottom: 8px; }
    .badge {
      display: inline-block;
      background: #ff4d4d18;
      color: #ff6b6b;
      border: 1px solid #ff4d4d30;
      border-radius: 8px;
      padding: 6px 18px;
      font-size: 13px;
      font-weight: 500;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">📵</div>
    <h1>Typebot Offline</h1>
    <p>Você já acessou este conteúdo recentemente.</p>
    <p>Ele estará disponível novamente em:</p>
    <div class="badge">${diasRestantes} dia${diasRestantes !== 1 ? 's' : ''}</div>
  </div>
</body>
</html>`;
}

// ─── Start ───────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📋 Painel: http://localhost:${PORT}/painel`);
  });
}).catch(err => {
  console.error('Erro ao iniciar banco:', err);
  process.exit(1);
});
