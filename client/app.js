/**
 * VK Chat Exporter — Client Application Logic
 * Clean Vanilla JavaScript (ES6+) with full mobile-first responsiveness.
 */

// Application State
const state = {
  user: null,
  sessionId: localStorage.getItem('vk_session_id') || null,
  token: localStorage.getItem('vk_token') || null,
  dialogs: [],
  dialogsOffset: 0,
  dialogsTotal: 0,
  selectedDialog: null,
  messages: [],
  messagesOffset: 0,
  messagesTotal: 0,
  isLoadingDialogs: false,
  isLoadingMessages: false,
  isExporting: false,
  searchQuery: '',
};

/**
 * Robust API fetch wrapper.
 * Transmits x-session-id and x-vk-token headers so authentication succeeds
 * reliably even in sandboxed iframes where third-party cookies are blocked by modern browsers.
 */
async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});

  const currentSessionId = state.sessionId || localStorage.getItem('vk_session_id');
  if (currentSessionId && !headers.has('x-session-id')) {
    headers.set('x-session-id', currentSessionId);
  }

  const currentToken = state.token || localStorage.getItem('vk_token');
  if (currentToken && !headers.has('x-vk-token')) {
    headers.set('x-vk-token', currentToken);
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });
}

// DOM Elements
const elements = {
  // Screens
  guestScreen: document.getElementById('guestScreen'),
  appScreen: document.getElementById('appScreen'),

  // Header & Auth
  userWidget: document.getElementById('userWidget'),
  userAvatar: document.getElementById('userAvatar'),
  userName: document.getElementById('userName'),
  userStatus: document.getElementById('userStatus'),
  logoutBtn: document.getElementById('logoutBtn'),
  vkLoginBtn: document.getElementById('vkLoginBtn'),
  demoLoginBtn: document.getElementById('demoLoginBtn'),
  infoModalBtn: document.getElementById('infoModalBtn'),

  // Panes
  paneDialogs: document.getElementById('paneDialogs'),
  paneChat: document.getElementById('paneChat'),
  backToDialogsBtn: document.getElementById('backToDialogsBtn'),

  // Dialogs
  dialogSearchInput: document.getElementById('dialogSearchInput'),
  clearSearchBtn: document.getElementById('clearSearchBtn'),
  dialogsCountLabel: document.getElementById('dialogsCountLabel'),
  refreshDialogsBtn: document.getElementById('refreshDialogsBtn'),
  dialogsList: document.getElementById('dialogsList'),
  loadMoreDialogsBtn: document.getElementById('loadMoreDialogsBtn'),

  // Chat View
  chatPlaceholder: document.getElementById('chatPlaceholder'),
  activeChatContent: document.getElementById('activeChatContent'),
  chatHeaderAvatar: document.getElementById('chatHeaderAvatar'),
  chatHeaderTitle: document.getElementById('chatHeaderTitle'),
  chatLoadedCount: document.getElementById('chatLoadedCount'),
  chatTotalCount: document.getElementById('chatTotalCount'),
  loadMoreMessagesBtn: document.getElementById('loadMoreMessagesBtn'),
  messagesList: document.getElementById('messagesList'),
  downloadTxtBtn: document.getElementById('downloadTxtBtn'),
  downloadTxtBottomBtn: document.getElementById('downloadTxtBottomBtn'),

  // Modal & Toast
  infoModal: document.getElementById('infoModal'),
  closeInfoModalBtn: document.getElementById('closeInfoModalBtn'),
  confirmInfoModalBtn: document.getElementById('confirmInfoModalBtn'),
  tokenLoginBtn: document.getElementById('tokenLoginBtn'),
  tokenModal: document.getElementById('tokenModal'),
  closeTokenModalBtn: document.getElementById('closeTokenModalBtn'),
  tokenInput: document.getElementById('tokenInput'),
  submitTokenBtn: document.getElementById('submitTokenBtn'),

  // Direct Token Login on Main View
  directTokenInput: document.getElementById('directTokenInput'),
  submitDirectTokenBtn: document.getElementById('submitDirectTokenBtn'),
  pasteClipboardBtn: document.getElementById('pasteClipboardBtn'),

  // VK Archive Import
  archiveDropzone: document.getElementById('archiveDropzone'),
  archiveDirectInput: document.getElementById('archiveDirectInput'),
  archiveResultBox: document.getElementById('archiveResultBox'),
  archiveResultTitle: document.getElementById('archiveResultTitle'),
  archiveChatsList: document.getElementById('archiveChatsList'),

  // Paste / Manual Modal
  pasteChatBtn: document.getElementById('pasteChatBtn'),
  pasteChatModal: document.getElementById('pasteChatModal'),
  closePasteModalBtn: document.getElementById('closePasteModalBtn'),
  cancelPasteModalBtn: document.getElementById('cancelPasteModalBtn'),
  rawChatText: document.getElementById('rawChatText'),
  chatFileInput: document.getElementById('chatFileInput'),
  parsedStatsLabel: document.getElementById('parsedStatsLabel'),
  processAndDownloadTxtBtn: document.getElementById('processAndDownloadTxtBtn'),
  toastContainer: document.getElementById('toastContainer'),
};

// ==========================================================================
// Initialization
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  checkAuthStatus();
});

