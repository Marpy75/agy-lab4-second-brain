const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');

const NOTES_ROOT = path.resolve(__dirname, '..', 'notes');
const ALLOWED_CATEGORIES = ['Inbox', 'Projects', 'Areas', 'Resources', 'Archives'];

/**
 * Валідація шляху для захисту від Path Traversal
 * Категорія має бути суворо з білого списку
 * Ім'я файлу не може містити '..', '/', '\' та повинно мати розширення .md
 */
function validatePath(category, filename) {
  if (!ALLOWED_CATEGORIES.includes(category)) {
    return { valid: false, error: 'INVALID_CATEGORY' };
  }

  if (!filename || typeof filename !== 'string') {
    return { valid: false, error: 'INVALID_FILENAME' };
  }

  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return { valid: false, error: 'PATH_TRAVERSAL_DETECTED' };
  }

  if (!filename.endsWith('.md')) {
    return { valid: false, error: 'MUST_HAVE_MD_EXTENSION' };
  }

  const baseName = filename.slice(0, -3);
  if (!baseName || baseName.trim().length === 0) {
    return { valid: false, error: 'EMPTY_FILENAME' };
  }

  // Перевірка коректності резолюції шляху
  const expectedDir = path.resolve(NOTES_ROOT, category);
  const resolvedFile = path.resolve(expectedDir, filename);

  if (!resolvedFile.startsWith(expectedDir + path.sep)) {
    return { valid: false, error: 'PATH_OUTSIDE_CATEGORY' };
  }

  return { valid: true, fullPath: resolvedFile };
}

/**
 * Парсинг YAML Frontmatter без зовнішніх бібліотек
 */
