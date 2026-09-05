/**
 * Direct VK Authorization via Official VK Android Client
 * Runs in Termux directly on your device.
 */

const https = require('https');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

// Official VK for Android credentials (used for direct mobile login)
const CLIENT_ID = '2274003';
const CLIENT_SECRET = 'hHbZxrka2uZ6jB1inYsH';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function httpsPost(url, postData) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        'User-Agent': 'VKAndroidApp/8.55-17482 (Android 13; SDK 33; arm64-v8a; samsung SM-G998B; ru)',
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve({ status: res.statusCode, data: json });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function requestToken(params) {
  const url = 'https://oauth.vk.com/token';
  const query = new URLSearchParams({
    grant_type: 'password',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: 'messages,offline,friends',
    '2fa_supported': '1',
    v: '5.199',
    ...params,
  });

  return httpsPost(url, query.toString());
}

async function main() {
  console.log('==============================================');
  console.log('  Прямой вход в VK через официальный клиент  ');
  console.log('==============================================\n');
  console.log('Этот скрипт авторизуется напрямую через сервер VK');
  console.log('и сохраняет токен для скачивания диалогов в .TXT.\n');

  const username = await ask('Введите номер телефона или логин VK: ');
  const password = await ask('Введите пароль от VK: ');

  console.log('\nОтправка запроса в VK...');

  let params = {
    username: username.trim(),
    password: password.trim(),
  };

  let res = await requestToken(params);

  // Handle 2FA / Code verification
  if (res.data && res.data.error === 'need_validation') {
    console.log('\n[!] ВКонтакте запросил подтверждение входа.');
    if (res.data.phone_mask) {
      console.log('Код отправлен на номер/в приложение:', res.data.phone_mask);
    }

    const code = await ask('Введите проверочный код из SMS / Push / приложения: ');
    params.code = code.trim();
    if (res.data.validation_sid) {
      params.validation_sid = res.data.validation_sid;
    }

    console.log('Проверка кода...');
    res = await requestToken(params);
  }

  // Handle Captcha
  if (res.data && res.data.error === 'need_captcha') {
    console.log('\n[!] ВКонтакте запросил капчу.');
    console.log('Откройте картинку:', res.data.captcha_img);
    const captchaKey = await ask('Введите текст с картинки: ');
    params.captcha_sid = res.data.captcha_sid;
    params.captcha_key = captchaKey.trim();

    console.log('Повторная отправка с капчей...');
    res = await requestToken(params);
  }

  // Check result
  if (res.data && res.data.access_token) {
    const token = res.data.access_token;
    const userId = res.data.user_id;

    console.log('\n==============================================');
    console.log('✅ АВТОРИЗАЦИЯ УСПЕШНА!');
    console.log(`Пользователь ID: ${userId}`);
    console.log('==============================================\n');

    // Save token to .env file
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Replace or add VK_ACCESS_TOKEN
    if (/^VK_ACCESS_TOKEN=.*/m.test(envContent)) {
      envContent = envContent.replace(/^VK_ACCESS_TOKEN=.*/m, `VK_ACCESS_TOKEN=${token}`);
    } else {
      envContent += `\nVK_ACCESS_TOKEN=${token}\n`;
    }

    fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8');
    console.log('Токен автоматически записан в файл .env!');
    console.log('Теперь можно запустить сервер:');
    console.log('\n  node server/server.js\n');
    console.log('И открыть сайт в браузере — все ваши диалоги будут доступны.');
  } else {
    console.error('\n❌ Ошибка авторизации:');
    console.error(res.data);
    if (res.data && res.data.error_description) {
      console.error('Причина:', res.data.error_description);
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error('Непредвиденная ошибка:', err);
  rl.close();
});
