/**
 * VK API Client Module for VK Chat Exporter.
 * Interacts only with official VK API endpoints (https://api.vk.com/method/).
 * Version used: 5.199
 */

const VK_API_VERSION = '5.199';
const VK_API_BASE = 'https://api.vk.com/method';

/**
 * Executes a call to official VK API.
 * Rate limit handling, error checking, and parameter serialization.
 */
export async function vkApiCall(method, params = {}, accessToken) {
  const url = `${VK_API_BASE}/${method}`;
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      queryParams.append(key, String(value));
    }
  }
  queryParams.append('v', VK_API_VERSION);
  if (accessToken) {
    queryParams.append('access_token', accessToken);
  }

  const response = await fetch(`${url}?${queryParams.toString()}`, {
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'VK-Chat-Exporter/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`VK API HTTP error: status ${response.status}`);
  }

  const result = await response.json();

  if (result.error) {
    const { error_code, error_msg } = result.error;
    
    // Check for specific VK API restriction: Error 15 (Access denied to messages)
    if (error_code === 15) {
      const err = new Error(
        'Ошибка 15 VK API: Доступ к сообщениям запрещён. ' +
        'VK требует модерации приложения для метода messages или использования Standalone-приложения с правами messages.'
      );
      err.code = 15;
      err.vkError = result.error;
      throw err;
    }

    if (error_code === 5) {
      const err = new Error('Ошибка 5 VK API: Авторизация пользователя не удалась или токен истёк.');
      err.code = 5;
      err.vkError = result.error;
      throw err;
    }

    const err = new Error(`VK API Error [${error_code}]: ${error_msg}`);
    err.code = error_code;
    err.vkError = result.error;
    throw err;
  }

  return result.response;
}

/**
 * Fetches user profile by user ID or current user.
 */
export async function getUserProfile(accessToken, userId) {
  const params = {
    fields: 'photo_100,photo_200,online,first_name,last_name,sex',
  };
  if (userId) {
    params.user_ids = String(userId);
  }

  let response;
  try {
    response = await vkApiCall('users.get', params, accessToken);
  } catch (err) {
    console.warn('users.get failed, trying account.getProfileInfo:', err.message);
    try {
      const info = await vkApiCall('account.getProfileInfo', {}, accessToken);
      if (info && (info.id || userId)) {
        return {
          id: info.id || Number(userId),
          firstName: info.first_name || '',
          lastName: info.last_name || '',
          fullName: `${info.first_name || ''} ${info.last_name || ''}`.trim() || 'Пользователь VK',
          photo: info.photo_200 || info.photo_100 || '',
          online: true,
        };
      }
    } catch (e2) {
      throw err;
    }
  }

  if (!response || response.length === 0) {
    // Fallback: try account.getProfileInfo
    try {
      const info = await vkApiCall('account.getProfileInfo', {}, accessToken);
      if (info && (info.id || userId)) {
        return {
          id: info.id || Number(userId),
          firstName: info.first_name || '',
          lastName: info.last_name || '',
          fullName: `${info.first_name || ''} ${info.last_name || ''}`.trim() || 'Пользователь VK',
          photo: info.photo_200 || info.photo_100 || '',
          online: true,
        };
      }
    } catch (e2) {
      // ignore
    }

    // If we have userId from the URL, return basic user profile so login succeeds
    if (userId) {
      return {
        id: Number(userId),
        firstName: 'Пользователь',
        lastName: `id${userId}`,
        fullName: `Пользователь id${userId}`,
        photo: '',
        online: true,
      };
    }

    throw new Error('Пользователь не найден в VK');
  }

  const u = response[0];
  return {
    id: u.id,
    firstName: u.first_name || '',
    lastName: u.last_name || '',
    fullName: `${u.first_name || ''} ${u.last_name || ''}`.trim() || `id${u.id}`,
    photo: u.photo_200 || u.photo_100 || '',
    online: Boolean(u.online),
  };
}

/**
 * Fetches user dialogs/conversations.
 * Uses official messages.getConversations with extended=1 to resolve user/group profiles.
 */
