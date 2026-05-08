# Classroom Timer

A real-time timer for virtual classrooms. You control the timer from an instructor panel, and students see it live on their phones or laptops — no matter where they are.

## Features

- **Timer Library** — Save and reuse timers for lunch breaks, labs, short breaks, etc.
- **Editable fields** — Every timer has a title, duration, student message, and end-time toggle. Select a saved timer and tweak it before starting.
- **Real-time sync** — All connected students see the countdown update instantly via WebSockets.
- **Color-coded urgency** — Green → Yellow → Red as time runs out (on both instructor and student screens).
- **End time display** — Students see "Class resumes at 1:30 PM" so they know when to be back.
- **Audio alert** — A chime plays on the instructor's screen when time is up.
- **Phone vibration** — Students' phones vibrate when the timer finishes (if supported).
- **QR code** — Show the QR code on your shared Zoom screen so students can scan it.
- **+1/+5/+10/+15 buttons** — Extend a running timer without resetting it.

---

## Quick Start — Deploy on Glitch (Free, No Install)

1. Go to [glitch.com](https://glitch.com) and sign in (you can use Google or GitHub).
2. Click **New Project** → **Import from GitHub**.
3. If you've pushed this code to GitHub, paste the repo URL. Otherwise, use **"glitch-hello-node"** as a starter and replace the files:
   - Open the Glitch editor
   - Delete the default files
   - Drag and drop all files from the `TimerApp` folder into the Glitch editor (or copy/paste their contents)
4. Glitch will automatically install dependencies and start the server.
5. Click **Share** → **Live Site** to get your public URL (e.g., `https://your-project-name.glitch.me`).

**That's it!** Share the URL with students. You use `/instructor` to control; students open the base URL.

| Who          | URL                                          |
|--------------|----------------------------------------------|
| You          | `https://your-project.glitch.me/instructor`  |
| Students     | `https://your-project.glitch.me/`            |

---

## How to Use in a Zoom Class

1. Open the instructor panel in your browser: `https://your-project.glitch.me/instructor`
2. Paste the student URL into Zoom chat, or share your screen and show the QR code.
3. Select a timer from the **Timer Library** on the right — its settings load into the editable fields.
4. Adjust the title, minutes, or message if needed, then click **Load Timer**.
5. Press **Start**. Students see the countdown in real time.
6. Need more time? Click **+5 min** — the running timer extends without resetting.

### Managing Your Timer Library

- **Select** a timer in the library to load its values into the fields.
- **Edit** the fields, then click **Save changes** on that library item to update it.
- **+ New Timer** saves whatever is currently in the fields as a new library entry.
- **Duplicate** creates a copy of an existing timer for easy variations.
- **Delete** removes a timer permanently.

Your library is saved on the server, so it persists between sessions.

---

## Running Locally (Optional)

If you prefer to run it on your own computer (requires Node.js):

```bash
cd TimerApp
npm install
npm start
```

The server starts on port 3000. For a virtual classroom, you'd need to expose it via a tool like [ngrok](https://ngrok.com) so remote students can reach it.

---

## File Structure

```
TimerApp/
  server.js              — Express + Socket.io server
  package.json           — Dependencies
  timer-library.json     — Your saved timers (auto-created on first run)
  public/
    instructor.html      — Instructor control panel
    student.html         — Student countdown view
```
