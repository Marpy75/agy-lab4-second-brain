const http = require('http');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const url = require('url');

const noteService = require('./src/noteService');

const PORT = 3000;
const HOST = '127.0.0.1';
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

/**
 * Допоміжна функція для читання JSON тіла запиту
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 5 * 1024 * 1024) { // ліміт 5 МБ
        reject(new Error('PAYLOAD_TOO_LARGE'));
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed);
      } catch (err) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Допоміжна функція для надсилання JSON відповідей
 */
function sendJson(res, statusCode, data) {
  const payload = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': `http://${HOST}:${PORT}`,
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(payload);
}

/**
 * Безпечна роздача статичних файлів інтерфейсу
 */
async function serveStatic(req, res, pathname) {
  let relativePath = pathname === '/' ? '/index.html' : pathname;
  relativePath = relativePath.replace(/^\/public\//, '/');

  // Захист від path traversal у статиці
  const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, '');
  let fullPath = path.join(PUBLIC_DIR, safePath);

  // Fallback: якщо файл не в public/, шукаємо в корені проєкту (для зворотної сумісності)
  if (!fs.existsSync(fullPath)) {
    fullPath = path.join(__dirname, safePath);
  }

  // Переконуємось, що шлях не виходить за межі папки проєкту
  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Заборонено');
    return;
  }

  try {
    const stat = await fsPromises.stat(fullPath);
    if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Не знайдено');
      return;
    }

    const ext = path.extname(fullPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stream = fs.createReadStream(fullPath);

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    stream.pipe(res);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Не знайдено');
  }
}

/**
 * Головний обробник HTTP запитів
 */
const server = http.createServer(async (req, res) => {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': `http://${HOST}:${PORT}`,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  // -------------------------------------------------------------
  // REST API: /api/*
  // -------------------------------------------------------------
  if (pathname.startsWith('/api/')) {
    try {
      // GET /api/summary - статистика PARA та тегів
      if (req.method === 'GET' && pathname === '/api/summary') {
        const summary = await noteService.getSummary();
        sendJson(res, 200, summary);
        return;
      }

      // GET /api/notes - список нотаток із фільтрацією
      if (req.method === 'GET' && pathname === '/api/notes') {
        const notes = await noteService.listNotes(parsedUrl.query);
        sendJson(res, 200, notes);
        return;
      }

      // POST /api/notes - створення нової нотатки
      if (req.method === 'POST' && pathname === '/api/notes') {
        const body = await readJsonBody(req);
        const created = await noteService.createNote(body);
        sendJson(res, 201, created);
        return;
      }

      // Захист від спроб Path Traversal у просторі імен /api/notes/*
      if (pathname.startsWith('/api/notes/')) {
        if (pathname.includes('..') || pathname.includes('\\')) {
          sendJson(res, 400, { error: 'INVALID_PATH', details: 'PATH_TRAVERSAL_DETECTED' });
          return;
        }

        // Специфічні операції з конкретною нотаткою: /api/notes/:category/:filename
        const match = pathname.match(/^\/api\/notes\/([^\/]+)\/([^\/]+)$/);
        if (match) {
          const category = match[1];
          const filename = match[2];

          // Перевірка валідності категорії та розширення
          const check = noteService.validatePath(category, filename);
          if (!check.valid) {
            sendJson(res, 400, { error: 'INVALID_PATH', details: check.error });
            return;
          }

          // GET /api/notes/:category/:filename
          if (req.method === 'GET') {
            const note = await noteService.getNote(category, filename);
            if (!note) {
              sendJson(res, 404, { error: 'NOTE_NOT_FOUND' });
              return;
            }
            sendJson(res, 200, note);
            return;
          }

          // PUT /api/notes/:category/:filename
          if (req.method === 'PUT') {
            const body = await readJsonBody(req);
            const updated = await noteService.updateNote(category, filename, body);
            if (!updated) {
              sendJson(res, 404, { error: 'NOTE_NOT_FOUND' });
              return;
            }
            sendJson(res, 200, updated);
            return;
          }

          // DELETE /api/notes/:category/:filename (М'яке видалення / Архівація)
          if (req.method === 'DELETE') {
            const result = await noteService.archiveNote(category, filename);
            if (!result) {
              sendJson(res, 404, { error: 'NOTE_NOT_FOUND' });
              return;
            }
            sendJson(res, 200, result);
            return;
          }
        } else {
          // Якщо після /api/notes/ передано невалідну кількість сегментів або зайві слеші
          sendJson(res, 400, { error: 'INVALID_PATH', details: 'INVALID_NOTE_URI' });
          return;
        }
      }

      // Невідомий API маршрут
      sendJson(res, 404, { error: 'ENDPOINT_NOT_FOUND' });
    } catch (err) {
      if (err.message === 'INVALID_CATEGORY' ||
          err.message === 'PATH_TRAVERSAL_DETECTED' ||
          err.message === 'MUST_HAVE_MD_EXTENSION' ||
          err.message === 'INVALID_PATH' ||
          err.message === 'PATH_OUTSIDE_CATEGORY') {
        sendJson(res, 400, { error: 'INVALID_PATH', details: err.message });
      } else if (err.message === 'INVALID_JSON') {
        sendJson(res, 400, { error: 'INVALID_JSON' });
      } else if (err.message === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      } else {
        console.error('API Error:', err);
        sendJson(res, 500, { error: 'INTERNAL_SERVER_ERROR', message: err.message });
      }
    }
    return;
  }

  // -------------------------------------------------------------
  // Статичні файли (UI)
  // -------------------------------------------------------------
  if (req.method === 'GET' || req.method === 'HEAD') {
    await serveStatic(req, res, pathname);
    return;
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('405 Метод не підтримується');
});

// Запуск сервера, прив'язка суворо до 127.0.0.1
if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`====================================================`);
    console.log(` Second Brain Server запущено: http://${HOST}:${PORT}`);
    console.log(` Локальна ізоляція: 127.0.0.1 (без зовнішніх мереж)`);
    console.log(` Сховище: notes/ (Inbox, Projects, Areas, Resources, Archives)`);
    console.log(`====================================================`);
  });
}

module.exports = server;
