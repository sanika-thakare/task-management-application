require("dotenv").config();

const path = require("path");
const http = require("http");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");


const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "development_secret_change_me";

app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["user", "admin"], default: "user" }
  },
  { timestamps: true }
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    status: { type: String, enum: ["pending", "in-progress", "completed"], default: "pending" },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    category: { type: String, default: "General" },
    dueDate: { type: Date, default: null },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Task = mongoose.model("Task", taskSchema);

function makeToken(user) {
  return jwt.sign(
    { id: user._id.toString(), role: user.role, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ message: "Authentication required." });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token." });
  }
}

function ownerOrAdmin(req, task) {
  return req.user.role === "admin" || task.userId.toString() === req.user.id;
}

io.on("connection", (socket) => {
  socket.on("join-user-room", (userId) => {
    if (userId) socket.join(`user:${userId}`);
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters." });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ message: "Email is already registered." });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });

    res.status(201).json({
      token: makeToken(user),
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: (email || "").toLowerCase() });

    if (!user || !(await bcrypt.compare(password || "", user.password))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    res.json({
      token: makeToken(user),
      user: { id: user._id, name: user.name, email: user.email, role: user.role }
    });
  } catch {
    res.status(500).json({ message: "Login failed." });
  }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("-password");
  if (!user) return res.status(404).json({ message: "User not found." });
  res.json(user);
});

app.get("/api/tasks", auth, async (req, res) => {
  try {
    const filter = req.user.role === "admin" ? {} : { userId: req.user.id };
    const tasks = await Task.find(filter).sort({ createdAt: -1 });
    res.json(tasks);
  } catch {
    res.status(500).json({ message: "Could not load tasks." });
  }
});

app.post("/api/tasks", auth, async (req, res) => {
  try {
    const { title, description, status, priority, category, dueDate } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ message: "Task title is required." });

    const task = await Task.create({
      title: title.trim(),
      description: description || "",
      status: status || "pending",
      priority: priority || "medium",
      category: category || "General",
      dueDate: dueDate || null,
      userId: req.user.id
    });

    io.to(`user:${req.user.id}`).emit("task-created", task);
    res.status(201).json(task);
  } catch {
    res.status(500).json({ message: "Could not create task." });
  }
});

app.put("/api/tasks/:id", auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found." });
    if (!ownerOrAdmin(req, task)) return res.status(403).json({ message: "You are not allowed to edit this task." });

    const allowed = ["title", "description", "status", "priority", "category", "dueDate"];
    allowed.forEach((key) => {
      if (req.body[key] !== undefined) task[key] = req.body[key];
    });

    await task.save();
    io.to(`user:${task.userId}`).emit("task-updated", task);
    res.json(task);
  } catch {
    res.status(500).json({ message: "Could not update task." });
  }
});

app.delete("/api/tasks/:id", auth, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id);
    if (!task) return res.status(404).json({ message: "Task not found." });
    if (!ownerOrAdmin(req, task)) return res.status(403).json({ message: "You are not allowed to delete this task." });

    const taskUserId = task.userId.toString();
    await task.deleteOne();
    io.to(`user:${taskUserId}`).emit("task-deleted", req.params.id);
    res.json({ message: "Task deleted." });
  } catch {
    res.status(500).json({ message: "Could not delete task." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

mongoose.connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err);
  });