function parseFrontmatter(fileContent) {
  const normalized = fileContent.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);

  if (!match) {
    return {
      metadata: {
        title: 'Без назви',
        created: new Date().toISOString().slice(0, 10),
        updated: new Date().toISOString().slice(0, 10),
        type: 'lecture',
        status: 'inbox',
        tags: [],
        source: ''
      },
      content: fileContent
    };
  }

  const rawYaml = match[1];
  const markdownContent = match[2];

  const metadata = {
    title: '',
    created: '',
    updated: '',
    type: 'lecture',
    status: 'inbox',
    tags: [],
    source: ''
  };

  const lines = rawYaml.split('\n');
  let currentKey = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Обробка елементів списку для tags
    if (trimmed.startsWith('- ') && currentKey === 'tags') {
      const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
      if (val) metadata.tags.push(val);
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();

    if (key === 'tags') {
      currentKey = 'tags';
      if (value.startsWith('[') && value.endsWith(']')) {
        const rawItems = value.slice(1, -1).split(',');
        metadata.tags = rawItems
          .map(item => item.trim().replace(/^["']|["']$/g, ''))
          .filter(Boolean);
        currentKey = null;
      } else {
        metadata.tags = [];
      }
    } else {
      currentKey = null;
      // Видалення лапок
      value = value.replace(/^["']|["']$/g, '');
      if (key in metadata) {
        metadata[key] = value;
      }
    }
  }

  if (!metadata.title) {
    // Спроба знайти перший H1 заголовок
    const h1Match = markdownContent.match(/^#\s+(.+)$/m);
    metadata.title = h1Match ? h1Match[1].trim() : 'Без назви';
  }

  return { metadata, content: markdownContent };
}

/**
 * Серіалізація нотатки у формат Markdown з YAML Frontmatter
 */
function serializeNote(metadata, content) {
  const lines = ['---'];
  lines.push(`title: ${JSON.stringify(metadata.title || 'Без назви')}`);
  lines.push(`created: ${JSON.stringify(metadata.created || new Date().toISOString().slice(0, 10))}`);
  lines.push(`updated: ${JSON.stringify(new Date().toISOString().slice(0, 10))}`);
  lines.push(`type: ${JSON.stringify(metadata.type || 'lecture')}`);
  lines.push(`status: ${JSON.stringify(metadata.status || 'in_progress')}`);

  const tags = Array.isArray(metadata.tags)
    ? metadata.tags.map(t => String(t).trim()).filter(Boolean)
    : [];

  if (tags.length === 0) {
    lines.push('tags: []');
  } else {
    lines.push('tags:');
    for (const tag of tags) {
      lines.push(`  - ${JSON.stringify(tag)}`);
    }
  }

  lines.push(`source: ${JSON.stringify(metadata.source || '')}`);
  lines.push('---');
  lines.push('');
  lines.push((content || '').trim());
  lines.push('');

  return lines.join('\n');
}

/**
 * Генерація безпечного імені файлу (slug)
 */
function generateFilename(title) {
  const safe = (title || 'note')
    .toLowerCase()
    .trim()
    .replace(/[\\/:\*\?"<>\|\s]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  const base = safe || 'note';
  return `${base}.md`;
}

/**
 * Отримання списку нотаток із лінійним пошуком та фільтрацією за тегами/категоріями
 */
async function listNotes(query = {}) {
  const { search, tag, category } = query;
  const categoriesToScan = category && ALLOWED_CATEGORIES.includes(category)
    ? [category]
    : ALLOWED_CATEGORIES;

  const results = [];
  const searchLower = search ? search.toLowerCase().trim() : null;
  const tagLower = tag ? tag.toLowerCase().trim() : null;

  for (const cat of categoriesToScan) {
    const catDir = path.join(NOTES_ROOT, cat);
    if (!fs.existsSync(catDir)) continue;

    const files = await fsPromises.readdir(catDir);
    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const fullPath = path.join(catDir, file);
      try {
        const raw = await fsPromises.readFile(fullPath, 'utf-8');
        const { metadata, content } = parseFrontmatter(raw);

        // Фільтр за тегом
        if (tagLower) {
          const hasTag = metadata.tags.some(t => t.toLowerCase() === tagLower);
          if (!hasTag) continue;
        }

        // Лінійний пошук за підрядком у назві чи тексті
        if (searchLower) {
          const matchTitle = metadata.title.toLowerCase().includes(searchLower);
          const matchContent = content.toLowerCase().includes(searchLower);
          const matchSource = (metadata.source || '').toLowerCase().includes(searchLower);
          if (!matchTitle && !matchContent && !matchSource) continue;
        }

        // Генерація короткого сніпету
        const plainSnippet = content
          .replace(/[#*`_>\[\]]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 140);

        results.push({
          category: cat,
          filename: file,
          title: metadata.title,
          created: metadata.created,
          updated: metadata.updated,
          type: metadata.type,
          status: metadata.status,
          tags: metadata.tags,
          source: metadata.source,
          snippet: plainSnippet
        });
      } catch (err) {
        console.error(`Помилка читання файлу ${fullPath}:`, err.message);
      }
    }
  }

  // Сортування за датою оновлення (найсвіжіші першими)
  results.sort((a, b) => {
    const dateA = a.updated || a.created || '';
    const dateB = b.updated || b.created || '';
    return dateB.localeCompare(dateA);
  });

  return results;
}

/**
 * Отримання конкретної нотатки та розрахунок зворотних посилань (Backlinks)
 */
async function getNote(category, filename) {
  const check = validatePath(category, filename);
  if (!check.valid) {
    throw new Error(check.error);
  }

  if (!fs.existsSync(check.fullPath)) {
    return null;
  }

  const raw = await fsPromises.readFile(check.fullPath, 'utf-8');
  const { metadata, content } = parseFrontmatter(raw);

  // Обчислення Backlinks
  const baseName = filename.slice(0, -3);
  const targetMarkers = [
    `[[${metadata.title}]]`.toLowerCase(),
    `[[${baseName}]]`.toLowerCase()
  ];

  const backlinks = [];

  for (const cat of ALLOWED_CATEGORIES) {
    const catDir = path.join(NOTES_ROOT, cat);
    if (!fs.existsSync(catDir)) continue;

    const files = await fsPromises.readdir(catDir);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      if (cat === category && f === filename) continue; // Не посилатися на саму себе

      const fPath = path.join(catDir, f);
      try {
        const fileContent = await fsPromises.readFile(fPath, 'utf-8');
        const fileContentLower = fileContent.toLowerCase();

        const isLinked = targetMarkers.some(marker => fileContentLower.includes(marker));
        if (isLinked) {
          const { metadata: otherMeta } = parseFrontmatter(fileContent);
          backlinks.push({
            category: cat,
            filename: f,
            title: otherMeta.title || f.slice(0, -3)
          });
        }
      } catch (err) {
        console.error(`Помилка аналізу backlinks у ${fPath}:`, err.message);
      }
    }
  }

  return {
    category,
    filename,
    metadata,
    content,
    backlinks
  };
}

/**
 * Створення нової нотатки
 */
async function createNote(data) {
  const category = data.category || 'Inbox';
  if (!ALLOWED_CATEGORIES.includes(category)) {
    throw new Error('INVALID_CATEGORY');
  }

  const title = (data.title || 'Нова нотатка').trim();
  let filename = generateFilename(title);

  const catDir = path.join(NOTES_ROOT, category);
  if (!fs.existsSync(catDir)) {
    await fsPromises.mkdir(catDir, { recursive: true });
  }

  // Якщо файл з такою назвою існує, додаємо таймстемп
  let targetPath = path.join(catDir, filename);
  if (fs.existsSync(targetPath)) {
    const base = filename.slice(0, -3);
    filename = `${base}-${Date.now().toString().slice(-4)}.md`;
    targetPath = path.join(catDir, filename);
  }

  const metadata = {
    title,
    created: data.created || new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    type: data.type || 'lecture',
    status: data.status || (category === 'Inbox' ? 'inbox' : 'in_progress'),
    tags: Array.isArray(data.tags) ? data.tags : [],
    source: data.source || ''
  };

  const fileBody = serializeNote(metadata, data.content || '');
  await fsPromises.writeFile(targetPath, fileBody, 'utf-8');

  return {
    category,
    filename,
    metadata,
    content: data.content || ''
  };
}

/**
 * Оновлення існуючої нотатки (з підтримкою переміщення між папками PARA)
 */
async function updateNote(currentCategory, currentFilename, data) {
  const check = validatePath(currentCategory, currentFilename);
  if (!check.valid) {
    throw new Error(check.error);
  }

  if (!fs.existsSync(check.fullPath)) {
    return null;
  }

  const targetCategory = data.category && ALLOWED_CATEGORIES.includes(data.category)
    ? data.category
    : currentCategory;

  const metadata = {
    title: (data.title || 'Без назви').trim(),
    created: data.created || new Date().toISOString().slice(0, 10),
    updated: new Date().toISOString().slice(0, 10),
    type: data.type || 'lecture',
    status: data.status || 'in_progress',
    tags: Array.isArray(data.tags) ? data.tags : [],
    source: data.source || ''
  };

  const fileBody = serializeNote(metadata, data.content || '');

  // Якщо категорія змінилася — переміщуємо файл
  if (targetCategory !== currentCategory) {
    const targetDir = path.join(NOTES_ROOT, targetCategory);
    if (!fs.existsSync(targetDir)) {
      await fsPromises.mkdir(targetDir, { recursive: true });
    }

    let targetFilename = currentFilename;
    let targetPath = path.join(targetDir, targetFilename);

    if (fs.existsSync(targetPath)) {
      const base = currentFilename.slice(0, -3);
      targetFilename = `${base}-${Date.now().toString().slice(-4)}.md`;
      targetPath = path.join(targetDir, targetFilename);
    }

    await fsPromises.writeFile(targetPath, fileBody, 'utf-8');
    await fsPromises.unlink(check.fullPath);

    return {
      category: targetCategory,
      filename: targetFilename,
      metadata,
      content: data.content || ''
    };
  }

  // Оновлення у тій самій папці
  await fsPromises.writeFile(check.fullPath, fileBody, 'utf-8');

  return {
    category: currentCategory,
    filename: currentFilename,
    metadata,
    content: data.content || ''
  };
}

/**
 * М'яке видалення (Soft Delete / Архівація)
 * Переносить нотатку в notes/Archives і встановлює status: 'archived'
 */
async function archiveNote(category, filename) {
  const check = validatePath(category, filename);
  if (!check.valid) {
    throw new Error(check.error);
  }

  if (!fs.existsSync(check.fullPath)) {
    return null;
  }

  const raw = await fsPromises.readFile(check.fullPath, 'utf-8');
  const { metadata, content } = parseFrontmatter(raw);

  metadata.status = 'archived';
  metadata.updated = new Date().toISOString().slice(0, 10);

  const updatedBody = serializeNote(metadata, content);
  const archivesDir = path.join(NOTES_ROOT, 'Archives');

  if (!fs.existsSync(archivesDir)) {
    await fsPromises.mkdir(archivesDir, { recursive: true });
  }

  let targetFilename = filename;
  let targetPath = path.join(archivesDir, targetFilename);

  // Якщо файл з такою назвою вже є в Archives (і це не той самий файл), запобігаємо перезапису
  if (category !== 'Archives' && fs.existsSync(targetPath)) {
    const base = filename.slice(0, -3);
    targetFilename = `${base}-archived-${Date.now().toString().slice(-4)}.md`;
    targetPath = path.join(archivesDir, targetFilename);
  }

  await fsPromises.writeFile(targetPath, updatedBody, 'utf-8');

  // Видаляємо з початкової папки, якщо вона не була Archives
  if (category !== 'Archives') {
    await fsPromises.unlink(check.fullPath);
  }

  return {
    success: true,
    message: 'Нотатку успішно архівовано',
    category: 'Archives',
    filename: targetFilename,
    metadata
  };
}

/**
 * Отримання зведеної статистики за категоріями PARA та унікальних тегів
 */
async function getSummary() {
  const counts = {
    Inbox: 0,
    Projects: 0,
    Areas: 0,
    Resources: 0,
    Archives: 0,
    Total: 0
  };

  const tagMap = new Map();

  for (const cat of ALLOWED_CATEGORIES) {
    const catDir = path.join(NOTES_ROOT, cat);
    if (!fs.existsSync(catDir)) continue;

    const files = await fsPromises.readdir(catDir);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      counts[cat]++;
      counts.Total++;

      try {
        const content = await fsPromises.readFile(path.join(catDir, f), 'utf-8');
        const { metadata } = parseFrontmatter(content);
        for (const t of metadata.tags) {
          const norm = t.toLowerCase();
          tagMap.set(norm, (tagMap.get(norm) || 0) + 1);
        }
      } catch (e) {
        // ігноруємо помилки парсингу окремого файлу при підрахунку
      }
    }
  }

  const tags = Array.from(tagMap.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  return { counts, tags };
}

/**
 * Виділення всіх [[посилань]] (Wikilinks) із тексту
 */
function extractWikilinks(text) {
  if (!text) return [];
  const matches = [];
  const regex = /\[\[(.*?)\]\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const clean = match[1].trim();
    if (clean && !matches.includes(clean)) {
      matches.push(clean);
    }
  }
  return matches;
}

/**
 * Власне надійне екранування HTML-сутностей для захисту від XSS (<script>, атрибути тощо)
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = {
  NOTES_ROOT,
  ALLOWED_CATEGORIES,
  validatePath,
  parseFrontmatter,
  serializeNote,
  generateFilename,
  listNotes,
  getNote,
  createNote,
  updateNote,
  archiveNote,
  getSummary,
  extractWikilinks,
  escapeHtml
};