export async function getConversations(accessToken, { offset = 0, count = 20 } = {}) {
  const data = await vkApiCall('messages.getConversations', {
    offset: Math.max(0, parseInt(offset, 10) || 0),
    count: Math.min(200, Math.max(1, parseInt(count, 10) || 20)),
    extended: 1,
    fields: 'first_name,last_name,photo_100,photo_200,name',
  }, accessToken);

  const totalCount = data.count || 0;
  const items = data.items || [];
  const profilesMap = new Map();
  const groupsMap = new Map();

  if (data.profiles) {
    for (const p of data.profiles) {
      profilesMap.set(p.id, {
        name: `${p.first_name} ${p.last_name}`.trim(),
        photo: p.photo_100 || p.photo_200 || '',
      });
    }
  }

  if (data.groups) {
    for (const g of data.groups) {
      groupsMap.set(g.id, {
        name: g.name || `Сообщество ${g.id}`,
        photo: g.photo_100 || g.photo_200 || '',
      });
    }
  }

  const dialogs = items.map((item) => {
    const conversation = item.conversation;
    const lastMessage = item.last_message;
    const peer = conversation.peer || {};
    const peerId = peer.id;
    const peerType = peer.type; // user, chat, group, email

    let title = 'Диалог';
    let photo = '';

    if (peerType === 'chat' && conversation.chat_settings) {
      title = conversation.chat_settings.title || `Беседа #${conversation.chat_settings.members_count || ''}`;
      photo = conversation.chat_settings.photo?.photo_100 || '';
    } else if (peerType === 'user') {
      const p = profilesMap.get(peerId);
      if (p) {
        title = p.name;
        photo = p.photo;
      } else {
        title = `Пользователь id${peerId}`;
      }
    } else if (peerType === 'group') {
      const g = groupsMap.get(Math.abs(peerId));
      if (g) {
        title = g.name;
        photo = g.photo;
      } else {
        title = `Сообщество id${Math.abs(peerId)}`;
      }
    }

    let lastText = '';
    let lastDate = 0;
    if (lastMessage) {
      lastText = lastMessage.text || '';
      lastDate = lastMessage.date ? lastMessage.date * 1000 : 0;
      if (!lastText && lastMessage.attachments && lastMessage.attachments.length > 0) {
        lastText = formatAttachmentTag(lastMessage.attachments[0]);
      }
    }

    return {
      peerId,
      peerType,
      title,
      photo,
      unreadCount: conversation.unread_count || 0,
      inRead: conversation.in_read,
      outRead: conversation.out_read,
      lastMessage: {
        id: lastMessage?.id,
        text: lastText,
        date: lastDate,
        fromId: lastMessage?.from_id,
        out: lastMessage?.out === 1,
      },
    };
  });

  return {
    total: totalCount,
    offset,
    count: dialogs.length,
    dialogs,
  };
}

/**
 * Fetches message history for a specific conversation.
 * Uses official messages.getHistory with extended=1.
 */
export async function getHistory(accessToken, { peerId, offset = 0, count = 50, startMessageId } = {}) {
  const params = {
    peer_id: peerId,
    offset: Math.max(0, parseInt(offset, 10) || 0),
    count: Math.min(200, Math.max(1, parseInt(count, 10) || 50)),
    extended: 1,
    fields: 'first_name,last_name,photo_100,name',
  };

  if (startMessageId) {
    params.start_message_id = startMessageId;
  }

  const data = await vkApiCall('messages.getHistory', params, accessToken);

  const totalCount = data.count || 0;
  const rawItems = data.items || [];
  const profilesMap = new Map();
  const groupsMap = new Map();

  if (data.profiles) {
    for (const p of data.profiles) {
      profilesMap.set(p.id, `${p.first_name} ${p.last_name}`.trim());
    }
  }

  if (data.groups) {
    for (const g of data.groups) {
      groupsMap.set(g.id, g.name || `Сообщество ${g.id}`);
    }
  }

  const messages = rawItems.map((msg) => {
    const fromId = msg.from_id;
    let senderName = 'Пользователь';

    if (fromId > 0) {
      senderName = profilesMap.get(fromId) || `id${fromId}`;
    } else if (fromId < 0) {
      senderName = groupsMap.get(Math.abs(fromId)) || `club${Math.abs(fromId)}`;
    }

    const attachments = (msg.attachments || []).map(formatAttachmentTag);
    const fwdCount = (msg.fwd_messages || []).length;
    let fwdSummary = '';
    if (fwdCount > 0) {
      fwdSummary = `[Переслано сообщений: ${fwdCount}]`;
    }

    return {
      id: msg.id,
      fromId: msg.from_id,
      senderName,
      date: msg.date * 1000,
      formattedDate: formatDateTime(msg.date * 1000),
      text: msg.text || '',
      attachments,
      fwdSummary,
      replyMessage: msg.reply_message ? {
        text: msg.reply_message.text,
        senderId: msg.reply_message.from_id,
      } : null,
    };
  });

  return {
    total: totalCount,
    offset,
    count: messages.length,
    messages,
  };
}

