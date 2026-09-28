(() => {
  const TASKS_API = '/api/tasks';

  const ui = {
    editor: document.getElementById('task-form'),
    editorTitle: document.getElementById('form-title'),
    title: document.getElementById('title'),
    description: document.getElementById('description'),
    status: document.getElementById('status'),
    attachment: document.getElementById('attachment'),
    currentFile: document.getElementById('current-file'),
    saveButton: document.getElementById('submit-btn'),
    cancelButton: document.getElementById('cancel-btn'),
    list: document.getElementById('tasks'),
    count: document.getElementById('tasks-count'),
    notice: document.getElementById('alert'),
  };

  const STATUS_TEXT = {
    todo: 'Запланировано',
    in_progress: 'В процессе',
    done: 'Завершено',
  };

  let selectedTaskId = null;

  const showNotice = (message, kind = 'error') => {
    ui.notice.textContent = message;
    ui.notice.className = `notice notice-${kind}`;
    ui.notice.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    ui.notice.setAttribute('aria-live', kind === 'error' ? 'assertive' : 'polite');
  };

  const clearNotice = () => {
    ui.notice.textContent = '';
    ui.notice.className = 'notice hidden';
    ui.notice.setAttribute('role', 'status');
    ui.notice.setAttribute('aria-live', 'polite');
  };

  const readApiError = async (response) => {
    const fallbackMessages = {
      400: 'Проверьте правильность заполнения формы',
      404: 'Запрошенная задача не найдена',
      413: 'Файл слишком большой. Максимальный размер — 5 МБ',
      415: 'Этот тип файла не поддерживается',
      500: 'На сервере произошла внутренняя ошибка',
      502: 'Сервер приложения временно недоступен',
      503: 'Сервис временно недоступен',
    };

    const fallback =
      fallbackMessages[response.status] || `Ошибка запроса (${response.status})`;

    try {
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) return fallback;

      const payload = await response.json();
      if (Array.isArray(payload.details) && payload.details.length > 0) {
        return payload.details.join('; ');
      }

      return payload.error || payload.message || fallback;
    } catch {
      return fallback;
    }
  };

  const escapeMarkup = (value) =>
    String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const formatTaskCount = (count) => {
    const lastTwo = count % 100;
    const lastOne = count % 10;

    if (lastTwo >= 11 && lastTwo <= 14) return `${count} задач`;
    if (lastOne === 1) return `${count} задача`;
    if (lastOne >= 2 && lastOne <= 4) return `${count} задачи`;
    return `${count} задач`;
  };

  const formatDate = (value) => {
    if (!value) return '';

    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(value));
  };

  const resetEditor = () => {
    selectedTaskId = null;
    ui.editor.reset();
    ui.status.value = 'todo';
    ui.editorTitle.textContent = 'Добавить задачу';
    ui.saveButton.textContent = 'Добавить';
    ui.cancelButton.classList.add('hidden');
    ui.currentFile.classList.add('hidden');
    ui.currentFile.textContent = '';
    ui.attachment.value = '';
  };

  const startEditing = (task) => {
    selectedTaskId = task._id;
    ui.title.value = task.title || '';
    ui.description.value = task.description || '';
    ui.status.value = task.status || 'todo';
    ui.editorTitle.textContent = 'Изменить задачу';
    ui.saveButton.textContent = 'Сохранить';
    ui.cancelButton.classList.remove('hidden');

    if (task.attachment?.originalName) {
      ui.currentFile.textContent = `Прикреплён файл: ${task.attachment.originalName}`;
      ui.currentFile.classList.remove('hidden');
    } else {
      ui.currentFile.textContent = '';
      ui.currentFile.classList.add('hidden');
    }

    ui.attachment.value = '';
    ui.title.focus();
  };

  const renderTaskList = (tasks) => {
    ui.count.textContent = formatTaskCount(tasks.length);

    if (tasks.length === 0) {
      ui.list.innerHTML =
        '<div class="empty-state">Список пока пуст. Добавьте первую задачу через форму.</div>';
      return;
    }

    ui.list.innerHTML = tasks
      .map((task) => {
        const safeStatus = escapeMarkup(STATUS_TEXT[task.status] || task.status);
        const createdDate = formatDate(task.createdAt);
        const fileLink = task.attachment?.storedName
          ? `<a class="attachment-link" href="/uploads/${encodeURIComponent(
              task.attachment.storedName
            )}" target="_blank" rel="noopener">${escapeMarkup(
              task.attachment.originalName
            )}</a>`
          : '<span>Без вложения</span>';

        return `
          <article class="task-card" data-task-id="${task._id}">
            <div class="task-card__header">
              <div class="task-card__content">
                <h3>${escapeMarkup(task.title)}</h3>
                <p class="task-card__description">${escapeMarkup(
                  task.description || 'Описание не добавлено'
                )}</p>
              </div>

              <div class="task-actions">
                <button type="button" class="task-action" data-command="edit">
                  Править
                </button>
                <button
                  type="button"
                  class="task-action task-action-danger"
                  data-command="delete"
                >
                  Удалить
                </button>
              </div>
            </div>

            <div class="task-card__footer">
              <div class="task-meta">
                <span class="status-badge">${safeStatus}</span>
                ${fileLink}
              </div>
              <span>${createdDate ? `Создано ${createdDate}` : ''}</span>
            </div>
          </article>
        `;
      })
      .join('');
  };

  const fetchTasks = async ({ keepNotice = false } = {}) => {
    try {
      const response = await fetch(TASKS_API);
      if (!response.ok) throw new Error(await readApiError(response));

      renderTaskList(await response.json());
      if (!keepNotice) clearNotice();
    } catch (error) {
      showNotice(error.message || 'Не удалось получить список задач');
      ui.list.innerHTML =
        '<div class="empty-state">Список не загружен. Проверьте соединение с сервером.</div>';
      ui.count.textContent = '—';
    }
  };

  ui.editor.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearNotice();

    const cleanTitle = ui.title.value.trim();
    if (cleanTitle.length < 2) {
      showNotice('Введите название длиной не менее двух символов');
      ui.title.focus();
      return;
    }

    const requestBody = new FormData();
    requestBody.append('title', cleanTitle);
    requestBody.append('description', ui.description.value.trim());
    requestBody.append('status', ui.status.value);

    if (ui.attachment.files[0]) {
      requestBody.append('attachment', ui.attachment.files[0]);
    }

    const isUpdating = Boolean(selectedTaskId);
    const endpoint = isUpdating
      ? `${TASKS_API}/${selectedTaskId}`
      : TASKS_API;
    const httpMethod = isUpdating ? 'PUT' : 'POST';
    const defaultButtonText = isUpdating ? 'Сохранить' : 'Добавить';

    ui.saveButton.disabled = true;
    ui.saveButton.textContent = 'Отправка…';

    try {
      const response = await fetch(endpoint, {
        method: httpMethod,
        body: requestBody,
      });

      if (!response.ok) throw new Error(await readApiError(response));

      resetEditor();
      await fetchTasks({ keepNotice: true });
      showNotice(
        isUpdating ? 'Изменения сохранены' : 'Задача добавлена',
        'success'
      );
    } catch (error) {
      showNotice(error.message || 'Не удалось сохранить задачу');
    } finally {
      ui.saveButton.disabled = false;
      if (selectedTaskId) {
        ui.saveButton.textContent = 'Сохранить';
      } else {
        ui.saveButton.textContent = defaultButtonText;
      }
    }
  });

  ui.cancelButton.addEventListener('click', () => {
    resetEditor();
    clearNotice();
  });

  ui.list.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('button[data-command]');
    if (!actionButton) return;

    const taskCard = actionButton.closest('.task-card');
    const taskId = taskCard?.dataset.taskId;
    if (!taskId) return;

    if (actionButton.dataset.command === 'edit') {
      try {
        const response = await fetch(`${TASKS_API}/${taskId}`);
        if (!response.ok) throw new Error(await readApiError(response));

        startEditing(await response.json());
        clearNotice();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (error) {
        showNotice(error.message || 'Не удалось открыть задачу');
      }
      return;
    }

    if (actionButton.dataset.command === 'delete') {
      if (!window.confirm('Удалить выбранную задачу?')) return;

      actionButton.disabled = true;

      try {
        const response = await fetch(`${TASKS_API}/${taskId}`, {
          method: 'DELETE',
        });

        if (!response.ok) throw new Error(await readApiError(response));

        if (selectedTaskId === taskId) resetEditor();
        await fetchTasks({ keepNotice: true });
        showNotice('Задача удалена', 'success');
      } catch (error) {
        showNotice(error.message || 'Не удалось удалить задачу');
        actionButton.disabled = false;
      }
    }
  });

  fetchTasks();
})();