function initEventListeners() {
  // Login actions
  elements.vkLoginBtn?.addEventListener('click', startVkOAuth);
  elements.demoLoginBtn?.addEventListener('click', startDemoLogin);
  elements.logoutBtn?.addEventListener('click', logout);

  // Direct token login on guest page
  elements.submitDirectTokenBtn?.addEventListener('click', submitDirectTokenLogin);
  elements.directTokenInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitDirectTokenLogin();
  });

  // Clipboard paste button
  elements.pasteClipboardBtn?.addEventListener('click', async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && elements.directTokenInput) {
          elements.directTokenInput.value = text.trim();
          showToast('Адрес / токен вставлен из буфера!', 'success');
          // If it contains access_token or vk1.a, auto submit
          if (text.includes('access_token=') || text.startsWith('vk1.a')) {
            submitDirectTokenLogin();
          }
        } else {
          showToast('Буфер обмена пуст', 'info');
        }
      } else {
        elements.directTokenInput?.focus();
        showToast('Нажмите Ctrl+V или долгое нажатие для вставки', 'info');
      }
    } catch (err) {
      elements.directTokenInput?.focus();
      showToast('Разрешите доступ к буферу обмена или вставьте вручную (Ctrl+V)', 'info');
    }
  });

  // Archive dropzone & file picker
  elements.archiveDropzone?.addEventListener('click', () => {
    elements.archiveDirectInput?.click();
  });
  elements.archiveDirectInput?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleArchiveFile(file);
  });
  elements.archiveDropzone?.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.archiveDropzone.style.borderColor = '#2563eb';
    elements.archiveDropzone.style.background = '#eff6ff';
  });
  elements.archiveDropzone?.addEventListener('dragleave', (e) => {
    e.preventDefault();
    elements.archiveDropzone.style.borderColor = '#93c5fd';
    elements.archiveDropzone.style.background = '#f8fafc';
  });
  elements.archiveDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.archiveDropzone.style.borderColor = '#93c5fd';
    elements.archiveDropzone.style.background = '#f8fafc';
    const file = e.dataTransfer?.files?.[0];
    if (file) handleArchiveFile(file);
  });

  // Search dialogs
  let searchTimeout = null;
  elements.dialogSearchInput?.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    elements.clearSearchBtn?.classList.toggle('hidden', !state.searchQuery);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadDialogs(true);
    }, 300);
  });

  elements.clearSearchBtn?.addEventListener('click', () => {
    if (elements.dialogSearchInput) elements.dialogSearchInput.value = '';
    state.searchQuery = '';
    elements.clearSearchBtn?.classList.add('hidden');
    loadDialogs(true);
  });

  elements.refreshDialogsBtn?.addEventListener('click', () => {
    loadDialogs(true);
  });

  elements.loadMoreDialogsBtn?.addEventListener('click', () => {
    loadDialogs(false);
  });

  // Chat actions
  elements.backToDialogsBtn?.addEventListener('click', showDialogsPaneMobile);
  elements.loadMoreMessagesBtn?.addEventListener('click', () => {
    loadMessages(false);
  });

  elements.downloadTxtBtn?.addEventListener('click', exportToTxt);
  elements.downloadTxtBottomBtn?.addEventListener('click', exportToTxt);

  // Info Modal
  elements.infoModalBtn.addEventListener('click', () => {
    elements.infoModal.classList.remove('hidden');
  });
  elements.closeInfoModalBtn.addEventListener('click', () => {
    elements.infoModal.classList.add('hidden');
  });
  elements.confirmInfoModalBtn.addEventListener('click', () => {
    elements.infoModal.classList.add('hidden');
  });
  elements.infoModal.addEventListener('click', (e) => {
    if (e.target === elements.infoModal) {
      elements.infoModal.classList.add('hidden');
    }
  });

  // Token Login Modal
  elements.tokenLoginBtn?.addEventListener('click', () => {
    elements.tokenModal.classList.remove('hidden');
    setTimeout(() => elements.tokenInput?.focus(), 100);
  });
  elements.closeTokenModalBtn?.addEventListener('click', () => {
    elements.tokenModal.classList.add('hidden');
  });
  elements.tokenModal?.addEventListener('click', (e) => {
    if (e.target === elements.tokenModal) {
      elements.tokenModal.classList.add('hidden');
    }
  });
  elements.submitTokenBtn?.addEventListener('click', submitTokenLogin);
  elements.tokenInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitTokenLogin();
  });

  // Direct Paste Chat Modal
  elements.pasteChatBtn?.addEventListener('click', () => {
    elements.pasteChatModal.classList.remove('hidden');
    setTimeout(() => elements.rawChatText?.focus(), 100);
  });
  elements.closePasteModalBtn?.addEventListener('click', () => {
    elements.pasteChatModal.classList.add('hidden');
  });
  elements.cancelPasteModalBtn?.addEventListener('click', () => {
    elements.pasteChatModal.classList.add('hidden');
  });
  elements.pasteChatModal?.addEventListener('click', (e) => {
    if (e.target === elements.pasteChatModal) {
      elements.pasteChatModal.classList.add('hidden');
    }
  });

  elements.rawChatText?.addEventListener('input', updateParsedChatStats);
  elements.chatFileInput?.addEventListener('change', handleChatFileUpload);
  elements.processAndDownloadTxtBtn?.addEventListener('click', processAndDownloadPastedChat);

  // Cross-origin message listener for OAuth popup window
  window.addEventListener('message', handleOAuthWindowMessage);
}

function updateParsedChatStats() {
  const text = elements.rawChatText?.value || '';
  const lines = text.split('\n').filter(l => l.trim().length > 0);
  if (elements.parsedStatsLabel) {
    elements.parsedStatsLabel.textContent = `Символов: ${text.length} | Строк: ${lines.length}`;
  }
}

function handleChatFileUpload(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const content = event.target.result;
    if (elements.rawChatText) {
      elements.rawChatText.value = content;
      updateParsedChatStats();
      showToast(`Файл "${file.name}" успешно загружен!`, 'success');
    }
  };
  reader.onerror = () => {
    showToast('Ошибка при чтении файла', 'error');
  };
  reader.readAsText(file);
}

