# TaskFlow

A full-stack real-time task management application.

## Features

- User registration and login
- JWT authentication
- Authorization using task ownership
- Password hashing with bcrypt
- Create, read, update and delete tasks
- Task status, priority, category and due date
- Search and filters
- Real-time task updates using Socket.IO
- Responsive design for desktop, tablet and mobile
- MongoDB database

## Requirements

- Node.js
- MongoDB (local) OR MongoDB Atlas

## Setup

1. Open this project folder in VS Code.
2. Open the terminal.
3. Run:

```bash
npm install
```

4. Copy `.env.example` to `.env`.

5. If MongoDB is installed locally, keep:

```env
MONGO_URI=mongodb://127.0.0.1:27017/taskflow
```

For MongoDB Atlas, replace it with your Atlas connection string.

6. Set a JWT secret in `.env`.

7. Start:

```bash
npm start
```

8. Open:

http://localhost:5000

## Internship demonstration

Create two different accounts. Add tasks to each account and show that each user only sees their own tasks. Open the same account in two browser windows and change a task to demonstrate the Socket.IO real-time update.
