const API = "/api";
let token = localStorage.getItem("taskflow_token");
let currentUser = JSON.parse(localStorage.getItem("taskflow_user") || "null");
let tasks = [];
let editingId = null;
let socket = null;

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = message;
  $("toast").appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

async function request(url, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data.message || "Something went wrong.");
  return data;
}

function setAuthMode(mode) {
  const register = mode === "register";
  $("name-group").classList.toggle("hidden", !register);
  $("auth-submit").textContent = register ? "Create Account" : "Login";
  $("login-tab").classList.toggle("active", !register);
  $("register-tab").classList.toggle("active", register);
  $("auth-message").textContent = "";
}

$("login-tab").onclick = () => setAuthMode("login");
$("register-tab").onclick = () => setAuthMode("register");

$("auth-form").onsubmit = async (e) => {
  e.preventDefault();

  const register = !$("name-group").classList.contains("hidden");
  const body = {
    email: $("email").value.trim(),
    password: $("password").value
  };
  if (register) body.name = $("name").value.trim();

  try {
    const data = await request(`${API}/auth/${register ? "register" : "login"}`, {
      method: "POST",
      body: JSON.stringify(body)
    });

    token = data.token;
    currentUser = data.user;
    localStorage.setItem("taskflow_token", token);
    localStorage.setItem("taskflow_user", JSON.stringify(currentUser));

    $("auth-form").reset();
    await showApp();
  } catch (err) {
    $("auth-message").textContent = err.message;
  }
};

$("logout-btn").onclick = () => {
  localStorage.removeItem("taskflow_token");
  localStorage.removeItem("taskflow_user");
  token = null;
  currentUser = null;
  if (socket) socket.disconnect();
  $("app-screen").classList.add("hidden");
  $("auth-screen").classList.remove("hidden");
  setAuthMode("login");
};

async function showApp() {
  $("auth-screen").classList.add("hidden");
  $("app-screen").classList.remove("hidden");
  $("user-name").textContent = currentUser?.name || "User";
  await loadTasks();
  connectSocket();
}

async function loadTasks() {
  try {
    tasks = await request(`${API}/tasks`);
    renderTasks();
  } catch (err) {
    showToast(err.message);
  }
}

function connectSocket() {
  if (socket) socket.disconnect();

  socket = io();
  socket.emit("join-user-room", currentUser.id);

  socket.on("task-created", (task) => {
    if (!tasks.some(t => t._id === task._id)) tasks.unshift(task);
    renderTasks();
    showToast("New task added in real time.");
  });

  socket.on("task-updated", (task) => {
    const index = tasks.findIndex(t => t._id === task._id);
    if (index >= 0) tasks[index] = task;
    else tasks.unshift(task);
    renderTasks();
    showToast("Task updated in real time.");
  });

  socket.on("task-deleted", (id) => {
    tasks = tasks.filter(t => t._id !== id);
    renderTasks();
    showToast("Task deleted.");
  });
}