function processAndDownloadPastedChat() {
  const raw = elements.rawChatText?.value?.trim();
  if (!raw) {
    showToast('Сначала вставьте текст переписки или загрузите файл!', 'error');
    return;
  }

  const formattedMessages = [];
  const now = new Date();
  const defaultDateStr = formatDate(now);

  // 1. Check if raw text is HTML (e.g. from saved VK page or archive)
  if (raw.includes('<div') || raw.includes('<!DOCTYPE') || raw.includes('<html')) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');
      
      // Standard VK web messages
      const vkMessNodes = doc.querySelectorAll('.im-mess, .message, .item');
      if (vkMessNodes.length > 0) {
        vkMessNodes.forEach(node => {
          const author = node.querySelector('.im-mess--author, .author, .name')?.textContent?.trim() || 'Собеседник';
          const time = node.querySelector('._im_mess_date, .date, .time')?.textContent?.trim() || '';
          const text = node.querySelector('.im-mess--text, .text, div:last-child')?.textContent?.trim() || '';
          
          if (text) {
            const timeFormatted = time ? (time.includes(':') ? time : `${defaultDateStr} ${time}`) : defaultDateStr;
            formattedMessages.push(`${timeFormatted} - ${author}: ${text.replace(/\s+/g, ' ')}`);
          }
        });
      }
    } catch (e) {
      console.warn('HTML parse failed, fallback to text parser:', e);
    }
  }

  // 2. Fallback / Line-by-line smart VK text parser
  if (formattedMessages.length === 0) {
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let currentAuthor = 'Собеседник';
    let currentTime = defaultDateStr;
    let currentTextLines = [];

    const flushCurrent = () => {
      if (currentTextLines.length > 0) {
        const fullText = currentTextLines.join(' ');
        formattedMessages.push(`${currentTime} - ${currentAuthor}: ${fullText}`);
        currentTextLines = [];
      }
    };

    // Regex patterns for VK messages copy-paste
    // e.g. "Иван Иванов 14:32" or "Иван Иванов, 14:32" or "14:32 Иван Иванов"
    const headerRegex1 = /^([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)[,\s]+(\d{1,2}:\d{2}(?::\d{2})?)$/i;
    const headerRegex2 = /^(\d{1,2}:\d{2}(?::\d{2})?)[,\s]+([А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]+)?)$/i;
    // e.g. "24.05.2023 14:32 - Иван Иванов"
    const headerRegex3 = /^(\d{2}\.\d{2}\.\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)[,\s-]+([А-ЯЁA-Zа-яёa-z\s]+):?$/i;

    for (const line of lines) {
      const match1 = line.match(headerRegex1);
      const match2 = line.match(headerRegex2);
      const match3 = line.match(headerRegex3);

      if (match1) {
        flushCurrent();
        currentAuthor = match1[1].trim();
        currentTime = `${defaultDateStr.split(' ')[0]} ${match1[2].trim()}`;
      } else if (match2) {
        flushCurrent();
        currentAuthor = match2[2].trim();
        currentTime = `${defaultDateStr.split(' ')[0]} ${match2[1].trim()}`;
      } else if (match3) {
        flushCurrent();
        currentTime = match3[1].trim();
        currentAuthor = match3[2].trim();
      } else {
        // Content line
        currentTextLines.push(line);
      }
    }
    flushCurrent();
  }

  // If still empty, format all non-empty lines cleanly
  if (formattedMessages.length === 0) {
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((l, idx) => {
      formattedMessages.push(`${defaultDateStr} - Сообщение ${idx + 1}: ${l}`);
    });
  }

  // Create clean TXT file
  const header = [
    '================================================================================',
    'ВЫГРУЗКА ДИАЛОГА ВКОНТАКТЕ',
    `Дата экспорта: ${defaultDateStr}`,
    `Всего сообщений: ${formattedMessages.length}`,
    'Формат: ДД.ММ.ГГГГ ЧЧ:ММ:СС - Имя Собеседника: Текст сообщения',
    '================================================================================',
    '',
  ].join('\r\n');

  const fileContent = header + formattedMessages.join('\r\n') + '\r\n';
  const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.download = `vk_dialog_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`Диалог успешно экспортирован (${formattedMessages.length} сообщений)!`, 'success');
  elements.pasteChatModal?.classList.add('hidden');
}

// ==========================================================================
// Authentication
// ==========================================================================

async function checkAuthStatus() {
  try {
    const res = await apiFetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
        if (data.sessionId) {
          state.sessionId = data.sessionId;
          localStorage.setItem('vk_session_id', data.sessionId);
        }
        onUserAuthenticated(data.user, data.isDemo);
        return;
      }
    }
  } catch (err) {
    console.warn('Authentication check failed:', err);
  }
  onUserLoggedOut();
}

function onUserAuthenticated(user, isDemo = false) {
  state.user = user;
  
  // Update header widget
  elements.userName.textContent = user.fullName || `${user.firstName} ${user.lastName}`;
  elements.userAvatar.src = user.photo || 'https://vk.com/images/camera_100.png';
  elements.userStatus.textContent = isDemo ? 'Демо-режим' : 'VK ID подключен';
  elements.userStatus.style.color = isDemo ? '#f59e0b' : 'var(--badge-green)';
  elements.userWidget.classList.remove('hidden');

  // Switch screens
  elements.guestScreen.classList.add('hidden');
  elements.appScreen.classList.remove('hidden');

  // Load user dialogs
  loadDialogs(true);
}

function onUserLoggedOut() {
  state.user = null;
  state.dialogs = [];
  state.selectedDialog = null;
  state.messages = [];
  state.sessionId = null;
  state.token = null;
  localStorage.removeItem('vk_session_id');
  localStorage.removeItem('vk_token');

  elements.userWidget.classList.add('hidden');
  elements.guestScreen.classList.remove('hidden');
  elements.appScreen.classList.add('hidden');
  elements.chatPlaceholder.classList.remove('hidden');
  elements.activeChatContent.classList.add('hidden');
}

async function startVkOAuth() {
  try {
    showToast('Подготовка авторизации VK...', 'info');

    const res = await apiFetch('/api/auth/vk/url');
    const data = await res.json();

    if (!res.ok) {
      if (data.error === 'VK_CLIENT_ID_MISSING') {
        showConfigHelpModal('VK_CLIENT_ID не настроен', `
          В файле <code>.env</code> не указан ID приложения ВКонтакте (или оставлен тестовый 12345678).<br><br>
          <strong>Как исправить:</strong>
          <ol style="margin: 8px 0 12px 20px; font-size: 0.88rem; line-height: 1.5;">
            <li>Перейдите на <a href="https://dev.vk.com" target="_blank" style="color:var(--vk-primary);">dev.vk.com</a> и создайте приложение («Сайт» или «Standalone»).</li>
            <li>В файле <code>.env</code> укажите ваш <code>VK_CLIENT_ID</code> и <code>VK_CLIENT_SECRET</code>.</li>
            <li>В настройках приложения VK добавьте доверенный Redirect URI.</li>
          </ol>
          Либо нажмите <strong>«Быстрый демо-вход»</strong>, чтобы протестировать просмотр и экспорт диалогов прямо сейчас без регистрации в VK.
        `);
        return;
      }
      throw new Error(data.message || 'Ошибка получения URL авторизации');
    }

    const { url } = data;
    const isMobile = window.innerWidth < 768 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
      // On mobile devices popups are frequently blocked by Chrome/Safari; redirect directly
      window.location.href = url;
      return;
    }

    const width = 640;
    const height = 700;
    const left = Math.max(0, (window.screen.width - width) / 2);
    const top = Math.max(0, (window.screen.height - height) / 2);

    const popup = window.open(
      url,
      'vk_oauth_popup',
      `width=${width},height=${height},top=${top},left=${left},scrollbars=yes,status=1`
    );

    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      // If popup was blocked, fallback to direct redirect
      window.location.href = url;
    }
  } catch (err) {
    console.error('OAuth launch error:', err);
    showToast('Ошибка авторизации VK: ' + err.message, 'error');
  }
}

function showConfigHelpModal(title, htmlContent) {
  const modal = elements.infoModal;
  const modalTitle = modal.querySelector('h3');
  const modalBody = modal.querySelector('.modal-body');

  if (modalTitle) modalTitle.textContent = title;
  if (modalBody) {
    modalBody.innerHTML = `
      <div>${htmlContent}</div>
      <div style="margin-top: 14px; display: flex; gap: 10px;">
        <button id="modalDemoBtn" class="btn-primary" style="flex: 1;">Войти в демо-режим</button>
      </div>
    `;

    document.getElementById('modalDemoBtn')?.addEventListener('click', () => {
      modal.classList.add('hidden');
      startDemoLogin();
    });
  }

  modal.classList.remove('hidden');
}

function handleOAuthWindowMessage(event) {
  // Filter messages
  if (!event.data || typeof event.data !== 'object') return;

  if (event.data.type === 'VK_AUTH_SUCCESS') {
    showToast('Авторизация VK успешно завершена!', 'success');
    checkAuthStatus();
  } else if (event.data.type === 'VK_AUTH_ERROR') {
    showToast('Ошибка входа VK: ' + (event.data.error || 'Отменено'), 'error');
  }
}

async function startDemoLogin() {
  try {
    showToast('Вход в демо-режим...', 'info');
    const res = await apiFetch('/api/auth/demo-login', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
      if (data.sessionId) {
        state.sessionId = data.sessionId;
        localStorage.setItem('vk_session_id', data.sessionId);
      }
      showToast('Вы вошли в демо-режиме (тестовые диалоги готовы к экспорту)', 'success');
      onUserAuthenticated(data.user, true);
    } else {
      throw new Error(data.message || 'Ошибка входа в демо-режим');
    }
  } catch (err) {
    console.error('Demo login error:', err);
    showToast('Не удалось запустить демо-режим: ' + err.message, 'error');
  }
}

async function submitDirectTokenLogin() {
  const raw = elements.directTokenInput?.value?.trim();
  if (!raw) {
    showToast('Пожалуйста, вставьте VK Access Token или ссылку blank.html', 'error');
    elements.directTokenInput?.focus();
    return;
  }
  await executeTokenLogin(raw, elements.submitDirectTokenBtn);
}

async function submitTokenLogin() {
  const raw = elements.tokenInput?.value?.trim();
  if (!raw) {
    showToast('Пожалуйста, вставьте токен или скопированную ссылку', 'error');
    return;
  }
  await executeTokenLogin(raw, elements.submitTokenBtn);
}

async function executeTokenLogin(raw, btnElement) {
  const originalText = btnElement ? btnElement.textContent : 'Войти';
  try {
    if (btnElement) {
      btnElement.disabled = true;
      btnElement.textContent = 'Проверка токена...';
    }
    showToast('Подключение к VK API...', 'info');

    const res = await apiFetch('/api/auth/token-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: raw }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      if (data.sessionId) {
        state.sessionId = data.sessionId;
        localStorage.setItem('vk_session_id', data.sessionId);
      }
      if (data.accessToken) {
        state.token = data.accessToken;
        localStorage.setItem('vk_token', data.accessToken);
      }
      elements.tokenModal?.classList.add('hidden');
      if (elements.tokenInput) elements.tokenInput.value = '';
      if (elements.directTokenInput) elements.directTokenInput.value = '';
      showToast('Авторизация по токену успешна!', 'success');
      onUserAuthenticated(data.user, false);
    } else {
      throw new Error(data.message || 'Неверный токен или нет прав на сообщения');
    }
  } catch (err) {
    console.error('Token login error:', err);
    showToast('Ошибка авторизации: ' + err.message, 'error');
  } finally {
    if (btnElement) {
      btnElement.disabled = false;
      btnElement.textContent = originalText;
    }
  }
}

// ==========================================================================
// VK Official Archive Processor (ZIP & HTML)
// ==========================================================================

async function handleArchiveFile(file) {
  if (!file) return;

  const fileName = file.name.toLowerCase();

  // 1. If ZIP archive from VK data protection
  if (fileName.endsWith('.zip')) {
    showToast('Распаковка и анализ архива ВКонтакте...', 'info');
    try {
      if (typeof JSZip === 'undefined') {
        throw new Error('Модуль JSZip еще загружается. Повторите через 2 секунды.');
      }

      const zip = await JSZip.loadAsync(file);
      const dialogFiles = [];

      zip.forEach((relativePath, zipEntry) => {
        if (!zipEntry.dir && (relativePath.includes('messages') || relativePath.endsWith('.html'))) {
          // Check if not an empty root index
          dialogFiles.push({ path: relativePath, entry: zipEntry });
        }
      });

      if (dialogFiles.length === 0) {
        showToast('В архиве не найдено файлов сообщений (папка messages/)', 'error');
        return;
      }

      if (elements.archiveResultBox && elements.archiveChatsList) {
        elements.archiveResultBox.classList.remove('hidden');
        elements.archiveChatsList.innerHTML = '';
        if (elements.archiveResultTitle) {
          elements.archiveResultTitle.textContent = `Найдено диалогов в архиве: ${dialogFiles.length}`;
        }

        dialogFiles.forEach((item, index) => {
          const chatRow = document.createElement('div');
          chatRow.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--bg-content); border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 4px;';
          
          let cleanName = item.path.replace(/^messages\//, '').replace(/\/messages\d*\.html$/, '').replace(/\.html$/, '');
          if (!cleanName || cleanName === 'index') cleanName = `Диалог ${index + 1}`;

          chatRow.innerHTML = `
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-right: 8px;">
              <strong style="font-size: 0.85rem; color: var(--text-main); display: block;">${escapeHtml(cleanName)}</strong>
              <span style="font-size: 0.72rem; color: var(--text-secondary);">${escapeHtml(item.path)}</span>
            </div>
            <button class="btn-primary" style="font-size: 0.78rem; padding: 4px 10px; flex-shrink: 0; background: #2563eb; color: #fff;">
              📥 Скачать .TXT
            </button>
          `;

          const downloadBtn = chatRow.querySelector('button');
          downloadBtn.addEventListener('click', async () => {
            try {
              downloadBtn.disabled = true;
              downloadBtn.textContent = 'Обработка...';
              showToast(`Конвертация ${cleanName} в .TXT...`, 'info');
              const htmlContent = await item.entry.async('string');
              parseAndDownloadHtmlChat(htmlContent, cleanName);
            } catch (e) {
              showToast('Ошибка: ' + e.message, 'error');
            } finally {
              downloadBtn.disabled = false;
              downloadBtn.textContent = '📥 Скачать .TXT';
            }
          });

          elements.archiveChatsList.appendChild(chatRow);
        });
      }

      showToast(`Архив прочитан: ${dialogFiles.length} диалогов готово к скачиванию!`, 'success');

    } catch (err) {
      console.error('ZIP parsing error:', err);
      showToast('Ошибка при чтении архива: ' + err.message, 'error');
    }
    return;
  }

  // 2. If single HTML, HTM or TXT file
  if (fileName.endsWith('.html') || fileName.endsWith('.htm') || fileName.endsWith('.txt') || fileName.endsWith('.json')) {
    showToast('Чтение файла диалога...', 'info');
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const cleanName = file.name.replace(/\.[^/.]+$/, '');
      parseAndDownloadHtmlChat(content, cleanName);
    };
    reader.onerror = () => showToast('Не удалось прочитать файл', 'error');
    reader.readAsText(file);
    return;
  }

  showToast('Пожалуйста, выберите архив .ZIP или файл .HTML / .TXT', 'error');
}

function parseAndDownloadHtmlChat(raw, defaultTitle = 'dialog') {
  if (!raw || !raw.trim()) {
    showToast('Файл пуст', 'error');
    return;
  }

  const formattedMessages = [];
  const defaultDateStr = formatDate(new Date());

  // 1. Try DOM parsing for VK Archive or Web HTML
  if (raw.includes('<div') || raw.includes('<!DOCTYPE') || raw.includes('<html')) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw, 'text/html');

      // Title detection
      const pageTitle = doc.querySelector('title')?.textContent?.trim();
      if (pageTitle && !defaultTitle) defaultTitle = pageTitle;

      // VK Data Archive message items
      const archiveItems = doc.querySelectorAll('.message, .item');
      if (archiveItems.length > 0) {
        archiveItems.forEach(node => {
          // Author & Header in VK archive
          const header = node.querySelector('.message__header, .header')?.textContent?.trim() || '';
          
          // Body text
          let bodyText = '';
          const bodyNode = node.querySelector('.message__body, .text');
          if (bodyNode) {
            bodyText = bodyNode.textContent?.trim() || '';
          } else {
            // Find non-header divs
            const divs = Array.from(node.querySelectorAll('div')).filter(d => !d.classList.contains('message__header') && !d.classList.contains('kludges') && !d.classList.contains('attachment'));
            if (divs.length > 0) {
              bodyText = divs.map(d => d.textContent.trim()).filter(Boolean).join(' ');
            }
          }

          // Attachments
          const attachments = [];
          node.querySelectorAll('.attachment__description, .attachment, .kludges a').forEach(att => {
            const attText = att.textContent?.trim();
            if (attText) attachments.push(`[${attText}]`);
          });

          if (header || bodyText || attachments.length > 0) {
            let combined = '';
            if (header) combined += `${header}: `;
            if (bodyText) combined += bodyText;
            if (attachments.length > 0) combined += (bodyText ? ' ' : '') + attachments.join(' ');
            if (combined.trim()) {
              formattedMessages.push(combined.trim().replace(/\s+/g, ' '));
            }
          }
        });
      }

      // VK Web IM messages fallback
      if (formattedMessages.length === 0) {
        const webNodes = doc.querySelectorAll('.im-mess');
        webNodes.forEach(node => {
          const author = node.querySelector('.im-mess--author, .author')?.textContent?.trim() || 'Собеседник';
          const time = node.querySelector('._im_mess_date, .date')?.textContent?.trim() || '';
          const text = node.querySelector('.im-mess--text, .text')?.textContent?.trim() || '';
          if (text) {
            formattedMessages.push(`[${time || defaultDateStr}] ${author}: ${text.replace(/\s+/g, ' ')}`);
          }
        });
      }
    } catch (err) {
      console.warn('DOM parser error, fallback to regex:', err);
    }
  }

  // 2. Fallback to line-by-line smart parser
  if (formattedMessages.length === 0) {
    const lines = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    lines.forEach((l, idx) => {
      formattedMessages.push(`[Сообщение ${idx + 1}] ${l}`);
    });
  }

  if (formattedMessages.length === 0) {
    showToast('Не удалось обнаружить сообщения в файле', 'error');
    return;
  }

  // Build clean TXT file
  const header = [
    '================================================================================',
    `ВЫГРУЗКА ДИАЛОГА ВКОНТАКТЕ: ${defaultTitle}`,
    `Дата экспорта: ${defaultDateStr}`,
    `Всего сообщений: ${formattedMessages.length}`,
    '================================================================================',
    '',
  ].join('\r\n');

  const fileContent = '\uFEFF' + header + formattedMessages.join('\r\n') + '\r\n';
  const blob = new Blob([fileContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  const safeName = defaultTitle.replace(/[^a-zA-Z0-9а-яА-ЯёЁ_-]/g, '_').slice(0, 40) || 'dialog';
  link.download = `vk_chat_${safeName}.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`Диалог «${safeName}» сохранен (${formattedMessages.length} сообщ.)!`, 'success');
}

