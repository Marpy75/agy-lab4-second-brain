/**
 * Second Brain — Навчальні нотатки
 * Клієнтська логіка: валідація, збереження в LocalStorage,
 * динамічне відображення, фільтрація та пошук.
 */

const STORAGE_KEY = 'second_brain_study_notes';

// Початкові демонстраційні нотатки для наочності
const DEFAULT_NOTES = [
  {
    id: 'demo-1',
    title: 'Конвеєризація команд (Pipelining)',
    subject: 'АСКС',
    tags: ['архітектура', 'конвеєр', 'продуктивність'],
    content: 'Конвеєр розбиває виконання команди на кілька послідовних стадій (IF, ID, EX, MEM, WB). Дозволяє виконувати кілька інструкцій одночасно на різних етапах, що суттєво підвищує пропускну здатність процесора.',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString()
  },
  {
    id: 'demo-2',
    title: 'Класифікація архітектур за Флінном',
    subject: 'АСКС',
    tags: ['Флінн', 'SIMD', 'MIMD'],
    content: 'Чотири основні класи:\n1. SISD — класична фон Нейманівська машина.\n2. SIMD — один потік команд, багато потоків даних (векторні процесори, GPU).\n3. MISD — масив конвеєрних обчислень.\n4. MIMD — сучасні багатоядерні та кластерні системи.',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString()
  }
];

// Елементи DOM
const noteForm = document.getElementById('noteForm');
const noteTitle = document.getElementById('noteTitle');
const noteSubject = document.getElementById('noteSubject');
const noteTags = document.getElementById('noteTags');
const noteContent = document.getElementById('noteContent');
const resetBtn = document.getElementById('resetBtn');
const feedbackAlert = document.getElementById('feedbackAlert');

const notesGrid = document.getElementById('notesGrid');
const emptyState = document.getElementById('emptyState');
const notesCount = document.getElementById('notesCount');
const filteredCount = document.getElementById('filteredCount');
const searchInput = document.getElementById('searchInput');
const subjectFilter = document.getElementById('subjectFilter');

// Стан додатку
let notes = [];

/**
 * Ініціалізація додатку
 */
function init() {
  loadNotes();
  setupEventListeners();
  renderNotes();
  updateSubjectFilterOptions();
}

/**
 * Завантаження нотаток з LocalStorage
 */
function loadNotes() {
  try {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (rawData) {
      notes = JSON.parse(rawData);
    } else {
      // Якщо сховище порожнє, записуємо стартові нотатки
      notes = [...DEFAULT_NOTES];
      saveNotesToStorage();
    }
  } catch (error) {
    console.error('Помилка читання LocalStorage:', error);
    notes = [...DEFAULT_NOTES];
  }
}

/**
 * Збереження нотаток у LocalStorage
 */
function saveNotesToStorage() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  } catch (error) {
    console.error('Помилка запису в LocalStorage:', error);
    showFeedback('Не вдалося зберегти в локальне сховище браузера', false);
  }
}

/**
 * Налаштування слухачів подій
 */
function setupEventListeners() {
  noteForm.addEventListener('submit', handleFormSubmit);
  resetBtn.addEventListener('click', handleResetForm);
  
  searchInput.addEventListener('input', handleFilterChange);
  subjectFilter.addEventListener('change', handleFilterChange);

  // Валідація при введенні (очищення помилок)
  [noteTitle, noteSubject, noteContent].forEach(input => {
    input.addEventListener('input', () => {
      const parent = input.closest('.form-group');
      if (parent && parent.classList.contains('has-error')) {
        parent.classList.remove('has-error');
      }
    });
  });
}

/**
 * Обробка відправки форми
 */
function handleFormSubmit(e) {
  e.preventDefault();

  const titleVal = noteTitle.value.trim();
  const subjectVal = noteSubject.value.trim();
  const contentVal = noteContent.value.trim();
  const rawTagsVal = noteTags.value.trim();

  // Валідація
  let isValid = true;

  if (!titleVal) {
    setError(noteTitle, true);
    isValid = false;
  } else {
    setError(noteTitle, false);
  }

  if (!subjectVal) {
    setError(noteSubject, true);
    isValid = false;
  } else {
    setError(noteSubject, false);
  }

  if (!contentVal) {
    setError(noteContent, true);
  } else {
    setError(noteContent, false);
  }

  if (!isValid || !contentVal) {
    return;
  }

  // Обробка тегів
  const tags = rawTagsVal
    ? rawTagsVal
        .split(',')
        .map(t => t.trim())
        .filter(t => t.length > 0)
    : [];

  // Створення об'єкта нотатки
  const newNote = {
    id: 'note_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    title: titleVal,
    subject: subjectVal,
    tags: tags,
    content: contentVal,
    createdAt: new Date().toISOString()
  };

  // Додавання на початок списку
  notes.unshift(newNote);
  saveNotesToStorage();

  // Очищення форми та зворотний зв'язок
  noteForm.reset();
  clearAllErrors();
  showFeedback('Нотатку успішно додано!');

  // Оновлення інтерфейсу
  updateSubjectFilterOptions();
  renderNotes();
}