function renderTasks() {
  const search = $("search").value.toLowerCase();
  const status = $("status-filter").value;
  const priority = $("priority-filter").value;

  const filtered = tasks.filter(t => {
    const matchesSearch =
      t.title.toLowerCase().includes(search) ||
      (t.description || "").toLowerCase().includes(search) ||
      (t.category || "").toLowerCase().includes(search);

    return matchesSearch &&
      (status === "all" || t.status === status) &&
      (priority === "all" || t.priority === priority);
  });

  $("task-list").innerHTML = "";
  $("empty").classList.toggle("hidden", filtered.length !== 0);

  filtered.forEach(task => {
    const card = document.createElement("article");
    card.className = "task-card";

    const due = task.dueDate
      ? new Date(task.dueDate).toLocaleDateString()
      : "No deadline";

    const statusText = task.status.replace("-", " ");
    card.innerHTML = `
      <div class="task-top">
        <h3 class="task-title"></h3>
      </div>
      <p class="task-desc"></p>
      <div class="badges">
        <span class="badge priority-${task.priority}">${task.priority.toUpperCase()}</span>
        <span class="badge">${statusText}</span>
        <span class="badge">${task.category || "General"}</span>
      </div>
      <small>Due: ${due}</small>
      <div class="task-actions">
        <button data-action="edit">Edit</button>
        <button data-action="complete">${task.status === "completed" ? "Reopen" : "Complete"}</button>
        <button class="delete" data-action="delete">Delete</button>
      </div>
    `;

    card.querySelector(".task-title").textContent = task.title;
    card.querySelector(".task-desc").textContent = task.description || "No description.";

    card.querySelector('[data-action="edit"]').onclick = () => openEdit(task);
    card.querySelector('[data-action="complete"]').onclick = () => toggleComplete(task);
    card.querySelector('[data-action="delete"]').onclick = () => deleteTask(task._id);

    $("task-list").appendChild(card);
  });

  $("total-count").textContent = tasks.length;
  $("pending-count").textContent = tasks.filter(t => t.status === "pending").length;
  $("progress-count").textContent = tasks.filter(t => t.status === "in-progress").length;
  $("completed-count").textContent = tasks.filter(t => t.status === "completed").length;
}

$("search").oninput = renderTasks;
$("status-filter").onchange = renderTasks;
$("priority-filter").onchange = renderTasks;

function openModal() {
  $("modal").classList.remove("hidden");
}

function closeModal() {
  $("modal").classList.add("hidden");
  $("task-form").reset();
  editingId = null;
  $("modal-title").textContent = "Add Task";
}

$("add-btn").onclick = () => {
  closeModal();
  openModal();
};

$("close-modal").onclick = closeModal;

$("modal").addEventListener("click", (e) => {
  if (e.target === $("modal")) closeModal();
});

function openEdit(task) {
  editingId = task._id;
  $("modal-title").textContent = "Edit Task";
  $("task-id").value = task._id;
  $("task-title").value = task.title;
  $("task-description").value = task.description || "";
  $("task-priority").value = task.priority;
  $("task-status").value = task.status;
  $("task-category").value = task.category || "";
  $("task-due").value = task.dueDate ? task.dueDate.slice(0, 10) : "";
  openModal();
}

$("task-form").onsubmit = async (e) => {
  e.preventDefault();

  const body = {
    title: $("task-title").value.trim(),
    description: $("task-description").value.trim(),
    priority: $("task-priority").value,
    status: $("task-status").value,
    category: $("task-category").value.trim() || "General",
    dueDate: $("task-due").value || null
  };

  try {
    if (editingId) {
      const updated = await request(`${API}/tasks/${editingId}`, {
        method: "PUT",
        body: JSON.stringify(body)
      });
      const i = tasks.findIndex(t => t._id === editingId);
      if (i >= 0) tasks[i] = updated;
      showToast("Task updated.");
    } else {
      const created = await request(`${API}/tasks`, {
        method: "POST",
        body: JSON.stringify(body)
      });
      tasks.unshift(created);
      showToast("Task created.");
    }

    renderTasks();
    closeModal();
  } catch (err) {
    showToast(err.message);
  }
};

async function toggleComplete(task) {
  const newStatus = task.status === "completed" ? "pending" : "completed";

  try {
    const updated = await request(`${API}/tasks/${task._id}`, {
      method: "PUT",
      body: JSON.stringify({ status: newStatus })
    });

    const i = tasks.findIndex(t => t._id === task._id);
    if (i >= 0) tasks[i] = updated;
    renderTasks();
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteTask(id) {
  if (!confirm("Delete this task?")) return;

  try {
    await request(`${API}/tasks/${id}`, { method: "DELETE" });
    tasks = tasks.filter(t => t._id !== id);
    renderTasks();
    showToast("Task deleted.");
  } catch (err) {
    showToast(err.message);
  }
}

if (token && currentUser) {
  showApp();
}