async function logout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    showToast('Вы успешно вышли из аккаунта', 'info');
  } catch (err) {
    console.warn('Logout request failed:', err);
  } finally {
    onUserLoggedOut();
  }
}

// ==========================================================================
// Dialogs Management
// ==========================================================================

async function loadDialogs(reset = false) {
  if (state.isLoadingDialogs) return;

  if (reset) {
    state.dialogsOffset = 0;
    state.dialogs = [];
    elements.dialogsList.innerHTML = `
      <div class="state-loading">
        <div class="spinner"></div>
        <p>Загрузка диалогов VK...</p>
      </div>
    `;
  }

  state.isLoadingDialogs = true;

  try {
    const params = new URLSearchParams({
      offset: state.dialogsOffset,
      count: 20,
      search: state.searchQuery,
    });

    const res = await apiFetch(`/api/dialogs?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        showToast('Сессия истекла. Пожалуйста, выполните повторный вход.', 'error');
        onUserLoggedOut();
        return;
      }

      if (data.code === 15 || data.error === 'VK_MESSAGES_ACCESS_DENIED') {
        renderDialogsRestrictionNotice(data);
        return;
      }

      throw new Error(data.message || 'Не удалось загрузить диалоги');
    }

    const newDialogs = data.dialogs || [];
    state.dialogsTotal = data.total || 0;

    if (reset) {
      state.dialogs = newDialogs;
    } else {
      state.dialogs = [...state.dialogs, ...newDialogs];
    }

    state.dialogsOffset = state.dialogs.length;

    renderDialogsList();

    // Toggle "Load more" button
    const hasMore = state.dialogs.length < state.dialogsTotal;
    elements.loadMoreDialogsBtn.classList.toggle('hidden', !hasMore);
    elements.dialogsCountLabel.textContent = `Диалоги (${state.dialogs.length} из ${state.dialogsTotal})`;

  } catch (err) {
    console.error('Load dialogs error:', err);
    elements.dialogsList.innerHTML = `
      <div class="state-empty">
        <p style="color: var(--badge-red); font-weight:600;">Не удалось загрузить диалоги</p>
        <p style="font-size:0.85rem; color:var(--text-secondary);">${escapeHtml(err.message)}</p>
        <button class="btn-subtle" onclick="loadDialogs(true)" style="margin-top:12px;">Повторить</button>
      </div>
    `;
  } finally {
    state.isLoadingDialogs = false;
  }
}

function renderDialogsList() {
  if (state.dialogs.length === 0) {
    elements.dialogsList.innerHTML = `
      <div class="state-empty">
        <p style="font-weight:600;">Диалоги не найдены</p>
        <p style="font-size:0.85rem;">Попробуйте изменить поисковый запрос</p>
      </div>
    `;
    return;
  }

  elements.dialogsList.innerHTML = '';

  state.dialogs.forEach((dialog) => {
    const item = document.createElement('div');
    item.className = 'dialog-item';
    if (state.selectedDialog && state.selectedDialog.peerId === dialog.peerId) {
      item.classList.add('active');
    }

    const defaultAvatar = 'https://vk.com/images/camera_100.png';
    const avatarUrl = dialog.photo || defaultAvatar;

    let timeText = '';
    if (dialog.lastMessage && dialog.lastMessage.date) {
      timeText = formatShortDate(dialog.lastMessage.date);
    }

    const lastText = dialog.lastMessage?.text || 'Нет сообщений';
    const isOut = dialog.lastMessage?.out;
    const prefix = isOut ? 'Вы: ' : '';

    item.innerHTML = `
      <div class="dialog-avatar-wrap">
        <img class="dialog-avatar" src="${avatarUrl}" alt="${escapeHtml(dialog.title)}" onerror="this.src='${defaultAvatar}'">
      </div>
      <div class="dialog-details">
        <div class="dialog-row-top">
          <span class="dialog-title">${escapeHtml(dialog.title)}</span>
          <span class="dialog-time">${timeText}</span>
        </div>
        <div class="dialog-row-bottom">
          <span class="dialog-snippet">${prefix}${escapeHtml(lastText)}</span>
          ${dialog.unreadCount > 0 ? `<span class="dialog-badge">${dialog.unreadCount}</span>` : ''}
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      selectDialog(dialog);
    });

    elements.dialogsList.appendChild(item);
  });
}

