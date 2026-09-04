import crypto from 'crypto';

/**
 * In-memory session store.
 * In a production multi-instance cluster, this can be backed by Redis.
 * Structure: Map<sessionId, { accessToken: string, userId: number, email?: string, expiresAt: number, isDemo?: boolean }>
 */
const sessionStore = new Map();

/**
 * Temporary CSRF state store for OAuth authorization flow.
 * Map<state, { createdAt: number, redirectUri: string }>
 */
const stateStore = new Map();

// Periodic cleanup of expired sessions and states every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessionStore.entries()) {
    if (session.expiresAt && session.expiresAt < now) {
      sessionStore.delete(sessionId);
    }
  }
  for (const [state, data] of stateStore.entries()) {
    if (now - data.createdAt > 10 * 60 * 1000) { // 10 minutes TTL
      stateStore.delete(state);
    }
  }
}, 15 * 60 * 1000);

/**
 * Generates a random cryptographic state for CSRF protection in OAuth.
 */
export function generateOAuthState(redirectUri) {
  const state = crypto.randomBytes(24).toString('hex');
  stateStore.set(state, {
    createdAt: Date.now(),
    redirectUri,
  });
  return state;
}

/**
 * Validates and consumes an OAuth state token.
 */
export function validateAndConsumeOAuthState(state) {
  if (!state || !stateStore.has(state)) {
    return null;
  }
  const data = stateStore.get(state);
  stateStore.delete(state);
  
  // Check age (max 10 minutes)
  if (Date.now() - data.createdAt > 10 * 60 * 1000) {
    return null;
  }
  return data;
}

/**
 * Creates a server-side session for an authenticated VK user.
 * Access token is kept strictly in server memory and never sent to frontend.
 */
export function createSession({ accessToken, userId, email, expiresIn = 86400, isDemo = false }) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + (expiresIn * 1000);

  sessionStore.set(sessionId, {
    accessToken,
    userId: Number(userId),
    email: email || null,
    expiresAt,
    isDemo: Boolean(isDemo),
    createdAt: Date.now(),
  });

  return sessionId;
}

/**
 * Retrieves an active session by session ID.
 */
export function getSession(sessionId) {
  if (!sessionId) return null;
  const session = sessionStore.get(sessionId);
  if (!session) return null;

  if (session.expiresAt && session.expiresAt < Date.now()) {
    sessionStore.delete(sessionId);
    return null;
  }

  return session;
}

/**
 * Destroys an active session (logout).
 */
export function destroySession(sessionId) {
  if (!sessionId) return false;
  return sessionStore.delete(sessionId);
}

/**
 * Express middleware to ensure the request comes from an authenticated user.
 */
export function requireAuth(req, res, next) {
  const sessionId = req.cookies?.vk_session_id || req.headers['x-session-id'];
  const session = getSession(sessionId);

  if (!session) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Сессия истекла или пользователь не авторизован. Пожалуйста, войдите снова.',
    });
  }

  req.session = session;
  req.sessionId = sessionId;
  next();
}

/**
 * Exchanges authorization code for VK access token.
 * Calls https://oauth.vk.com/access_token securely on the server.
 */
export async function exchangeCodeForVkToken({ code, redirectUri, clientId, clientSecret }) {
  const tokenUrl = 'https://oauth.vk.com/access_token';
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code: code,
  });

  const response = await fetch(`${tokenUrl}?${params.toString()}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'VK-Chat-Exporter/1.0',
    },
  });

  const data = await response.json();

  if (data.error) {
    const errorDesc = data.error_description || data.error;
    throw new Error(`VK OAuth token exchange failed: ${errorDesc}`);
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in || 86400,
    userId: data.user_id,
    email: data.email,
  };
}