/**
 * Скидання форми
 */
function handleResetForm() {
  noteForm.reset();
  clearAllErrors();
}

/**
 * Встановлення стану помилки для поля
 */
function setError(inputElement, hasError) {
  const formGroup = inputElement.closest('.form-group');
  if (!formGroup) return;

  if (hasError) {
    formGroup.classList.add('has-error');
  } else {
    formGroup.classList.remove('has-error');
  }
}

/**
 * Очищення всіх помилок
 */
function clearAllErrors() {
  const errorGroups = noteForm.querySelectorAll('.has-error');
  errorGroups.forEach(group => group.classList.remove('has-error'));
}

/**
 * Відображення повідомлення зворотного зв'язку
 */
let feedbackTimer = null;
function showFeedback(message) {
  feedbackAlert.textContent = `✓ ${message}`;
  feedbackAlert.className = 'feedback-alert show-success';

  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => {
    feedbackAlert.className = 'feedback-alert';
  }, 3500);
}

/**
 * Видалення нотатки за ID
 */
function deleteNote(id) {
  const targetNote = notes.find(n => n.id === id);
  const title = targetNote ? `"${targetNote.title}"` : 'цю нотатку';

  if (confirm(`Ви дійсно бажаєте видалити ${title}?`)) {
    notes = notes.filter(n => n.id !== id);
    saveNotesToStorage();
    updateSubjectFilterOptions();
    renderNotes();
  }
}

/**
 * Фільтрація та рендеринг списку нотаток
 */
function renderNotes() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedSubject = subjectFilter.value;

  const filteredNotes = notes.filter(note => {
    // Фільтр за предметом
    if (selectedSubject !== 'all' && note.subject !== selectedSubject) {
      return false;
    }

    // Пошук за текстом
    if (query) {
      const inTitle = note.title.toLowerCase().includes(query);
      const inContent = note.content.toLowerCase().includes(query);
      const inSubject = note.subject.toLowerCase().includes(query);
      const inTags = note.tags.some(tag => tag.toLowerCase().includes(query));
      return inTitle || inContent || inSubject || inTags;
    }

    return true;
  });

  // Оновлення лічильників
  notesCount.textContent = notes.length;
  filteredCount.textContent = `Показано: ${filteredNotes.length}`;

  // Очищення контейнера
  notesGrid.innerHTML = '';

  if (filteredNotes.length === 0) {
    emptyState.style.display = 'block';
  } else {
    emptyState.style.display = 'none';

    filteredNotes.forEach(note => {
      const card = document.createElement('article');
      card.className = 'note-card';

      // Форматування дати
      const dateStr = formatDate(note.createdAt);

      // Теги
      const tagsHtml = note.tags.length > 0
        ? `<div class="note-card-tags">
            ${note.tags.map(t => `<span class="tag-badge">#${escapeHtml(t)}</span>`).join('')}
           </div>`
        : '';

      card.innerHTML = `
        <div class="note-card-header">
          <span class="note-subject-badge">${escapeHtml(note.subject)}</span>
          <button class="btn-delete" title="Видалити нотатку" data-id="${note.id}" aria-label="Видалити">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
        <h4 class="note-card-title">${escapeHtml(note.title)}</h4>
        <div class="note-card-date">${dateStr}</div>
        <div class="note-card-content">${escapeHtml(note.content)}</div>
        ${tagsHtml}
      `;

      // Прив'язка кнопки видалення
      const delBtn = card.querySelector('.btn-delete');
      delBtn.addEventListener('click', () => deleteNote(note.id));

      notesGrid.appendChild(card);
    });
  }
}

/**
 * Оновлення випадаючого списку предметів для фільтра
 */
function updateSubjectFilterOptions() {
  const currentSelection = subjectFilter.value;
  const subjects = Array.from(new Set(notes.map(n => n.subject).filter(Boolean))).sort();

  // Зберігаємо першу опцію "Усі предмети"
  subjectFilter.innerHTML = '<option value="all">Усі предмети</option>';

  subjects.forEach(subj => {
    const option = document.createElement('option');
    option.value = subj;
    option.textContent = subj;
    if (subj === currentSelection) {
      option.selected = true;
    }
    subjectFilter.appendChild(option);
  });
}

/**
 * Обробка зміни фільтрів
 */
function handleFilterChange() {
  renderNotes();
}

/**
 * Форматування дати у зручний вигляд
 */
function formatDate(isoString) {
  try {
    const date = new Date(isoString);
    return date.toLocaleDateString('uk-UA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return isoString;
  }
}

/**
 * Безпечне екранування тексту для запобігання XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Запуск
document.addEventListener('DOMContentLoaded', init);