function renderDialogsRestrictionNotice(errorData) {
  elements.dialogsList.innerHTML = `
    <div class="state-empty" style="padding: 24px 16px; text-align: left;">
      <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 14px; margin-bottom: 14px;">
        <strong style="color: #be123c; display:block; margin-bottom:6px;">Требуется модерация VK API (Код 15)</strong>
        <p style="font-size:0.85rem; color: #4c0519; line-height: 1.45;">
          ${escapeHtml(errorData.message)}
        </p>
      </div>
      <p style="font-size:0.85rem; color: var(--text-secondary); margin-bottom: 14px;">
        Вы можете мгновенно переключиться в <strong>Демо-режим</strong>, чтобы протестировать просмотр переписок, пагинацию и формирование TXT-файла с правильным оформлением.
      </p>
      <button id="switchDemoBtn" class="btn-primary" style="width: 100%;">
        Включить демо-режим и продолжить
      </button>
    </div>
  `;

  document.getElementById('switchDemoBtn')?.addEventListener('click', startDemoLogin);
}

// ==========================================================================
// Chat & Messages Management
// ==========================================================================

function selectDialog(dialog) {
  state.selectedDialog = dialog;

  // Highlight active in list
  document.querySelectorAll('.dialog-item').forEach((el) => el.classList.remove('active'));
  event?.currentTarget?.classList.add('active');

  // Update header
  elements.chatHeaderTitle.textContent = dialog.title;
  elements.chatHeaderAvatar.src = dialog.photo || 'https://vk.com/images/camera_100.png';

  // Toggle placeholder off, chat on
  elements.chatPlaceholder.classList.add('hidden');
  elements.activeChatContent.classList.remove('hidden');

  // Mobile navigation: hide dialogs pane, show chat
  if (window.innerWidth < 768) {
    elements.paneDialogs.classList.add('mobile-hidden');
    elements.paneChat.classList.remove('mobile-hidden');
  }

  // Load messages
  loadMessages(true);
}

