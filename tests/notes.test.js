const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const noteService = require('../src/noteService');

describe('Second Brain: Набір автоматизованих тестів ядра', () => {
  const createdTestFiles = [];

  // Допоміжна функція для створення тестових нотаток із подальшим видаленням
  async function createTestNote(data) {
    const note = await noteService.createNote(data);
    createdTestFiles.push({ category: note.category, filename: note.filename });
    return note;
  }

  after(async () => {
    // Прибирання створених тимчасових тестових файлів
    for (const f of createdTestFiles) {
      const fullPath = path.join(noteService.NOTES_ROOT, f.category, f.filename);
      if (fs.existsSync(fullPath)) {
        try {
          await fsPromises.unlink(fullPath);
        } catch (e) {
          // ігноруємо помилки очищення
        }
      }
    }
  });

  // -------------------------------------------------------------
  // 1. Парсинг Frontmatter
  // -------------------------------------------------------------
  test('1. Парсинг YAML Frontmatter: вилучення всіх метаданих та тіла', () => {
    const rawNote = `---
title: "Конвеєризація процесорів"
created: "2026-11-01"
updated: "2026-11-01"
type: "lecture"
status: "in_progress"
tags:
  - "аскс"
  - "конвеєр"
source: "Підручник АСКС, с. 45"
---

# Конвеєризація процесорів

Опис апаратних конфліктів конвеєра.
`;

    const parsed = noteService.parseFrontmatter(rawNote);

    assert.strictEqual(parsed.metadata.title, 'Конвеєризація процесорів');
    assert.strictEqual(parsed.metadata.created, '2026-11-01');
    assert.strictEqual(parsed.metadata.updated, '2026-11-01');
    assert.strictEqual(parsed.metadata.type, 'lecture');
    assert.strictEqual(parsed.metadata.status, 'in_progress');
    assert.deepStrictEqual(parsed.metadata.tags, ['аскс', 'конвеєр']);
    assert.strictEqual(parsed.metadata.source, 'Підручник АСКС, с. 45');
    assert.ok(parsed.content.includes('Опис апаратних конфліктів конвеєра.'));
  });

  test('1.1. Парсинг Frontmatter: інлайнові теги [tag1, tag2] та заголовок за замовчуванням', () => {
    const rawInline = `---
title: "Мікроархітектура"
tags: ["процесори", "кеш"]
---
Вміст без H1 заголовка.`;

    const parsed = noteService.parseFrontmatter(rawInline);
    assert.strictEqual(parsed.metadata.title, 'Мікроархітектура');
    assert.deepStrictEqual(parsed.metadata.tags, ['процесори', 'кеш']);
    assert.strictEqual(parsed.metadata.type, 'lecture');
  });

  // -------------------------------------------------------------
  // 2. Пошук за словом (кирилиця без урахування регістру)
  // -------------------------------------------------------------
  test('2. Пошук за словом: нечутливість до регістру для кирилиці в заголовку та тексті', async () => {
    await createTestNote({
      title: 'Спеціалізовані Обчислювальні Системи',
      category: 'Areas',
      type: 'concept',
      status: 'in_progress',
      tags: ['компютери'],
      content: 'Тут розглядається КОНВЕЄРИЗАЦІЯ інструкцій та суперскалярність.'
    });

    // Пошук у нижньому регістрі по слову з заголовка
    const resLower = await noteService.listNotes({ search: 'обчислювальні' });
    assert.ok(resLower.length > 0, 'Має знайти нотатку за словом у нижньому регістрі');
    assert.strictEqual(resLower[0].title, 'Спеціалізовані Обчислювальні Системи');

    // Пошук у верхньому регістрі по слову з заголовка
    const resUpper = await noteService.listNotes({ search: 'СПЕЦІАЛІЗОВАНІ' });
    assert.ok(resUpper.length > 0, 'Має знайти нотатку за словом у верхньому регістрі');

    // Пошук у змішаному регістрі по слову з тіла
    const resContent = await noteService.listNotes({ search: 'КоНвЕєРиЗаЦіЯ' });
    assert.ok(resContent.length > 0, 'Має знайти нотатку за словом із контенту в змішаному регістрі');
  });

  // -------------------------------------------------------------
  // 3. Фільтр за тегом
  // -------------------------------------------------------------
  test('3. Фільтр за тегом: точний та нечутливий до регістру відбір', async () => {
    await createTestNote({
      title: 'Лабораторна з FPGA',
      category: 'Projects',
      type: 'lab',
      status: 'in_progress',
      tags: ['ПЛІС', 'Verilog', 'лаба4'],
      content: 'Опис синтезу схеми.'
    });

    await createTestNote({
      title: 'Теорія графів',
      category: 'Resources',
      type: 'literature',
      status: 'completed',
      tags: ['математика'],
      content: 'Алгоритм Дейкстри.'
    });

    // Фільтр за тегом у нижньому регістрі (пліс)
    const resTagLower = await noteService.listNotes({ tag: 'пліс' });
    assert.ok(resTagLower.length > 0, 'Повинен знайти нотатку з тегом #ПЛІС');
    assert.strictEqual(resTagLower[0].title, 'Лабораторна з FPGA');

    // Перевірка, що нотатки без цього тегу не потрапляють у вибірку
    const hasMath = resTagLower.some(n => n.tags.includes('математика'));
    assert.strictEqual(hasMath, false, 'Нотатки без тегу не повинні бути у вибірці');
  });

  // -------------------------------------------------------------
  // 4. Виділення [[посилань]] (Wikilinks)
  // -------------------------------------------------------------
  test('4. Виділення [[посилань]]: вилучення всіх двосторонніх зв\'язків із тексту', () => {
    const textWithLinks = `
      Під час проектування конвеєра див. [[Архітектура процесора]] та [[Керування пам'яттю]].
      Також зверніть увагу на [[Архітектура процесора]] ще раз.
    `;

    const links = noteService.extractWikilinks(textWithLinks);
    assert.strictEqual(links.length, 2, 'Має знайти рівно два унікальні посилання');
    assert.strictEqual(links[0], 'Архітектура процесора');
    assert.strictEqual(links[1], "Керування пам'яттю");

    // Порожній текст або відсутність посилань
    assert.deepStrictEqual(noteService.extractWikilinks('Простий текст без посилань'), []);
    assert.deepStrictEqual(noteService.extractWikilinks(''), []);
  });

  test('4.1. Двосторонні посилання: автоматичний розрахунок Backlinks через getNote', async () => {
    const target = await createTestNote({
      title: 'Базова мікрокоманда',
      category: 'Inbox',
      type: 'concept',
      status: 'inbox',
      tags: ['мікрокод'],
      content: 'Визначення атомарної операції АЛП.'
    });

    await createTestNote({
      title: 'Блок керування процесором',
      category: 'Areas',
      type: 'lecture',
      status: 'in_progress',
      tags: ['аскс'],
      content: 'Формує послідовність сигналів, див. [[Базова мікрокоманда]].'
    });

    const loadedTarget = await noteService.getNote('Inbox', target.filename);
    assert.ok(loadedTarget);
    assert.ok(Array.isArray(loadedTarget.backlinks));
    assert.strictEqual(loadedTarget.backlinks.length, 1);
    assert.strictEqual(loadedTarget.backlinks[0].title, 'Блок керування процесором');
  });

  // -------------------------------------------------------------
  // 5. Порожній результат пошуку
  // -------------------------------------------------------------
  test('5. Порожній результат: коректне повернення [] при відсутності збігів', async () => {
    // Неіснуючий пошуковий запит
    const noNotes = await noteService.listNotes({ search: 'НереальнеСловоЯкогоНеІснуєВБазі12345' });
    assert.ok(Array.isArray(noNotes));
    assert.strictEqual(noNotes.length, 0, 'Результат пошуку має бути порожнім масивом');

    // Неіснуючий тег
    const noTag = await noteService.listNotes({ tag: 'вигаданий-тег-999999' });
    assert.ok(Array.isArray(noTag));
    assert.strictEqual(noTag.length, 0, 'Результат фільтра за тегом має бути порожнім масивом');
  });

  // -------------------------------------------------------------
  // 6. Блокування Path Traversal (../)
  // -------------------------------------------------------------
  test('6. Блокування Path Traversal: заборона виходу за межі папки (../, ..\\, слеші)', () => {
    // Спроба піднятися вище через ..
    const resDotDot1 = noteService.validatePath('Inbox', '../server.js.md');
    assert.strictEqual(resDotDot1.valid, false);
    assert.strictEqual(resDotDot1.error, 'PATH_TRAVERSAL_DETECTED');

    const resDotDot2 = noteService.validatePath('Inbox', '..\\server.js.md');
    assert.strictEqual(resDotDot2.valid, false);
    assert.strictEqual(resDotDot2.error, 'PATH_TRAVERSAL_DETECTED');

    // Спроба вкладених папок
    const resSlash = noteService.validatePath('Inbox', 'subfolder/note.md');
    assert.strictEqual(resSlash.valid, false);
    assert.strictEqual(resSlash.error, 'PATH_TRAVERSAL_DETECTED');

    // Невалідна категорія
    const resCat = noteService.validatePath('../../etc', 'passwd.md');
    assert.strictEqual(resCat.valid, false);
    assert.strictEqual(resCat.error, 'INVALID_CATEGORY');

    // Заборона розширень відмінних від .md
    const resExt = noteService.validatePath('Inbox', 'script.sh');
    assert.strictEqual(resExt.valid, false);
    assert.strictEqual(resExt.error, 'MUST_HAVE_MD_EXTENSION');

    // Валідний шлях
    const resValid = noteService.validatePath('Areas', 'architecture-notes.md');
    assert.strictEqual(resValid.valid, true);
  });

  // -------------------------------------------------------------
  // 7. Екранування HTML (<script>)
  // -------------------------------------------------------------
  test('7. Екранування HTML: знешкодження <script>, лапок та небезпечних атрибутів', () => {
    const maliciousScript = '<script>alert("XSS-ATTACK")</script>';
    const escapedScript = noteService.escapeHtml(maliciousScript);

    assert.strictEqual(escapedScript.includes('<script>'), false, 'Не повинен містити небезпечний тег <script>');
    assert.strictEqual(escapedScript.includes('</script>'), false, 'Не повинен містити закриваючий тег </script>');
    assert.strictEqual(escapedScript, '&lt;script&gt;alert(&quot;XSS-ATTACK&quot;)&lt;/script&gt;');

    // Перевірка ін'єкції через обробники подій в атрибутах
    const maliciousAttr = '<img src=x onerror=\'alert(1)\'>';
    const escapedAttr = noteService.escapeHtml(maliciousAttr);
    assert.strictEqual(escapedAttr, '&lt;img src=x onerror=&#39;alert(1)&#39;&gt;');

    // Перевірка безпеки звичайних амперсандів та спецсимволів
    assert.strictEqual(noteService.escapeHtml('a & b > c < d'), 'a &amp; b &gt; c &lt; d');
    assert.strictEqual(noteService.escapeHtml(null), '');
    assert.strictEqual(noteService.escapeHtml(undefined), '');
  });
});
