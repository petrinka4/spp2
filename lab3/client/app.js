(() => {
  const TASKS_API = '/api/tasks';
  const AUTH_API = '/api/auth';
  const USERS_API = '/api/users';

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
    listLabel: document.getElementById('list-label'),
    count: document.getElementById('tasks-count'),
    notice: document.getElementById('alert'),
    authView: document.getElementById('auth-view'),
    appView: document.getElementById('app-view'),
    authTabs: document.querySelectorAll('.auth-tab'),
    authForms: document.querySelectorAll('[data-auth-form]'),
    loginForm: document.getElementById('login-form'),
    registerForm: document.getElementById('register-form'),
    forgotForm: document.getElementById('forgot-form'),
    resetForm: document.getElementById('reset-form'),
    userBox: document.getElementById('user-box'),
    userName: document.getElementById('user-name'),
    userRole: document.getElementById('user-role'),
    logoutButton: document.getElementById('logout-btn'),
    sessionsButton: document.getElementById('sessions-btn'),
    sessionsPanel: document.getElementById('sessions-panel'),
    sessionsList: document.getElementById('sessions-list'),
    revokeOthersButton: document.getElementById('revoke-others-btn'),
    usersPanel: document.getElementById('users-panel'),
    usersList: document.getElementById('users-list'),
  };

  const STATUS_TEXT = {
    todo: 'Запланировано',
    in_progress: 'В процессе',
    done: 'Завершено',
  };

  const ROLE_TEXT = {
    user: 'Пользователь',
    manager: 'Менеджер',
    admin: 'Администратор',
  };

  let selectedTaskId = null;
  let accessToken = null;
  let currentUser = null;
  let refreshing = null;
  let resetToken = null;

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

  const formatRetryAfter = (response) => {
    const seconds = Number(response.headers.get('retry-after'));
    if (!seconds) return '';
    if (seconds < 60) return ` Повторите через ${seconds} с.`;
    return ` Повторите через ${Math.ceil(seconds / 60)} мин.`;
  };

  const readApiError = async (response) => {
    const fallbackMessages = {
      400: 'Некорректный запрос',
      401: 'Требуется вход в систему',
      403: 'Недостаточно прав для этого действия',
      404: 'Запрошенный ресурс не найден',
      405: 'Метод не поддерживается',
      409: 'Конфликт данных',
      413: 'Файл слишком большой. Максимальный размер — 5 МБ',
      415: 'Этот тип файла не поддерживается',
      422: 'Проверьте правильность заполнения формы',
      429: 'Слишком много попыток.',
      500: 'На сервере произошла внутренняя ошибка',
      502: 'Сервер приложения временно недоступен',
      503: 'Сервис временно недоступен',
    };

    const fallback =
      fallbackMessages[response.status] || `Ошибка запроса (${response.status})`;

    if (response.status === 429) {
      return fallback + formatRetryAfter(response);
    }

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

  const refreshSession = () => {
    if (!refreshing) {
      refreshing = fetch(`${AUTH_API}/refresh`, { method: 'POST', credentials: 'same-origin' })
        .then(async (response) => {
          if (!response.ok) return false;
          const data = await response.json();
          accessToken = data.accessToken;
          currentUser = data.user;
          return true;
        })
        .catch(() => false)
        .finally(() => {
          refreshing = null;
        });
    }
    return refreshing;
  };

  const api = async (url, options = {}, retry = true) => {
    const headers = new Headers(options.headers || {});
    if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

    const response = await fetch(url, { ...options, headers, credentials: 'same-origin' });

    if (response.status === 401 && retry) {
      if (await refreshSession()) {
        return api(url, options, false);
      }
      showAuth();
      throw new Error('Сессия истекла, войдите снова');
    }

    return response;
  };

  const sendJson = (url, method, data) =>
    fetch(url, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

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

  const formatDateTime = (value) =>
    new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));

  const canSeeAll = () => currentUser && currentUser.role !== 'user';

  const ownerId = (task) => task.owner?._id || task.owner;

  const canDelete = (task) =>
    currentUser.role === 'admin' || ownerId(task) === currentUser._id;

  const switchAuthTab = (name) => {
    ui.authTabs.forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.authTab === name);
    });
    ui.authForms.forEach((form) => {
      form.classList.toggle('hidden', form.dataset.authForm !== name);
    });
  };

  const showAuth = (tab = 'login') => {
    accessToken = null;
    currentUser = null;
    ui.appView.classList.add('hidden');
    ui.userBox.classList.add('hidden');
    ui.authView.classList.remove('hidden');
    switchAuthTab(tab);
  };

  const showApp = () => {
    ui.authView.classList.add('hidden');
    ui.appView.classList.remove('hidden');
    ui.userBox.classList.remove('hidden');
    ui.userName.textContent = currentUser.name;
    ui.userRole.textContent = ROLE_TEXT[currentUser.role] || currentUser.role;
    ui.userRole.dataset.role = currentUser.role;
    ui.listLabel.textContent = canSeeAll() ? 'Все задачи' : 'Мои задачи';
    ui.sessionsPanel.classList.add('hidden');
    ui.usersPanel.classList.toggle('hidden', currentUser.role !== 'admin');

    resetEditor();
    fetchTasks();
    if (currentUser.role === 'admin') fetchUsers();
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
          ? `<button type="button" class="attachment-link" data-command="file">${escapeMarkup(
              task.attachment.originalName
            )}</button>`
          : '<span>Без вложения</span>';
        const owner =
          canSeeAll() && task.owner?.name
            ? `<span class="owner-badge">${escapeMarkup(task.owner.name)}</span>`
            : '';
        const deleteButton = canDelete(task)
          ? `<button
                  type="button"
                  class="task-action task-action-danger"
                  data-command="delete"
                >
                  Удалить
                </button>`
          : '';

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
                ${deleteButton}
              </div>
            </div>

            <div class="task-card__footer">
              <div class="task-meta">
                <span class="status-badge">${safeStatus}</span>
                ${owner}
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
      const response = await api(TASKS_API);
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

  const downloadAttachment = async (taskId, fileName) => {
    const response = await api(`${TASKS_API}/${taskId}/attachment`);
    if (!response.ok) throw new Error(await readApiError(response));

    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName || 'attachment';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const renderSessions = (sessions) => {
    if (sessions.length === 0) {
      ui.sessionsList.innerHTML = '<div class="empty-state">Активных сессий нет</div>';
      return;
    }

    ui.sessionsList.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Устройство</th><th>IP</th><th>Активность</th><th></th></tr>
        </thead>
        <tbody>
          ${sessions
            .map(
              (s) => `
            <tr data-session-id="${s._id}">
              <td class="ua-cell">${escapeMarkup(s.userAgent || 'Неизвестно')}</td>
              <td>${escapeMarkup(s.ip || '—')}</td>
              <td>${formatDateTime(s.lastUsedAt)}</td>
              <td>${
                s.current
                  ? '<span class="status-badge">Текущая</span>'
                  : '<button type="button" class="task-action task-action-danger" data-command="revoke">Завершить</button>'
              }</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  };

  const fetchSessions = async () => {
    try {
      const response = await api(`${AUTH_API}/sessions`);
      if (!response.ok) throw new Error(await readApiError(response));
      renderSessions(await response.json());
    } catch (error) {
      showNotice(error.message || 'Не удалось получить список сессий');
    }
  };

  const renderUsers = (users) => {
    ui.usersList.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>Имя</th><th>Email</th><th>Роль</th><th>Сессии</th><th>Статус</th><th></th></tr>
        </thead>
        <tbody>
          ${users
            .map((u) => {
              const isSelf = u._id === currentUser._id;
              const options = Object.entries(ROLE_TEXT)
                .map(
                  ([value, text]) =>
                    `<option value="${value}"${value === u.role ? ' selected' : ''}>${text}</option>`
                )
                .join('');

              return `
            <tr data-user-id="${u._id}">
              <td>${escapeMarkup(u.name)}</td>
              <td>${escapeMarkup(u.email)}</td>
              <td>
                <select class="role-select" data-command="role"${isSelf ? ' disabled' : ''}>
                  ${options}
                </select>
              </td>
              <td>${u.activeSessions}</td>
              <td>${u.isActive ? 'Активен' : '<span class="muted-danger">Заблокирован</span>'}</td>
              <td>
                <div class="row-actions">
                ${
                  isSelf
                    ? ''
                    : `<button type="button" class="task-action" data-command="toggle">${
                        u.isActive ? 'Заблокировать' : 'Разблокировать'
                      }</button>
                <button type="button" class="task-action task-action-danger" data-command="kick">Сбросить сессии</button>`
                }
                </div>
              </td>
            </tr>`;
            })
            .join('')}
        </tbody>
      </table>
    `;
  };

  const fetchUsers = async () => {
    try {
      const response = await api(USERS_API);
      if (!response.ok) throw new Error(await readApiError(response));
      renderUsers(await response.json());
    } catch (error) {
      showNotice(error.message || 'Не удалось получить список пользователей');
    }
  };

  const updateUser = async (userId, changes) => {
    const response = await api(`${USERS_API}/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(changes),
    });
    if (!response.ok) throw new Error(await readApiError(response));
  };

  const readForm = (form) => Object.fromEntries(new FormData(form).entries());

  const withBusyButton = async (form, action) => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await action();
    } finally {
      button.disabled = false;
    }
  };

  const handleAuthSuccess = async (response) => {
    const data = await response.json();
    accessToken = data.accessToken;
    currentUser = data.user;
    showApp();
  };

  ui.authTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      clearNotice();
      switchAuthTab(tab.dataset.authTab);
    });
  });

  document.querySelectorAll('.link-button[data-auth-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      clearNotice();
      switchAuthTab(button.dataset.authTab);
    });
  });

  ui.loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearNotice();

    withBusyButton(ui.loginForm, async () => {
      try {
        const response = await sendJson(`${AUTH_API}/login`, 'POST', readForm(ui.loginForm));
        if (!response.ok) throw new Error(await readApiError(response));
        ui.loginForm.reset();
        await handleAuthSuccess(response);
      } catch (error) {
        showNotice(error.message || 'Не удалось войти');
      }
    });
  });

  ui.registerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearNotice();

    withBusyButton(ui.registerForm, async () => {
      try {
        const response = await sendJson(`${AUTH_API}/register`, 'POST', readForm(ui.registerForm));
        if (!response.ok) throw new Error(await readApiError(response));
        ui.registerForm.reset();
        await handleAuthSuccess(response);
        showNotice('Аккаунт создан', 'success');
      } catch (error) {
        showNotice(error.message || 'Не удалось зарегистрироваться');
      }
    });
  });

  ui.forgotForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearNotice();

    withBusyButton(ui.forgotForm, async () => {
      try {
        const response = await sendJson(
          `${AUTH_API}/forgot-password`,
          'POST',
          readForm(ui.forgotForm)
        );
        if (!response.ok) throw new Error(await readApiError(response));
        ui.forgotForm.reset();
        showNotice('Если такой аккаунт есть, письмо со ссылкой уже отправлено', 'success');
      } catch (error) {
        showNotice(error.message || 'Не удалось отправить письмо');
      }
    });
  });

  ui.resetForm.addEventListener('submit', (event) => {
    event.preventDefault();
    clearNotice();

    withBusyButton(ui.resetForm, async () => {
      try {
        const response = await sendJson(`${AUTH_API}/reset-password`, 'POST', {
          token: resetToken,
          password: readForm(ui.resetForm).password,
        });
        if (!response.ok) throw new Error(await readApiError(response));

        ui.resetForm.reset();
        resetToken = null;
        history.replaceState(null, '', window.location.pathname);
        switchAuthTab('login');
        showNotice('Пароль изменён, теперь можно войти', 'success');
      } catch (error) {
        showNotice(error.message || 'Не удалось сменить пароль');
      }
    });
  });

  ui.logoutButton.addEventListener('click', async () => {
    try {
      await fetch(`${AUTH_API}/logout`, { method: 'POST', credentials: 'same-origin' });
    } finally {
      showAuth();
      clearNotice();
    }
  });

  ui.sessionsButton.addEventListener('click', () => {
    const willShow = ui.sessionsPanel.classList.contains('hidden');
    ui.sessionsPanel.classList.toggle('hidden', !willShow);
    if (willShow) fetchSessions();
  });

  ui.revokeOthersButton.addEventListener('click', async () => {
    try {
      const response = await api(`${AUTH_API}/sessions`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readApiError(response));
      await fetchSessions();
      showNotice('Остальные сессии завершены', 'success');
    } catch (error) {
      showNotice(error.message || 'Не удалось завершить сессии');
    }
  });

  ui.sessionsList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-command="revoke"]');
    if (!button) return;

    const sessionId = button.closest('tr')?.dataset.sessionId;
    button.disabled = true;

    try {
      const response = await api(`${AUTH_API}/sessions/${sessionId}`, { method: 'DELETE' });
      if (!response.ok) throw new Error(await readApiError(response));
      await fetchSessions();
    } catch (error) {
      showNotice(error.message || 'Не удалось завершить сессию');
      button.disabled = false;
    }
  });

  ui.usersList.addEventListener('change', async (event) => {
    const select = event.target.closest('select[data-command="role"]');
    if (!select) return;

    try {
      await updateUser(select.closest('tr').dataset.userId, { role: select.value });
      showNotice('Роль изменена', 'success');
      await fetchUsers();
    } catch (error) {
      showNotice(error.message || 'Не удалось изменить роль');
      await fetchUsers();
    }
  });

  ui.usersList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-command]');
    if (!button) return;

    const userId = button.closest('tr').dataset.userId;
    button.disabled = true;

    try {
      if (button.dataset.command === 'toggle') {
        const block = button.textContent.trim() === 'Заблокировать';
        await updateUser(userId, { isActive: !block });
        showNotice(block ? 'Пользователь заблокирован' : 'Пользователь разблокирован', 'success');
      }

      if (button.dataset.command === 'kick') {
        const response = await api(`${USERS_API}/${userId}/sessions`, { method: 'DELETE' });
        if (!response.ok) throw new Error(await readApiError(response));
        showNotice('Сессии пользователя завершены', 'success');
      }

      await fetchUsers();
    } catch (error) {
      showNotice(error.message || 'Не удалось выполнить действие');
      button.disabled = false;
    }
  });

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
      const response = await api(endpoint, {
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

    if (actionButton.dataset.command === 'file') {
      try {
        await downloadAttachment(taskId, actionButton.textContent.trim());
      } catch (error) {
        showNotice(error.message || 'Не удалось скачать файл');
      }
      return;
    }

    if (actionButton.dataset.command === 'edit') {
      try {
        const response = await api(`${TASKS_API}/${taskId}`);
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
        const response = await api(`${TASKS_API}/${taskId}`, {
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

  const start = async () => {
    const hash = window.location.hash;
    if (hash.startsWith('#reset')) {
      resetToken = new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('token');
      if (resetToken) {
        showAuth('reset');
        return;
      }
    }

    if (await refreshSession()) {
      showApp();
    } else {
      showAuth();
    }
  };

  start();
})();