function showDialogsPaneMobile() {
  elements.paneDialogs.classList.remove('mobile-hidden');
  elements.paneChat.classList.add('mobile-hidden');
}

async function loadMessages(reset = false) {
  if (!state.selectedDialog || state.isLoadingMessages) return;

  if (reset) {
    state.messages = [];
    state.messagesOffset = 0;
    elements.messagesList.innerHTML = `
      <div class="state-loading">
        <div class="spinner"></div>
        <p>Загрузка переписки...</p>
      </div>
    `;
  }

  state.isLoadingMessages = true;
  elements.loadMoreMessagesBtn.disabled = true;

  try {
    const peerId = state.selectedDialog.peerId;
    const params = new URLSearchParams({
      offset: state.messagesOffset,
      count: 50,
    });

    const res = await apiFetch(`/api/dialogs/${peerId}/messages?${params.toString()}`);
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        showToast('Сессия истекла. Войдите снова.', 'error');
        onUserLoggedOut();
        return;
      }
      throw new Error(data.message || 'Ошибка загрузки сообщений');
    }

    const fetchedMessages = data.messages || [];
    state.messagesTotal = data.total || 0;

    if (reset) {
      state.messages = fetchedMessages;
    } else {
      // Append unique messages
      const existingIds = new Set(state.messages.map((m) => m.id));
      const filtered = fetchedMessages.filter((m) => !existingIds.has(m.id));
      state.messages = [...state.messages, ...filtered];
    }

    state.messagesOffset = state.messages.length;

    // Update counter badges
    elements.chatLoadedCount.textContent = `Загружено: ${state.messages.length}`;
    elements.chatTotalCount.textContent = state.messagesTotal ? `Всего в диалоге: ${state.messagesTotal}` : '';

    renderMessages();

    // Toggle "Load more messages" button
    const hasMore = state.messages.length < state.messagesTotal;
    elements.loadMoreMessagesBtn.classList.toggle('hidden', !hasMore);
    elements.loadMoreMessagesBtn.disabled = false;

  } catch (err) {
    console.error('Messages load error:', err);
    elements.messagesList.innerHTML = `
      <div class="state-empty">
        <p style="color:var(--badge-red); font-weight:600;">Не удалось загрузить сообщения</p>
        <p style="font-size:0.85rem;">${escapeHtml(err.message)}</p>
        <button class="btn-subtle" onclick="loadMessages(true)" style="margin-top:12px;">Повторить</button>
      </div>
    `;
  } finally {
    state.isLoadingMessages = false;
  }
}

