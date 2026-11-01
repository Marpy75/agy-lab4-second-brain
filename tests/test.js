const assert = require('assert');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const noteService = require('../src/noteService');
const pkg = require('../package.json');

async function runTests() {
  console.log('🧪 Початок виконання автоматизованих тестів...\n');
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // Тест 1: Zero External Dependencies
  // -------------------------------------------------------------
  test('Zero Dependencies: package.json не повинен містити сторонніх runtime-залежностей', () => {
    assert.strictEqual(pkg.dependencies, undefined, 'Секція dependencies має бути відсутня');
    assert.strictEqual(pkg.scripts.start, 'node server.js', 'npm start має запускати node server.js');
  });

  // -------------------------------------------------------------
  // Тест 2: Path Traversal Protection
  // -------------------------------------------------------------
  test('Path Traversal: Дозволені лише категорії з білого списку PARA', () => {
    assert.strictEqual(noteService.validatePath('Inbox', 'valid.md').valid, true);
    assert.strictEqual(noteService.validatePath('Projects', 'valid.md').valid, true);
    assert.strictEqual(noteService.validatePath('Areas', 'valid.md').valid, true);
    assert.strictEqual(noteService.validatePath('Resources', 'valid.md').valid, true);
    assert.strictEqual(noteService.validatePath('Archives', 'valid.md').valid, true);

    const invalidCat = noteService.validatePath('HackedCategory', 'test.md');
    assert.strictEqual(invalidCat.valid, false);
    assert.strictEqual(invalidCat.error, 'INVALID_CATEGORY');
  });

  test('Path Traversal: Блокування спроб виходу за межі каталогу (.. / \\)', () => {
    const t1 = noteService.validatePath('Inbox', '../server.js.md');
    assert.strictEqual(t1.valid, false);
    assert.strictEqual(t1.error, 'PATH_TRAVERSAL_DETECTED');

    const t2 = noteService.validatePath('Inbox', '..\\server.js.md');
    assert.strictEqual(t2.valid, false);
    assert.strictEqual(t2.error, 'PATH_TRAVERSAL_DETECTED');

    const t3 = noteService.validatePath('Inbox', 'sub/test.md');
    assert.strictEqual(t3.valid, false);
    assert.strictEqual(t3.error, 'PATH_TRAVERSAL_DETECTED');

    const t4 = noteService.validatePath('Inbox', 'test.txt');
    assert.strictEqual(t4.valid, false);
    assert.strictEqual(t4.error, 'MUST_HAVE_MD_EXTENSION');
  });

  // -------------------------------------------------------------
  // Тест 3: YAML Frontmatter Parsing & Serialization
  // -------------------------------------------------------------
  test('YAML Engine: Коректний парсинг і серіалізація Frontmatter', () => {
    const rawNote = `---
title: "Архітектура процесорів"
created: "2026-11-01"
updated: "2026-11-01"
type: "lecture"
status: "in_progress"
tags:
  - "аскс"
  - "конвеєр"
source: "Лекція 1"
---

# Архітектура процесорів
Тіло нотатки з кодом:
\`\`\`c
int x = 42;
\`\`\`
`;

    const parsed = noteService.parseFrontmatter(rawNote);
    assert.strictEqual(parsed.metadata.title, 'Архітектура процесорів');
    assert.strictEqual(parsed.metadata.type, 'lecture');
    assert.strictEqual(parsed.metadata.status, 'in_progress');
    assert.deepStrictEqual(parsed.metadata.tags, ['аскс', 'конвеєр']);
    assert.strictEqual(parsed.metadata.source, 'Лекція 1');
    assert.ok(parsed.content.includes('Тіло нотатки з кодом:'));

    const serialized = noteService.serializeNote(parsed.metadata, parsed.content);
    assert.ok(serialized.startsWith('---'));
    assert.ok(serialized.includes('title: "Архітектура процесорів"'));
    assert.ok(serialized.includes('- "аскс"'));
    assert.ok(serialized.includes('int x = 42;'));
  });

  // -------------------------------------------------------------
  // Тест 4: Створення, читання, розрахунок Backlinks та Soft-Delete
  // -------------------------------------------------------------
  let testNote1 = null;
  let testNote2 = null;

  await asyncTest('CRUD: Створення тестових нотаток у сховищі', async () => {
    // 1. Створюємо першу нотатку в Inbox
    testNote1 = await noteService.createNote({
      title: 'Тестова тема АСКС',
      category: 'Inbox',
      type: 'lecture',
      status: 'inbox',
      tags: ['тест', 'аскс'],
      source: 'Методичка',
      content: 'Опис базової концепції конвеєра.'
    });

    assert.ok(testNote1.filename.endsWith('.md'));
    assert.strictEqual(testNote1.category, 'Inbox');

    // 2. Створюємо другу нотатку в Projects, яка посилається на першу
    testNote2 = await noteService.createNote({
      title: 'Проєкт з моделювання',
      category: 'Projects',
      type: 'lab',
      status: 'in_progress',
      tags: ['лаба'],
      source: '',
      content: 'Для реалізації проєкту див. [[Тестова тема АСКС]].'
    });

    assert.ok(testNote2.filename.endsWith('.md'));
  });

  await asyncTest('Backlinks: Розрахунок двосторонніх посилань між нотатками', async () => {
    // Отримуємо першу нотатку, перевіряємо, чи бачить вона посилання з testNote2
    const read1 = await noteService.getNote('Inbox', testNote1.filename);
    assert.ok(read1);
    assert.strictEqual(read1.metadata.title, 'Тестова тема АСКС');

    // Масив backlinks має містити посилання на testNote2
    const hasBacklink = read1.backlinks.some(bl =>
      bl.category === 'Projects' && bl.filename === testNote2.filename
    );
    assert.strictEqual(hasBacklink, true, 'Нотатка testNote1 повинна мати backlink від testNote2');
  });

  await asyncTest('Soft Delete: Переміщення в notes/Archives та зміна status на archived', async () => {
    // Викликаємо архівування для testNote1
    const archiveResult = await noteService.archiveNote('Inbox', testNote1.filename);
    assert.strictEqual(archiveResult.success, true);
    assert.strictEqual(archiveResult.category, 'Archives');

    // Перевіряємо, що в Inbox файлу більше немає
    const inboxPath = path.join(noteService.NOTES_ROOT, 'Inbox', testNote1.filename);
    assert.strictEqual(fs.existsSync(inboxPath), false, 'Файл мав бути видалений з Inbox');

    // Перевіряємо, що в Archives файл існує і має статус archived
    const archivedPath = path.join(noteService.NOTES_ROOT, 'Archives', archiveResult.filename);
    assert.strictEqual(fs.existsSync(archivedPath), true, 'Файл повинен існувати в Archives');

    const archivedNote = await noteService.getNote('Archives', archiveResult.filename);
    assert.strictEqual(archivedNote.metadata.status, 'archived', 'Статус нотатки має бути archived');

    // Прибирання за тестами
    await fsPromises.unlink(archivedPath);
    const projPath = path.join(noteService.NOTES_ROOT, 'Projects', testNote2.filename);
    if (fs.existsSync(projPath)) {
      await fsPromises.unlink(projPath);
    }
  });

  // -------------------------------------------------------------
  // Тест 5: Повний HTTP Інтеграційний тест
  // -------------------------------------------------------------
  await asyncTest('HTTP Server: Обробка запитів, безпека та API роутинг через HTTP', async () => {
    const server = require('../server');
    const http = require('http');

    // Запускаємо сервер на випадковому вільному порту
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;

    function request(path, options = {}) {
      return new Promise((resolve, reject) => {
        const req = http.request(`http://127.0.0.1:${port}${path}`, options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
        });
        req.on('error', reject);
        if (options.body) {
          req.write(options.body);
        }
        req.end();
      });
    }

    try {
      // 1. Статика /
      const rootRes = await request('/');
      assert.strictEqual(rootRes.status, 200);
      assert.ok(rootRes.data.includes('Second Brain') || rootRes.data.includes('public/index.html'));

      // 2. GET /api/summary
      const summaryRes = await request('/api/summary');
      assert.strictEqual(summaryRes.status, 200);
      const summaryObj = JSON.parse(summaryRes.data);
      assert.ok('counts' in summaryObj);

      // 3. Захист від Path Traversal через HTTP: спроба виходу за межі notes/
      const traversalRes = await request('/api/notes/Inbox/..%2Fserver.js');
      assert.strictEqual(traversalRes.status, 400, 'HTTP 400 очікується при спробі Path Traversal');
      const errObj = JSON.parse(traversalRes.data);
      assert.strictEqual(errObj.error, 'INVALID_PATH');

      // 4. Захист від невідомої категорії
      const invalidCatRes = await request('/api/notes/SecretHacks/note.md');
      assert.strictEqual(invalidCatRes.status, 400);

      // 5. POST /api/notes створення нотатки через HTTP
      const postRes = await request('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Інтеграційний тест HTTP',
          category: 'Inbox',
          type: 'lecture',
          status: 'inbox',
          tags: ['http-test'],
          content: 'Вміст створений через HTTP POST запит.'
        })
      });
      assert.strictEqual(postRes.status, 201);
      const createdObj = JSON.parse(postRes.data);
      assert.strictEqual(createdObj.category, 'Inbox');

      // 6. DELETE /api/notes/:category/:filename м'яке видалення (архівація) через HTTP
      const delRes = await request(`/api/notes/Inbox/${createdObj.filename}`, {
        method: 'DELETE'
      });
      assert.strictEqual(delRes.status, 200);
      const delObj = JSON.parse(delRes.data);
      assert.strictEqual(delObj.category, 'Archives');

      // Очищення тестового файлу з Archives
      const archivedFile = path.join(noteService.NOTES_ROOT, 'Archives', delObj.filename);
      if (fs.existsSync(archivedFile)) {
        await fsPromises.unlink(archivedFile);
      }
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log(`\n====================================================`);
  console.log(` Результати тестування: ${passed} пройдено, ${failed} провалено.`);
  console.log(`====================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Непередбачена помилка під час виконання тестів:', err);
  process.exit(1);
});
