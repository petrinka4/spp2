const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: generateId } = require('uuid');

const app = express();

const SERVER_PORT = process.env.PORT || 3000;

const DATA_DIRECTORY = path.join(__dirname, 'data');
const UPLOADS_DIRECTORY = path.join(__dirname, 'uploads');
const TASKS_JSON_PATH = path.join(DATA_DIRECTORY, 'tasks.json');

const TASK_STATUSES = ['pending', 'in_progress', 'done'];

const TASK_STATUS_LABELS = {
  pending: 'Ожидает',
  in_progress: 'В работе',
  done: 'Выполнена',
};

function ensureDirectoryExists(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

ensureDirectoryExists(DATA_DIRECTORY);
ensureDirectoryExists(UPLOADS_DIRECTORY);

const uploadStorage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, UPLOADS_DIRECTORY);
  },

  filename: (_request, file, callback) => {
    const cleanedFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const uniqueFileName = `${Date.now()}-${cleanedFileName}`;

    callback(null, uniqueFileName);
  },
});

const uploadFile = multer({
  storage: uploadStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'view')); 

app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIRECTORY));

function getTasks() {
  try {
    const fileContent = fs.readFileSync(TASKS_JSON_PATH, 'utf-8');
    return JSON.parse(fileContent);
  } catch {
    return [];
  }
}

function saveTasks(tasks) {
  fs.writeFileSync(
    TASKS_JSON_PATH,
    JSON.stringify(tasks, null, 2),
    'utf-8',
  );
}

function getTaskById(tasks, taskId) {
  return tasks.find((task) => task.id === taskId);
}

function formatTaskDate(dateValue) {
  if (!dateValue) {
    return '—';
  }

  return new Date(dateValue).toLocaleDateString('ru-RU');
}

function redirectWithMessage(response, message) {
  const encodedMessage = encodeURIComponent(message);

  response.redirect(`/?message=${encodedMessage}`);
}

function removeTaskFiles(task) {
  for (const attachment of task.attachments) {
    const attachmentPath = path.join(
      UPLOADS_DIRECTORY,
      attachment.filename,
    );

    if (fs.existsSync(attachmentPath)) {
      fs.unlinkSync(attachmentPath);
    }
  }
}

app.locals.STATUSES = TASK_STATUSES;
app.locals.STATUS_LABELS = TASK_STATUS_LABELS;
app.locals.formatDate = formatTaskDate;

app.get('/', (request, response) => {
  const selectedStatus = request.query.status || 'all';
  let taskList = getTasks();

  const isStatusFilterValid =
    selectedStatus !== 'all' &&
    TASK_STATUSES.includes(selectedStatus);

  if (isStatusFilterValid) {
    taskList = taskList.filter(
      (task) => task.status === selectedStatus,
    );
  }

  taskList.sort(
    (firstTask, secondTask) =>
      new Date(secondTask.createdAt) - new Date(firstTask.createdAt),
  );

  response.render('index', {
    tasks: taskList,
    filter: selectedStatus,
    message: request.query.message || null,
  });
});

app.post('/tasks', (request, response) => {
  const { title, dueDate } = request.body;
  const taskTitle = title?.trim();

  if (!taskTitle) {
    return redirectWithMessage(response, 'Укажите название задачи');
  }

  const taskList = getTasks();

  const newTask = {
    id: generateId(),
    title: taskTitle,
    status: 'pending',
    dueDate: dueDate || null,
    attachments: [],
    createdAt: new Date().toISOString(),
  };

  taskList.push(newTask);
  saveTasks(taskList);

  redirectWithMessage(response, 'Задача создана');
});

app.post('/tasks/:id/status', (request, response) => {
  const { status } = request.body;
  const taskList = getTasks();
  const task = getTaskById(taskList, request.params.id);

  if (!task) {
    return redirectWithMessage(response, 'Задача не найдена');
  }

  if (!TASK_STATUSES.includes(status)) {
    return redirectWithMessage(response, 'Некорректный статус');
  }

  task.status = status;
  saveTasks(taskList);

  redirectWithMessage(response, 'Статус обновлён');
});

app.post('/tasks/:id/due-date', (request, response) => {
  const { dueDate } = request.body;
  const taskList = getTasks();
  const task = getTaskById(taskList, request.params.id);

  if (!task) {
    return redirectWithMessage(response, 'Задача не найдена');
  }

  task.dueDate = dueDate || null;
  saveTasks(taskList);

  redirectWithMessage(response, 'Дата обновлена');
});

app.post(
  '/tasks/:id/attach',
  uploadFile.single('file'),
  (request, response) => {
    const taskList = getTasks();
    const task = getTaskById(taskList, request.params.id);

    if (!task) {
      return redirectWithMessage(response, 'Задача не найдена');
    }

    if (!request.file) {
      return redirectWithMessage(response, 'Выберите файл');
    }

    const newAttachment = {
      id: generateId(),
      originalName: request.file.originalname,
      filename: request.file.filename,
      uploadedAt: new Date().toISOString(),
    };

    task.attachments.push(newAttachment);
    saveTasks(taskList);

    redirectWithMessage(response, 'Файл прикреплён');
  },
);

app.post('/tasks/:id/delete', (request, response) => {
  let taskList = getTasks();
  const task = getTaskById(taskList, request.params.id);

  if (!task) {
    return redirectWithMessage(response, 'Задача не найдена');
  }

  removeTaskFiles(task);

  taskList = taskList.filter(
    (currentTask) => currentTask.id !== request.params.id,
  );

  saveTasks(taskList);

  redirectWithMessage(response, 'Задача удалена');
});

app.listen(SERVER_PORT, () => {
  console.log(`Сервер запущен: http://localhost:${SERVER_PORT}`);
});