function renderMessages() {
  if (state.messages.length === 0) {
    elements.messagesList.innerHTML = `
      <div class="state-empty">
        <p style="font-weight:600; color: var(--text-main);">Сообщений пока нет</p>
        <p style="font-size:0.85rem; color: var(--text-secondary);">В этом диалоге ещё нет переписки</p>
      </div>
    `;
    return;
  }

  elements.messagesList.innerHTML = '';

  const previewCard = document.createElement('div');
  previewCard.className = 'export-preview-card';

  const previewBanner = document.createElement('div');
  previewBanner.className = 'export-preview-banner';
  previewBanner.textContent = '--- ПРЕДПРОСМОТР ЭКСПОРТА (TXT) ---';
  previewCard.appendChild(previewBanner);

  const messagesFlow = document.createElement('div');
  messagesFlow.className = 'export-preview-flow';

  // Display chronologically (oldest at top, newest at bottom) for reading
  const sorted = [...state.messages].sort((a, b) => a.date - b.date);

  sorted.forEach((msg) => {
    const entry = document.createElement('div');
    entry.className = 'preview-entry';

    const timeStr = msg.formattedDate || formatDateTime(msg.date);

    let attachmentsHtml = '';
    if (msg.attachments && msg.attachments.length > 0) {
      attachmentsHtml = msg.attachments
        .map((att) => `<div class="preview-attachment">[${escapeHtml(att)}]</div>`)
        .join('');
    }

    let fwdHtml = '';
    if (msg.fwdSummary) {
      fwdHtml = `<div class="preview-fwd">${escapeHtml(msg.fwdSummary)}</div>`;
    }

    entry.innerHTML = `
      <div class="preview-header-line">
        <span class="preview-sender">[${timeStr}] ${escapeHtml(msg.senderName)}:</span>
      </div>
      ${msg.text ? `<div class="preview-body">${escapeHtml(msg.text)}</div>` : ''}
      ${attachmentsHtml}
      ${fwdHtml}
    `;

    messagesFlow.appendChild(entry);
  });

  previewCard.appendChild(messagesFlow);

  const footerBadge = document.createElement('div');
  footerBadge.className = 'export-preview-footer';
  footerBadge.innerHTML = `
    <div class="preview-dot"></div>
    <span>Показано сообщений: ${sorted.length} ${state.messagesTotal ? `из ${state.messagesTotal}` : ''}</span>
  `;
  previewCard.appendChild(footerBadge);

  elements.messagesList.appendChild(previewCard);
  elements.messagesList.scrollTop = elements.messagesList.scrollHeight;
}

