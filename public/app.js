/**
 * Second Brain — Клієнтська логіка
 * Чистий Vanilla JavaScript (ES6+), без сторонніх бібліотек
 */

(function () {
  'use strict';

  // Стан застосунку (Application State)
  const state = {
    currentCategory: 'ALL',
    currentTag: null,
    searchQuery: '',
    notes: [],
    selectedNote: null,
    editingNote: null, // null для нової нотатки або { category, filename } для редагування
    notePendingArchive: null
  };

  // DOM Елементи
  const elements = {
    // Навігація та фільтри
    navItems: document.querySelectorAll('.nav-item'),
    counts: {
      ALL: document.getElementById('count-ALL'),
      Inbox: document.getElementById('count-Inbox'),
      Projects: document.getElementById('count-Projects'),
      Areas: document.getElementById('count-Areas'),
      Resources: document.getElementById('count-Resources'),
      Archives: document.getElementById('count-Archives')
    },
    tagsCloud: document.getElementById('tags-cloud'),
    searchInput: document.getElementById('search-input'),
    searchClear: document.getElementById('search-clear'),
    activeFilterBadge: document.getElementById('active-filter-badge'),
    filterText: document.getElementById('filter-text'),
    filterResetBtn: document.getElementById('filter-reset-btn'),

    // Список нотаток
    currentViewTitle: document.getElementById('current-view-title'),
    notesCountBadge: document.getElementById('notes-count-badge'),
    notesCardsContainer: document.getElementById('notes-cards-container'),

    // Переглядач нотатки
    viewerPlaceholder: document.getElementById('viewer-placeholder'),
    noteArticle: document.getElementById('note-article'),
    viewCategory: document.getElementById('view-category'),
    viewType: document.getElementById('view-type'),
    viewStatus: document.getElementById('view-status'),
    viewDates: document.getElementById('view-dates'),
    viewTitle: document.getElementById('view-title'),
    viewSourceRow: document.getElementById('view-source-row'),
    viewSource: document.getElementById('view-source'),
    viewTagsRow: document.getElementById('view-tags-row'),
    viewBody: document.getElementById('view-body'),
    backlinksSection: document.getElementById('backlinks-section'),
    backlinksList: document.getElementById('backlinks-list'),
    btnEditNote: document.getElementById('btn-edit-note'),
    btnArchiveNote: document.getElementById('btn-archive-note'),

    // Модальне вікно редактора
    btnCreateNote: document.getElementById('btn-create-note'),
    editorModal: document.getElementById('editor-modal'),
    modalTitle: document.getElementById('modal-title'),
    btnModalClose: document.getElementById('btn-modal-close'),
    btnFormCancel: document.getElementById('btn-form-cancel'),
    noteForm: document.getElementById('note-form'),
    formTitle: document.getElementById('form-title'),
    formCategory: document.getElementById('form-category'),
    formType: document.getElementById('form-type'),
    formStatus: document.getElementById('form-status'),
    formTags: document.getElementById('form-tags'),
    formSource: document.getElementById('form-source'),
    formContent: document.getElementById('form-content'),

    // Модальне вікно підтвердження архівації
    confirmModal: document.getElementById('confirm-modal'),
    confirmMessage: document.getElementById('confirm-message'),
    btnConfirmClose: document.getElementById('btn-confirm-close'),
    btnConfirmCancel: document.getElementById('btn-confirm-cancel'),
    btnConfirmProceed: document.getElementById('btn-confirm-proceed'),

    // Контейнер сповіщень
    toastContainer: document.getElementById('toast-container')
  };

  // -------------------------------------------------------------
  // Безпека: Власне екранування HTML (Zero-DOMPurify)
  // -------------------------------------------------------------
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // -------------------------------------------------------------
  // Власний підсвічувач синтаксису (Code Syntax Highlighter)
  // -------------------------------------------------------------
  function highlightCode(escapedCode, lang) {
    // Список ключових слів для C/C++, JS/TS, Python тощо
    const keywords = [
      'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
      'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new',
      'import', 'export', 'from', 'default', 'async', 'await', 'try', 'catch',
      'throw', 'finally', 'typeof', 'instanceof', 'void', 'this', 'super',
      'int', 'char', 'float', 'double', 'bool', 'struct', 'typedef', 'enum',
      'union', 'sizeof', 'static', 'extern', 'inline', 'public', 'private',
      'protected', 'virtual', 'def', 'elif', 'pass', 'lambda', 'with', 'as',
      'yield', 'None', 'True', 'False', 'module', 'wire', 'reg', 'always'
    ];

    const kwRegex = new RegExp(`\\b(${keywords.join('|')})\\b`, 'g');

    // Розбиваємо на рядки для безпечної підсвітки коментарів
    const lines = escapedCode.split('\n');
    const highlightedLines = lines.map(line => {
      // Однорядкові коментарі: // або #
      const commentIdx = line.search(/(\/\/|#)/);
      let codePart = line;
      let commentPart = '';

      if (commentIdx !== -1) {
        codePart = line.slice(0, commentIdx);
        commentPart = `<span class="tok-com">${line.slice(commentIdx)}</span>`;
      }

      // Рядки (strings)
      codePart = codePart.replace(/(['"])(?:(?=(\\?))\2.)*?\1/g, '<span class="tok-str">$&</span>');

      // Числа
      codePart = codePart.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');

      // Ключові слова
      codePart = codePart.replace(kwRegex, '<span class="tok-kw">$1</span>');

      // Виклики функцій: name(...)
      codePart = codePart.replace(/\b([a-zA-Z_]\w*)(?=\s*\()/g, '<span class="tok-fn">$1</span>');

      return codePart + commentPart;
    });

    return highlightedLines.join('\n');
  }

  // -------------------------------------------------------------
  // Власний легковажний рендерер Markdown з підтримкою [[Wikilinks]]
  // -------------------------------------------------------------
  function renderMarkdown(mdText) {
    if (!mdText) return '';

    const codeBlocks = [];

    // 1. Вилучаємо блоки коду ```lang ... ``` щоб не ламати їх іншими регулярками
    let text = mdText.replace(/```([a-zA-Z0-9_\-\.]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const escaped = escapeHtml(code.trim());
      const highlighted = highlightCode(escaped, lang);
      const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
      codeBlocks.push(`<pre><code class="language-${escapeHtml(lang)}">${highlighted}</code></pre>`);
      return placeholder;
    });

    // 2. Інлайн код `code`
    text = text.replace(/`([^`]+)`/g, (m, code) => {
      return `<code>${escapeHtml(code)}</code>`;
    });

    // 3. Екрануємо решту звичайного тексту перед створенням HTML-структури
    text = escapeHtml(text);

    // 4. Двосторонні посилання [[Назва]]
    text = text.replace(/\[\[(.*?)\]\]/g, (m, linkText) => {
      const clean = linkText.trim();
      return `<a href="#" class="wikilink" data-link="${clean}">[[${clean}]]</a>`;
    });

    // 5. Заголовки (H1 - H4)
    text = text.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    text = text.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');

    // 6. Цитати (Blockquotes)
    text = text.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');

    // 7. Списки
    text = text.replace(/^[\*\-]\s+(.+)$/gm, '<li>$1</li>');
    text = text.replace(/(<li>.*<\/li>)/gms, '<ul>$1</ul>');

    // 8. Жирний та курсив
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 9. Горизонтальна лінія
    text = text.replace(/^---$/gm, '<hr>');

    // 10. Посилання [текст](url)
    text = text.replace(/\[(.*?)\]\((https?:\/\/[^\s]+)\)/g, (m, txt, link) => {
      return `<a href="${link}" target="_blank" rel="noopener noreferrer">${txt}</a>`;
    });

    // 11. Абзаци (розбиття за подвійним переводом рядка)
    const paragraphs = text.split(/\n{2,}/);
    const htmlParts = paragraphs.map(p => {
      const trimmed = p.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<h') || trimmed.startsWith('<ul>') ||
          trimmed.startsWith('<blockquote>') || trimmed.startsWith('<hr>') ||
          trimmed.startsWith('__CODE_BLOCK_')) {
        return trimmed;
      }
      return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
    });

    let resultHtml = htmlParts.join('\n');

    // 12. Повертаємо збережені блоки коду
    codeBlocks.forEach((block, idx) => {
      resultHtml = resultHtml.replace(`__CODE_BLOCK_${idx}__`, block);
    });

    return resultHtml;
  }

  // -------------------------------------------------------------
  // Сповіщення (Toasts)
  // -------------------------------------------------------------
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span> <span>${escapeHtml(message)}</span>`;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.25s ease-out';
      setTimeout(() => toast.remove(), 250);
    }, 3200);
  }

  // -------------------------------------------------------------
  // API Запити до локального сервера
  // -------------------------------------------------------------
  async function apiFetch(endpoint, options = {}) {
    try {
      const response = await fetch(endpoint, {
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {})
        },
        ...options
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.details || errorData.error || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      console.error(`API Error (${endpoint}):`, err);
      throw err;
    }
  }

  // -------------------------------------------------------------
  // Оновлення зведеної статистики та тегів
  // -------------------------------------------------------------
  async function loadSummary() {
    try {
      const summary = await apiFetch('/api/summary');
      const counts = summary.counts;

      elements.counts.ALL.textContent = counts.Total;
      elements.counts.Inbox.textContent = counts.Inbox;
      elements.counts.Projects.textContent = counts.Projects;
      elements.counts.Areas.textContent = counts.Areas;
      elements.counts.Resources.textContent = counts.Resources;
      elements.counts.Archives.textContent = counts.Archives;

      // Рендеринг хмари тегів
      elements.tagsCloud.innerHTML = '';
      if (summary.tags.length === 0) {
        elements.tagsCloud.innerHTML = '<span class="empty-hint">Немає тегів</span>';
        return;
      }

      summary.tags.forEach(item => {
        const tagEl = document.createElement('span');
        tagEl.className = `tag-chip ${state.currentTag === item.tag ? 'active' : ''}`;
        tagEl.textContent = `#${item.tag} (${item.count})`;
        tagEl.addEventListener('click', () => {
          if (state.currentTag === item.tag) {
            state.currentTag = null;
          } else {
            state.currentTag = item.tag;
          }
          updateFilterIndicator();
          loadNotes();
          loadSummary();
        });
        elements.tagsCloud.appendChild(tagEl);
      });
    } catch (err) {
      console.error('Не вдалося завантажити статистику:', err);
    }
  }

  // -------------------------------------------------------------
  // Завантаження та відображення списку нотаток
  // -------------------------------------------------------------
  async function loadNotes() {
    const params = new URLSearchParams();
    if (state.currentCategory !== 'ALL') {
      params.append('category', state.currentCategory);
    }
    if (state.currentTag) {
      params.append('tag', state.currentTag);
    }
    if (state.searchQuery) {
      params.append('search', state.searchQuery);
    }

    try {
      const queryStr = params.toString() ? `?${params.toString()}` : '';
      const notes = await apiFetch(`/api/notes${queryStr}`);
      state.notes = notes;
      renderNotesList(notes);
    } catch (err) {
      showToast(`Помилка завантаження нотаток: ${err.message}`, 'error');
    }
  }

  function renderNotesList(notes) {
    elements.notesCardsContainer.innerHTML = '';
    elements.notesCountBadge.textContent = `${notes.length} знайдено`;

    // Заголовок списку
    let title = state.currentCategory === 'ALL' ? 'Всі нотатки' : `Категорія: ${state.currentCategory}`;
    if (state.currentTag) title += ` [ #${state.currentTag} ]`;
    if (state.searchQuery) title += ` [ Пошук: "${state.searchQuery}" ]`;
    elements.currentViewTitle.textContent = title;

    if (notes.length === 0) {
      elements.notesCardsContainer.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">📝</span>
          <p>Нотаток за обраними критеріями не знайдено.</p>
        </div>
      `;
      return;
    }

    notes.forEach(note => {
      const card = document.createElement('div');
      card.className = 'note-card';
      if (state.selectedNote &&
          state.selectedNote.category === note.category &&
          state.selectedNote.filename === note.filename) {
        card.classList.add('active');
      }

      const tagsHtml = (note.tags || []).slice(0, 3).map(t =>
        `<span class="card-tag">#${escapeHtml(t)}</span>`
      ).join('');

      card.innerHTML = `
        <div class="card-top-row">
          <span class="pill pill-${escapeHtml(note.category)}">${escapeHtml(note.category)}</span>
          <span class="pill pill-status">${escapeHtml(note.status || 'in_progress')}</span>
        </div>
        <div class="card-title" title="${escapeHtml(note.title)}">${escapeHtml(note.title)}</div>
        <div class="card-snippet">${escapeHtml(note.snippet || '')}</div>
        <div class="card-bottom-row">
          <span class="card-date">${escapeHtml(note.updated || note.created || '')}</span>
          <div class="card-tags">${tagsHtml}</div>
        </div>
      `;

      card.addEventListener('click', () => {
        openNote(note.category, note.filename);
      });

      elements.notesCardsContainer.appendChild(card);
    });
  }

  // -------------------------------------------------------------
  // Відкриття та перегляд конкретної нотатки
  // -------------------------------------------------------------
  async function openNote(category, filename) {
    try {
      const note = await apiFetch(`/api/notes/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`);
      state.selectedNote = note;

      // Підсвітка активної картки у списку
      document.querySelectorAll('.note-card').forEach(c => c.classList.remove('active'));
      const activeIdx = state.notes.findIndex(n => n.category === category && n.filename === filename);
      if (activeIdx !== -1 && elements.notesCardsContainer.children[activeIdx]) {
        elements.notesCardsContainer.children[activeIdx].classList.add('active');
      }

      // Заповнення переглядача
      elements.viewerPlaceholder.style.display = 'none';
      elements.noteArticle.style.display = 'flex';

      elements.viewCategory.textContent = note.category;
      elements.viewCategory.className = `pill pill-${escapeHtml(note.category)}`;
      elements.viewType.textContent = note.metadata.type || 'lecture';
      elements.viewStatus.textContent = note.metadata.status || 'inbox';
      elements.viewDates.textContent = `Створено: ${note.metadata.created || '-'} • Збережено: ${note.metadata.updated || '-'}`;
      elements.viewTitle.textContent = note.metadata.title;

      // Джерело
      if (note.metadata.source && note.metadata.source.trim()) {
        elements.viewSourceRow.style.display = 'flex';
        elements.viewSource.textContent = note.metadata.source;
      } else {
        elements.viewSourceRow.style.display = 'none';
      }

      // Теги
      elements.viewTagsRow.innerHTML = '';
      if (note.metadata.tags && note.metadata.tags.length > 0) {
        note.metadata.tags.forEach(t => {
          const chip = document.createElement('span');
          chip.className = 'tag-chip';
          chip.textContent = `#${t}`;
          chip.addEventListener('click', () => {
            state.currentTag = t;
            updateFilterIndicator();
            loadNotes();
          });
          elements.viewTagsRow.appendChild(chip);
        });
      }

      // Тіло нотатки з рендерингом Markdown
      elements.viewBody.innerHTML = renderMarkdown(note.content);

      // Обробка кліків по [[Wikilinks]] всередині нотатки
      elements.viewBody.querySelectorAll('.wikilink').forEach(linkEl => {
        linkEl.addEventListener('click', (e) => {
          e.preventDefault();
          const target = linkEl.getAttribute('data-link');
          handleWikilinkClick(target);
        });
      });

      // Рендеринг Backlinks
      renderBacklinks(note.backlinks || []);

    } catch (err) {
      showToast(`Помилка відкриття нотатки: ${err.message}`, 'error');
    }
  }

  // -------------------------------------------------------------
  // Перехід за [[Wikilink]]
  // -------------------------------------------------------------
  async function handleWikilinkClick(targetTitle) {
    const targetClean = targetTitle.toLowerCase().trim();

    // 1. Шукаємо серед вже завантажених або через API
    let found = state.notes.find(n =>
      n.title.toLowerCase().trim() === targetClean ||
      n.filename.replace(/\.md$/, '').toLowerCase().trim() === targetClean
    );

    if (found) {
      openNote(found.category, found.filename);
      return;
    }

    // 2. Якщо у поточному списку не знайдено, робимо пошуковий запит
    try {
      const searchResults = await apiFetch(`/api/notes?search=${encodeURIComponent(targetTitle)}`);
      found = searchResults.find(n =>
        n.title.toLowerCase().trim() === targetClean ||
        n.filename.replace(/\.md$/, '').toLowerCase().trim() === targetClean
      );

      if (found) {
        openNote(found.category, found.filename);
      } else {
        showToast(`Нотатку "[[${targetTitle}]]" не знайдено. Створіть її через "+ Нова нотатка".`, 'info');
      }
    } catch (err) {
      showToast(`Не вдалося знайти нотатку: ${err.message}`, 'error');
    }
  }

  // -------------------------------------------------------------
  // Рендеринг блоку зворотних посилань (Backlinks)
  // -------------------------------------------------------------
  function renderBacklinks(backlinks) {
    elements.backlinksList.innerHTML = '';
    if (!backlinks || backlinks.length === 0) {
      elements.backlinksList.innerHTML = '<li class="empty-backlinks">На цю нотатку поки що ніхто не посилається.</li>';
      return;
    }

    backlinks.forEach(bl => {
      const li = document.createElement('li');
      li.className = 'backlink-item';
      li.innerHTML = `
        <span class="pill pill-${escapeHtml(bl.category)}">${escapeHtml(bl.category)}</span>
        <span class="backlink-title">${escapeHtml(bl.title)}</span>
      `;
      li.addEventListener('click', () => {
        openNote(bl.category, bl.filename);
      });
      elements.backlinksList.appendChild(li);
    });
  }

  // -------------------------------------------------------------
  // Індикатор активного фільтра
  // -------------------------------------------------------------
  function updateFilterIndicator() {
    const filters = [];
    if (state.currentCategory !== 'ALL') filters.push(`Категорія: ${state.currentCategory}`);
    if (state.currentTag) filters.push(`Тег: #${state.currentTag}`);
    if (state.searchQuery) filters.push(`Пошук: "${state.searchQuery}"`);

    if (filters.length > 0) {
      elements.activeFilterBadge.style.display = 'inline-flex';
      elements.filterText.textContent = filters.join(' • ');
    } else {
      elements.activeFilterBadge.style.display = 'none';
    }
  }

  function resetAllFilters() {
    state.currentCategory = 'ALL';
    state.currentTag = null;
    state.searchQuery = '';
    elements.searchInput.value = '';
    elements.searchClear.style.display = 'none';

    elements.navItems.forEach(item => {
      if (item.getAttribute('data-category') === 'ALL') {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });

    updateFilterIndicator();
    loadNotes();
    loadSummary();
  }

  // -------------------------------------------------------------
  // Модальне вікно редактора (Створення / Оновлення)
  // -------------------------------------------------------------
  function openCreateModal() {
    state.editingNote = null;
    elements.modalTitle.textContent = 'Створення нової нотатки';
    elements.noteForm.reset();

    // За замовчуванням встановлюємо обрану категорію (крім ALL)
    elements.formCategory.value = state.currentCategory !== 'ALL' ? state.currentCategory : 'Inbox';
    elements.formType.value = 'lecture';
    elements.formStatus.value = 'in_progress';
    elements.formContent.value = '';

    elements.editorModal.style.display = 'flex';
    elements.formTitle.focus();
  }

  function openEditModal() {
    if (!state.selectedNote) return;

    state.editingNote = {
      category: state.selectedNote.category,
      filename: state.selectedNote.filename
    };

    elements.modalTitle.textContent = 'Редагування нотатки';
    elements.formTitle.value = state.selectedNote.metadata.title || '';
    elements.formCategory.value = state.selectedNote.category || 'Inbox';
    elements.formType.value = state.selectedNote.metadata.type || 'lecture';
    elements.formStatus.value = state.selectedNote.metadata.status || 'in_progress';
    elements.formTags.value = (state.selectedNote.metadata.tags || []).join(', ');
    elements.formSource.value = state.selectedNote.metadata.source || '';
    elements.formContent.value = state.selectedNote.content || '';

    elements.editorModal.style.display = 'flex';
    elements.formTitle.focus();
  }

  function closeEditorModal() {
    elements.editorModal.style.display = 'none';
    state.editingNote = null;
  }

  async function handleFormSubmit(e) {
    e.preventDefault();

    const tagsArray = elements.formTags.value
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean);

    const payload = {
      title: elements.formTitle.value.trim(),
      category: elements.formCategory.value,
      type: elements.formType.value,
      status: elements.formStatus.value,
      tags: tagsArray,
      source: elements.formSource.value.trim(),
      content: elements.formContent.value
    };

    try {
      if (state.editingNote) {
        // Оновлення нотатки
        const updated = await apiFetch(
          `/api/notes/${encodeURIComponent(state.editingNote.category)}/${encodeURIComponent(state.editingNote.filename)}`,
          {
            method: 'PUT',
            body: JSON.stringify(payload)
          }
        );
        showToast('Нотатку успішно збережено', 'success');
        closeEditorModal();
        await loadNotes();
        await loadSummary();
        openNote(updated.category, updated.filename);
      } else {
        // Створення нової нотатки
        const created = await apiFetch('/api/notes', {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        showToast('Нову нотатку створено', 'success');
        closeEditorModal();
        await loadNotes();
        await loadSummary();
        openNote(created.category, created.filename);
      }
    } catch (err) {
      showToast(`Помилка збереження: ${err.message}`, 'error');
    }
  }

  // -------------------------------------------------------------
  // М'яке видалення (Архівація) з підтвердженням
  // -------------------------------------------------------------
  function openArchiveConfirm() {
    if (!state.selectedNote) return;

    state.notePendingArchive = {
      category: state.selectedNote.category,
      filename: state.selectedNote.filename,
      title: state.selectedNote.metadata.title
    };

    elements.confirmMessage.innerHTML = `Ви дійсно бажаєте перемістити нотатку <strong>"${escapeHtml(state.notePendingArchive.title)}"</strong> в <strong>notes/Archives</strong>?`;
    elements.confirmModal.style.display = 'flex';
  }

  function closeConfirmModal() {
    elements.confirmModal.style.display = 'none';
    state.notePendingArchive = null;
  }

  async function proceedArchive() {
    if (!state.notePendingArchive) return;

    const { category, filename } = state.notePendingArchive;

    try {
      const res = await apiFetch(`/api/notes/${encodeURIComponent(category)}/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
      });

      showToast(res.message || 'Нотатку переміщено в архів', 'success');
      closeConfirmModal();

      state.selectedNote = null;
      elements.noteArticle.style.display = 'none';
      elements.viewerPlaceholder.style.display = 'flex';

      await loadNotes();
      await loadSummary();
    } catch (err) {
      showToast(`Помилка архівації: ${err.message}`, 'error');
    }
  }

  // -------------------------------------------------------------
  // Ініціалізація подій та слухачів
  // -------------------------------------------------------------
  function initEventListeners() {
    // Навігація по категоріях PARA
    elements.navItems.forEach(item => {
      item.addEventListener('click', () => {
        elements.navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        state.currentCategory = item.getAttribute('data-category');
        updateFilterIndicator();
        loadNotes();
      });
    });

    // Пошук
    let searchDebounce = null;
    elements.searchInput.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      elements.searchClear.style.display = val ? 'block' : 'none';

      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(() => {
        state.searchQuery = val;
        updateFilterIndicator();
        loadNotes();
      }, 250);
    });

    elements.searchClear.addEventListener('click', () => {
      elements.searchInput.value = '';
      elements.searchClear.style.display = 'none';
      state.searchQuery = '';
      updateFilterIndicator();
      loadNotes();
    });

    // Скидання фільтра
    elements.filterResetBtn.addEventListener('click', resetAllFilters);

    // Модальне вікно редактора
    elements.btnCreateNote.addEventListener('click', openCreateModal);
    elements.btnModalClose.addEventListener('click', closeEditorModal);
    elements.btnFormCancel.addEventListener('click', closeEditorModal);
    elements.noteForm.addEventListener('submit', handleFormSubmit);

    // Дії в статті
    elements.btnEditNote.addEventListener('click', openEditModal);
    elements.btnArchiveNote.addEventListener('click', openArchiveConfirm);

    // Модальне вікно підтвердження
    elements.btnConfirmClose.addEventListener('click', closeConfirmModal);
    elements.btnConfirmCancel.addEventListener('click', closeConfirmModal);
    elements.btnConfirmProceed.addEventListener('click', proceedArchive);

    // Закриття модалок по кліку на фон або Escape
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeEditorModal();
        closeConfirmModal();
      }
    });

    [elements.editorModal, elements.confirmModal].forEach(modal => {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
        }
      });
    });
  }

  // Початковий запуск
  document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadSummary();
    loadNotes();
  });
})();
