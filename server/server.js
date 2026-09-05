import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import dotenv from 'dotenv';
import {
  generateOAuthState,
  validateAndConsumeOAuthState,
  createSession,
  getSession,
  destroySession,
  requireAuth,
  exchangeCodeForVkToken,
} from './auth.js';
import {
  getUserProfile,
  getConversations,
  getHistory,
  formatMessagesToTxt,
  demoData,
} from './vk.js';

dotenv.config();

export function createExpressApp() {
  const app = express();

  app.use(express.json());
  app.use(cookieParser());

  // Helper to determine base application URL
  function getAppBaseUrl(req) {
    if (process.env.APP_URL) {
      return process.env.APP_URL.replace(/\/+$/, '');
    }
    const forwardedProto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    return `${forwardedProto}://${host}`;
  }

  // 1. Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'VK Chat Exporter API',
      timestamp: new Date().toISOString(),
    });
  });

  // 2. Client configuration status
  app.get('/api/config', (req, res) => {
    const baseUrl = getAppBaseUrl(req);
    const redirectUri = `${baseUrl}/api/auth/vk/callback`;
    const isConfigured = Boolean(process.env.VK_CLIENT_ID && process.env.VK_CLIENT_SECRET);
    
    res.json({
      vkClientIdConfigured: isConfigured,
      clientId: isConfigured ? process.env.VK_CLIENT_ID : null,
      redirectUri,
      demoMode: process.env.DEMO_MODE === 'true' || !isConfigured,
    });
  });

  // 3. Initiate VK OAuth authorization URL
  app.get('/api/auth/vk/url', (req, res) => {
    const clientId = process.env.VK_CLIENT_ID;
    const baseUrl = getAppBaseUrl(req);
    const redirectUri = process.env.VK_REDIRECT_URI || `${baseUrl}/api/auth/vk/callback`;

    if (!clientId) {
      return res.status(400).json({
        error: 'VK_CLIENT_ID_MISSING',
        message: 'VK_CLIENT_ID не настроен на сервере в .env. Вы можете воспользоваться демо-режимом для тестирования интерфейса.',
        redirectUri,
      });
    }

    const state = generateOAuthState(redirectUri);

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      display: 'page',
      // scope: messages for chat history, offline for non-expiring/long-lived token
      scope: 'messages,offline',
      response_type: 'code',
      v: '5.199',
      state: state,
    });

    const vkAuthUrl = `https://oauth.vk.com/authorize?${params.toString()}`;

    res.json({
      url: vkAuthUrl,
      state,
      redirectUri,
    });
  });

  // 4. VK OAuth Callback route
  app.get(['/api/auth/vk/callback', '/api/auth/vk/callback/'], async (req, res) => {
    const { code, state, error, error_description } = req.query;

    if (error) {
      return res.send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
          <meta charset="utf-8">
          <title>Ошибка авторизации VK</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; background: #fafafa; color: #1e293b; text-align: center; }
            .card { max-width: 480px; margin: 0 auto; background: #fff; padding: 2rem; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
            h2 { color: #dc2626; margin-top: 0; }
            p { line-height: 1.5; color: #475569; }
            button { background: #2787F5; color: #fff; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; margin-top: 1rem; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>Ошибка авторизации</h2>
            <p>${escapeHtml(error_description || error || 'Пользователь отменил авторизацию')}</p>
            <button onclick="window.close()">Закрыть окно</button>
          </div>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'VK_AUTH_ERROR', error: ${JSON.stringify(error_description || error)} }, '*');
            }
          </script>
        </body>
        </html>
      `);
    }

    if (!code) {
      return res.status(400).send('Код авторизации отсутствует');
    }

    // Validate CSRF state
    const stateData = validateAndConsumeOAuthState(state);
    if (!stateData) {
      return res.status(403).send('Недействительный или просроченный токен сессии (state)');
    }

    try {
      const clientId = process.env.VK_CLIENT_ID;
      const clientSecret = process.env.VK_CLIENT_SECRET;
      const redirectUri = stateData.redirectUri;

      if (!clientId || !clientSecret) {
        throw new Error('Параметры VK_CLIENT_ID или VK_CLIENT_SECRET не заданы в .env');
      }

      // Exchange authorization code for VK access token
      const tokenResult = await exchangeCodeForVkToken({
        code,
        redirectUri,
        clientId,
        clientSecret,
      });

      // Create secure server-side session
      const sessionId = createSession({
        accessToken: tokenResult.accessToken,
        userId: tokenResult.userId,
        email: tokenResult.email,
        expiresIn: tokenResult.expiresIn,
        isDemo: false,
      });

      // Set secure cookie for iframe & cross-origin compatibility
      res.cookie('vk_session_id', sessionId, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: (tokenResult.expiresIn || 86400) * 1000,
      });

      // Respond with popup closer script that notifies the main window
      res.send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head>
          <meta charset="utf-8">
          <title>Авторизация успешна</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f8fafc; color: #0f172a; text-align: center; }
            .box { padding: 2rem; background: white; border-radius: 16px; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); max-width: 400px; }
            .icon { font-size: 3rem; margin-bottom: 1rem; }
            h2 { margin: 0 0 0.5rem; font-size: 1.3rem; }
            p { color: #64748b; font-size: 0.95rem; margin: 0; }
          </style>
        </head>
        <body>
          <div class="box">
            <div class="icon">✓</div>
            <h2>Вход выполнен успешно!</h2>
            <p>Возвращаемся в приложение...</p>
          </div>
          <script>
            try {
              if (window.opener) {
                window.opener.postMessage({ type: 'VK_AUTH_SUCCESS', sessionId: '${sessionId}' }, '*');
                setTimeout(() => window.close(), 400);
              } else {
                window.location.href = '/';
              }
            } catch (err) {
              window.location.href = '/';
            }
          </script>
        </body>
        </html>
      `);
    } catch (err) {
      console.error('VK OAuth exchange error:', err.message);
      res.status(500).send(`
        <!DOCTYPE html>
        <html lang="ru">
        <head><meta charset="utf-8"><title>Ошибка сервера</title></head>
        <body style="font-family:sans-serif; text-align:center; padding:2rem;">
          <h2 style="color:#b91c1c;">Не удалось завершить авторизацию</h2>
          <p>${escapeHtml(err.message)}</p>
          <button onclick="window.close()" style="padding:8px 16px; cursor:pointer;">Закрыть</button>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'VK_AUTH_ERROR', error: ${JSON.stringify(err.message)} }, '*');
            }
          </script>
        </body>
        </html>
      `);
    }
  });

  // 5. Demo / Sandbox mode login for instant testing without VK developer setup
  app.post('/api/auth/demo-login', (req, res) => {
    const sessionId = createSession({
      accessToken: 'demo_token_mock',
      userId: demoData.user.id,
      email: 'demo@example.com',
      expiresIn: 86400,
      isDemo: true,
    });

    res.cookie('vk_session_id', sessionId, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 86400 * 1000,
    });

    res.json({
      success: true,
      sessionId,
      user: demoData.user,
      isDemo: true,
    });
  });

  // 5b. Direct Token Login (Supports standalone/Kate tokens with messages scope without dev.vk.com hurdles)
  app.post('/api/auth/token-login', async (req, res) => {
    try {
      let { token } = req.body || {};
      if (!token && process.env.VK_ACCESS_TOKEN) {
        token = process.env.VK_ACCESS_TOKEN;
      }

      if (!token || typeof token !== 'string') {
        return res.status(400).json({ error: 'Токен VK обязателен' });
      }

      // Auto-extract access_token if the user pasted the entire blank.html#access_token=... URL
      let cleanToken = token.trim();
      let extractedUserId = null;
      const tokenMatch = cleanToken.match(/access_token=([^&]+)/);
      if (tokenMatch) {
        cleanToken = tokenMatch[1];
      }
      const userMatch = token.match(/user_id=([^&]+)/);
      if (userMatch) {
        extractedUserId = userMatch[1];
      }

      // Verify token with VK API users.get
      const user = await getUserProfile(cleanToken, extractedUserId);

      const sessionId = createSession({
        accessToken: cleanToken,
        userId: user.id,
        expiresIn: 30 * 86400, // 30 days
        isDemo: false,
      });

      res.cookie('vk_session_id', sessionId, {
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        maxAge: 30 * 86400 * 1000,
      });

      res.json({
        success: true,
        sessionId,
        accessToken: cleanToken,
        user,
        isDemo: false,
      });
    } catch (err) {
      console.error('Token login error:', err.message);
      res.status(401).json({
        error: 'INVALID_TOKEN',
        message: err.message || 'Не удалось авторизоваться по токену VK',
      });
    }
  });

  // 6. Current authenticated user profile
  app.get('/api/auth/me', requireAuth, async (req, res) => {
    try {
      if (req.session.isDemo) {
        return res.json({
          authenticated: true,
          isDemo: true,
          user: demoData.user,
        });
      }

      const profile = await getUserProfile(req.session.accessToken, req.session.userId || undefined);
      if (!req.session.userId && profile.id) {
        req.session.userId = profile.id;
      }
      res.json({
        authenticated: true,
        sessionId: req.sessionId,
        isDemo: false,
        user: profile,
      });
    } catch (err) {
      console.error('Error fetching user profile:', err.message);
      if (err.code === 5) {
        destroySession(req.sessionId);
        res.clearCookie('vk_session_id');
        return res.status(401).json({
          authenticated: false,
          error: 'TOKEN_EXPIRED',
          message: 'Сессия VK и стекла. Пожалуйста, выполните повторный вход.',
        });
      }
      res.status(500).json({
        error: 'PROFILE_FETCH_FAILED',
        message: err.message,
      });
    }
  });

  // 7. Logout endpoint
  app.post('/api/auth/logout', (req, res) => {
    const bearerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '')?.trim();
    const sessionId = req.cookies?.vk_session_id || req.headers['x-session-id'] || bearerToken;
    if (sessionId) {
      destroySession(sessionId);
    }
    res.clearCookie('vk_session_id', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
    });
    res.json({ success: true, message: 'Вы успешно вышли из системы' });
  });

  // 8. Conversations / Dialogs list
  app.get('/api/dialogs', requireAuth, async (req, res) => {
    const offset = parseInt(req.query.offset, 10) || 0;
    const count = parseInt(req.query.count, 10) || 20;
    const search = (req.query.search || '').trim().toLowerCase();

    try {
      if (req.session.isDemo) {
        let list = demoData.dialogs;
        if (search) {
          list = list.filter(d => 
            d.title.toLowerCase().includes(search) || 
            (d.lastMessage?.text && d.lastMessage.text.toLowerCase().includes(search))
          );
        }
        const paged = list.slice(offset, offset + count);
        return res.json({
          total: list.length,
          offset,
          count: paged.length,
          dialogs: paged,
          isDemo: true,
        });
      }

      const result = await getConversations(req.session.accessToken, { offset, count });
      
      // Optional client search filter
      if (search && result.dialogs) {
        result.dialogs = result.dialogs.filter(d => 
          d.title.toLowerCase().includes(search) ||
          (d.lastMessage?.text && d.lastMessage.text.toLowerCase().includes(search))
        );
      }

      res.json({
        ...result,
        isDemo: false,
      });
    } catch (err) {
      console.error('Error fetching conversations:', err.message);

      // Explicit handling of VK limitation: Error 15
      if (err.code === 15) {
        return res.status(403).json({
          error: 'VK_MESSAGES_ACCESS_DENIED',
          code: 15,
          message: 'VK API отклонил запрос сообщений (Ошибка 15: Access Denied). Для доступа к сообщениям VK требует специального подтверждения или Standalone-приложения.',
          help: 'Вы можете переключиться в режим демонстрации или ознакомиться с инструкцией в README.',
          canUseDemo: true,
        });
      }

      res.status(500).json({
        error: 'DIALOGS_FETCH_ERROR',
        message: err.message,
      });
    }
  });

  // 9. Messages history for a single conversation
  app.get('/api/dialogs/:peerId/messages', requireAuth, async (req, res) => {
    const peerId = parseInt(req.params.peerId, 10);
    const offset = parseInt(req.query.offset, 10) || 0;
    const count = parseInt(req.query.count, 10) || 50;

    if (!peerId) {
      return res.status(400).json({ error: 'INVALID_PEER_ID', message: 'Некорректный ID диалога' });
    }

    try {
      if (req.session.isDemo) {
        const fullHistory = demoData.messages[peerId] || [];
        const slice = fullHistory.slice(offset, offset + count);
        return res.json({
          total: fullHistory.length,
          offset,
          count: slice.length,
          messages: slice,
          isDemo: true,
        });
      }

      const result = await getHistory(req.session.accessToken, {
        peerId,
        offset,
        count,
      });

      res.json({
        ...result,
        isDemo: false,
      });
    } catch (err) {
      console.error(`Error fetching messages for peer ${peerId}:`, err.message);
      if (err.code === 15) {
        return res.status(403).json({
          error: 'VK_MESSAGES_ACCESS_DENIED',
          code: 15,
          message: 'VK API отклонил доступ к сообщениям (Ошибка 15).',
        });
      }
      res.status(500).json({
        error: 'MESSAGES_FETCH_ERROR',
        message: err.message,
      });
    }
  });

  // 10. Direct TXT Export endpoint
  // Takes messages or fetches on server, formats them into pristine TXT, and serves file
  app.post('/api/dialogs/:peerId/export-txt', requireAuth, async (req, res) => {
    const peerId = parseInt(req.params.peerId, 10);
    const { dialogTitle = 'Диалог', clientMessages } = req.body || {};

    try {
      let messagesToFormat = [];

      // If client sent already-accumulated messages, use them; otherwise fetch from source
      if (Array.isArray(clientMessages) && clientMessages.length > 0) {
        messagesToFormat = clientMessages;
      } else if (req.session.isDemo) {
        messagesToFormat = demoData.messages[peerId] || [];
      } else {
        // Fetch first batch of messages directly
        const history = await getHistory(req.session.accessToken, {
          peerId,
          offset: 0,
          count: 200,
        });
        messagesToFormat = history.messages || [];
      }

      const txtContent = formatMessagesToTxt(messagesToFormat, dialogTitle);

      // Safe ASCII / URL-encoded filename for cross-platform support
      const safeTitle = (dialogTitle || 'chat')
        .replace(/[^a-zA-Zа-яА-Я0-9_-]/g, '_')
        .substring(0, 40);
      const filename = `vk_${safeTitle}_${peerId}.txt`;
      const encodedFilename = encodeURIComponent(filename);

      // Prepend UTF-8 BOM (\uFEFF) so Windows Notepad, macOS, Linux render Russian characters perfectly
      const bomBuffer = Buffer.from('\uFEFF', 'utf-8');
      const textBuffer = Buffer.from(txtContent, 'utf-8');
      const fullBuffer = Buffer.concat([bomBuffer, textBuffer]);

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      res.setHeader('Content-Length', fullBuffer.length);
      res.send(fullBuffer);
    } catch (err) {
      console.error('TXT Export error:', err.message);
      res.status(500).json({
        error: 'EXPORT_FAILED',
        message: 'Не удалось сформировать TXT файл: ' + err.message,
      });
    }
  });

  // Static file serving for client files
  const clientDir = path.join(process.cwd(), 'client');
  app.use(express.static(clientDir));

  // In production, fallback to index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) {
      return next();
    }
    res.sendFile(path.join(clientDir, 'index.html'));
  });

  return app;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Standalone execution support
const isMainModule = process.argv[1] && process.argv[1].endsWith('server.js');
if (isMainModule) {
  const PORT = process.env.PORT || 3000;
  const app = createExpressApp();
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[VK Chat Exporter] Server running on http://0.0.0.0:${PORT}`);
  });
}