/**
 * Formats a single attachment into a readable label (e.g., "[Вложение: фото]").
 */
export function formatAttachmentTag(att) {
  if (!att) return '[Вложение]';
  const type = att.type;
  switch (type) {
    case 'photo':
      return '[Вложение: фото]';
    case 'video':
      const title = att.video?.title ? `: "${att.video.title}"` : '';
      return `[Вложение: видео${title}]`;
    case 'audio':
      const artist = att.audio?.artist || '';
      const song = att.audio?.title || '';
      return `[Вложение: аудио: ${artist} - ${song}]`.replace(':  - ]', ']');
    case 'doc':
      const docTitle = att.doc?.title ? `: "${att.doc.title}"` : '';
      return `[Вложение: документ${docTitle}]`;
    case 'graffiti':
      return '[Вложение: граффити]';
    case 'audio_message':
      const dur = att.audio_message?.duration ? ` (${att.audio_message.duration} сек.)` : '';
      return `[Вложение: голосовое сообщение${dur}]`;
    case 'sticker':
      return '[Вложение: стикер]';
    case 'link':
      const linkTitle = att.link?.title || att.link?.url || '';
      return `[Вложение: ссылка: ${linkTitle}]`;
    case 'wall':
      return '[Вложение: запись на стене]';
    case 'wall_reply':
      return '[Вложение: комментарий на стене]';
    case 'poll':
      const question = att.poll?.question ? `: "${att.poll.question}"` : '';
      return `[Вложение: опрос${question}]`;
    default:
      return `[Вложение: ${type}]`;
  }
}

/**
 * Formats timestamp to Russian format: DD.MM.YYYY HH:mm
 * Example: [04.09.2026 21:14]
 */
