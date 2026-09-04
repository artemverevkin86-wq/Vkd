/**
 * VK Chat Exporter — Client Application Logic
 * Clean Vanilla JavaScript (ES6+) with full mobile-first responsiveness.
 */

// Application State
const state = {
  user: null,
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
  elements.vkLoginBtn.addEventListener('click', startVkOAuth);
  elements.demoLoginBtn.addEventListener('click', startDemoLogin);
  elements.logoutBtn.addEventListener('click', logout);

  // Search dialogs
  let searchTimeout = null;
  elements.dialogSearchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    elements.clearSearchBtn.classList.toggle('hidden', !state.searchQuery);
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      loadDialogs(true);
    }, 300);
  });

  elements.clearSearchBtn.addEventListener('click', () => {
    elements.dialogSearchInput.value = '';
    state.searchQuery = '';
    elements.clearSearchBtn.classList.add('hidden');
    loadDialogs(true);
  });

  elements.refreshDialogsBtn.addEventListener('click', () => {
    loadDialogs(true);
  });

  elements.loadMoreDialogsBtn.addEventListener('click', () => {
    loadDialogs(false);
  });

  // Chat actions
  elements.backToDialogsBtn.addEventListener('click', showDialogsPaneMobile);
  elements.loadMoreMessagesBtn.addEventListener('click', () => {
    loadMessages(false);
  });

  elements.downloadTxtBtn.addEventListener('click', exportToTxt);
  elements.downloadTxtBottomBtn.addEventListener('click', exportToTxt);

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

  // Cross-origin message listener for OAuth popup window
  window.addEventListener('message', handleOAuthWindowMessage);
}

// ==========================================================================
// Authentication
// ==========================================================================

async function checkAuthStatus() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      const data = await res.json();
      if (data.authenticated && data.user) {
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

  elements.userWidget.classList.add('hidden');
  elements.guestScreen.classList.remove('hidden');
  elements.appScreen.classList.add('hidden');
  elements.chatPlaceholder.classList.remove('hidden');
  elements.activeChatContent.classList.add('hidden');
}

async function startVkOAuth() {
  try {
    showToast('Подготовка авторизации VK...', 'info');

    const res = await fetch('/api/auth/vk/url');
    const data = await res.json();

    if (!res.ok) {
      if (data.error === 'VK_CLIENT_ID_MISSING') {
        showToast('VK_CLIENT_ID не настроен. Запустите демо-режим для быстрого теста.', 'error');
        return;
      }
      throw new Error(data.message || 'Ошибка получения URL авторизации');
    }

    const { url } = data;
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
      showToast('Всплывающее окно заблокировано браузером. Разрешите всплывающие окна для сайта.', 'error');
    }
  } catch (err) {
    console.error('OAuth launch error:', err);
    showToast('Не удалось открыть окно авторизации VK: ' + err.message, 'error');
  }
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
    const res = await fetch('/api/auth/demo-login', { method: 'POST' });
    const data = await res.json();
    if (res.ok && data.success) {
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

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
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

    const res = await fetch(`/api/dialogs?${params.toString()}`);
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

    const res = await fetch(`/api/dialogs/${peerId}/messages?${params.toString()}`);
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

    // Send currently loaded messages to server for official TXT creation with UTF-8 BOM
    const response = await fetch(`/api/dialogs/${peerId}/export-txt`, {
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