// ==========================================================================
// TXT Export Execution
// ==========================================================================

async function exportToTxt() {
  if (!state.selectedDialog) {
    showToast('Сначала выберите диалог для экспорта', 'error');
    return;
  }

  if (state.messages.length === 0) {
    showToast('В выбранном диалоге нет сообщений для экспорта', 'error');
    return;
  }

  if (state.isExporting) return;
  state.isExporting = true;

  elements.downloadTxtBtn.disabled = true;
  elements.downloadTxtBottomBtn.disabled = true;
  showToast('Формирование чистого TXT файла...', 'info');

  try {
    const peerId = state.selectedDialog.peerId;
    const dialogTitle = state.selectedDialog.title;

    // If dialog has more messages than loaded (e.g. 5000+), automatically fetch all batches before export
    if (state.messagesTotal > state.messages.length) {
      showToast(`Диалог содержит ${state.messagesTotal} сообщений. Загрузка всех сообщений через API...`, 'info');
      let offset = state.messages.length;
      while (offset < state.messagesTotal) {
        const countToFetch = Math.min(200, state.messagesTotal - offset);
        try {
          const batchRes = await apiFetch(`/api/dialogs/${peerId}/messages?offset=${offset}&count=${countToFetch}`);
          if (!batchRes.ok) break;
          const batchData = await batchRes.json();
          const newMsgs = batchData.messages || [];
          if (newMsgs.length === 0) break;

          const existingIds = new Set(state.messages.map(m => m.id));
          const unique = newMsgs.filter(m => !existingIds.has(m.id));
          state.messages.push(...unique);
          offset += newMsgs.length;

          showToast(`Загружено: ${state.messages.length} из ${state.messagesTotal} сообщ...`, 'info');
          if (newMsgs.length < countToFetch) break;
        } catch (err) {
          console.warn('Batch fetch warning:', err);
          break;
        }
      }
    }

    // Send currently loaded messages to server for official TXT creation with UTF-8 BOM
    const response = await apiFetch(`/api/dialogs/${peerId}/export-txt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        dialogTitle: dialogTitle,
        clientMessages: state.messages,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || 'Ошибка сервера при экспорте');
    }

    // Read binary blob and trigger browser download
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');

    // Extract filename from header or build default
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = `vk_chat_${peerId}.txt`;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename\*=UTF-8''([^;]+)|filename="([^"]+)"/);
      if (match) {
        filename = decodeURIComponent(match[1] || match[2]);
      }
    }

    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(downloadUrl);

    showToast(`Файл «${filename}» успешно скачан (${state.messages.length} сообщ.)`, 'success');

  } catch (err) {
    console.error('Export TXT error:', err);
    showToast('Ошибка при скачивании: ' + err.message, 'error');
  } finally {
    state.isExporting = false;
    elements.downloadTxtBtn.disabled = false;
    elements.downloadTxtBottomBtn.disabled = false;
  }
}

// ==========================================================================
// Helpers
// ==========================================================================

function formatShortDate(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');

  // If today: return HH:mm
  if (d.toDateString() === now.toDateString()) {
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // Otherwise return DD.MM
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

function formatDateTime(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${day}.${month}.${year} ${hours}:${minutes}`;
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

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300);
  }, 4000);
}