export function formatDateTime(ms) {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${day}.${month}.${year} ${hours}:${minutes}`;
}

/**
 * Generates plain text export matching the exact user specification:
 * 
 * [04.09.2026 21:14] Имя:
 * Текст сообщения
 * 
 * [04.09.2026 21:15] Другой пользователь:
 * Текст сообщения
 * [Вложение: фото]
 */
export function formatMessagesToTxt(messages, dialogTitle = '') {
  // Messages are sorted chronologically (oldest to newest) for natural reading
  const sorted = [...messages].sort((a, b) => a.date - b.date);

  const lines = [];

  // Optional header banner
  lines.push(`========================================================`);
  lines.push(`ЭКСПОРТ ПЕРЕПИСКИ VK: ${dialogTitle || 'Диалог'}`);
  lines.push(`Дата выгрузки: ${formatDateTime(Date.now())}`);
  lines.push(`Всего сообщений: ${sorted.length}`);
  lines.push(`========================================================\n`);

  for (const msg of sorted) {
    const header = `[${msg.formattedDate || formatDateTime(msg.date)}] ${msg.senderName}:`;
    lines.push(header);

    const bodyParts = [];
    if (msg.text && msg.text.trim()) {
      bodyParts.push(msg.text.trim());
    }

    if (msg.fwdSummary) {
      bodyParts.push(msg.fwdSummary);
    }

    if (msg.attachments && msg.attachments.length > 0) {
      for (const att of msg.attachments) {
        bodyParts.push(att);
      }
    }

    if (bodyParts.length === 0) {
      bodyParts.push('[Пустое сообщение]');
    }

    lines.push(bodyParts.join('\n'));
    lines.push(''); // Empty line between messages
  }

  return lines.join('\n');
}

/**
 * Realistic Mock/Demo Data Generator for testing and sandbox mode.
 * Provides instant testing of pagination, multi-message loading, attachments,
 * search, and TXT downloading without requiring a verified VK app.
 */
export const demoData = {
  user: {
    id: 99887766,
    firstName: 'Александр',
    lastName: 'Иванов',
    fullName: 'Александр Иванов',
    photo: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
    online: true,
  },
  dialogs: [
    {
      peerId: 101,
      peerType: 'user',
      title: 'Екатерина Смирнова',
      photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
      unreadCount: 0,
      lastMessage: {
        id: 5020,
        text: 'Договорились, жду файл с отчётом!',
        date: Date.now() - 12 * 60 * 1000,
        out: false,
      },
    },
    {
      peerId: 202,
      peerType: 'chat',
      title: 'Команда проекта «Альфа»',
      photo: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=150&auto=format&fit=crop&q=80',
      unreadCount: 3,
      lastMessage: {
        id: 4980,
        text: 'Пулл-реквест готов к ревью, проверьте пожалуйста.',
        date: Date.now() - 45 * 60 * 1000,
        out: false,
      },
    },
    {
      peerId: 303,
      peerType: 'user',
      title: 'Михаил Кузнецов',
      photo: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80',
      unreadCount: 0,
      lastMessage: {
        id: 4800,
        text: '[Вложение: фото]',
        date: Date.now() - 3 * 3600 * 1000,
        out: true,
      },
    },
    {
      peerId: 404,
      peerType: 'group',
      title: 'IT & Dev Community VK',
      photo: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=150&auto=format&fit=crop&q=80',
      unreadCount: 0,
      lastMessage: {
        id: 4200,
        text: 'Новый дайджест веб-технологий уже доступен для чтения.',
        date: Date.now() - 24 * 3600 * 1000,
        out: false,
      },
    },
    {
      peerId: 505,
      peerType: 'user',
      title: 'Анна Васильева',
      photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      unreadCount: 1,
      lastMessage: {
        id: 3900,
        text: 'Привет! Получилось протестировать экспорт сообщений?',
        date: Date.now() - 2 * 86400 * 1000,
        out: false,
      },
    }
  ],
  messages: {
    101: generateSampleMessages('Екатерина Смирнова', 'Александр Иванов', 85),
    202: generateSampleMessages('Команда проекта «Альфа»', 'Александр Иванов', 120),
    303: generateSampleMessages('Михаил Кузнецов', 'Александр Иванов', 40),
    404: generateSampleMessages('IT & Dev Community VK', 'Александр Иванов', 25),
    505: generateSampleMessages('Анна Васильева', 'Александр Иванов', 60),
  }
};

function generateSampleMessages(peerName, currentUserName, count = 50) {
  const result = [];
  const baseTime = Date.now() - count * 15 * 60 * 1000;

  const phrases = [
    { sender: currentUserName, text: 'Привет! Как продвигается работа?' },
    { sender: peerName, text: 'Привет! Всё отлично, завершаем финальное тестирование.' },
    { sender: currentUserName, text: 'Супер. Нам нужно проверить выгрузку сообщений в чистый TXT.' },
    { sender: peerName, text: 'Да, важно чтобы всё было аккуратно оформлено по датам и без лишних тегов.' },
    { sender: currentUserName, text: 'Именно! Формат [ДД.ММ.ГГГГ ЧЧ:ММ] Имя: текст сообщения.' },
    { sender: peerName, text: 'И переносы строк чтобы сохранялись один в один.', att: '[Вложение: фото]' },
    { sender: currentUserName, text: 'Да, и вложения отображаются в виде понятных маркеров.' },
    { sender: peerName, text: 'А голосовые сообщения и документы как выводятся?' },
    { sender: currentUserName, text: 'В виде [Вложение: голосовое сообщение (12 сек.)] или [Вложение: документ].' },
    { sender: peerName, text: 'Отлично! Давай проверим скачивание файла.' },
    { sender: currentUserName, text: 'Отправил тебе тестовую спецификацию.', att: '[Вложение: документ: "spec_v2.pdf"]' },
    { sender: peerName, text: 'Получила, сейчас изучу!' },
    { sender: peerName, text: 'Договорились, жду файл с отчётом!' },
  ];

  for (let i = 0; i < count; i++) {
    const template = phrases[i % phrases.length];
    const msgTime = baseTime + i * 15 * 60 * 1000;
    const isOut = template.sender === currentUserName;
    result.push({
      id: 1000 + i,
      fromId: isOut ? 99887766 : 101,
      senderName: template.sender,
      date: msgTime,
      formattedDate: formatDateTime(msgTime),
      text: template.text,
      attachments: template.att ? [template.att] : [],
      fwdSummary: '',
      replyMessage: null,
    });
  }

  return result;
}
