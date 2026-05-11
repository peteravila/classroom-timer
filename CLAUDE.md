# CLAUDE.md — Working Rules for This Project

## How We Work Together

1. **Question everything.** Don't blindly execute requests. If you have a question, concern, or a better idea about any request — no matter how small — voice it before doing any work. This isn't about questioning for the sake of it; it's about surfacing anything useful rather than silently going along.

2. **Finish the conversation first.** When discussing a change, don't start development until the discussion is fully resolved and Peter gives explicit go-ahead (e.g., "go ahead," "proceed," or similar). Never jump into implementation mid-conversation.

3. **Watch for "..." signals.** If Peter's message ends with `...` on its own line, it means he has more to say. Do not act on the message. Wait for a follow-up that either gives the go-ahead or arrives without the ellipsis and without a question or request for feedback.

---

## Product Name

**LiveTimer** — this is the product/brand name. Use it in all user-facing contexts.

---

## Architecture

This is a real-time classroom timer for virtual instruction (Zoom + OBS). An instructor sets timers (breaks, labs, etc.) and students see a live countdown on their phones or screens. The core differentiator: the timer follows the student — they scan a QR code and the countdown is on their phone, so they can walk away from their desk.

### Stack
- Node.js + Express + Socket.io (real-time WebSocket communication)
- MongoDB Atlas free tier for persistent library storage and class code persistence
- Hosted on Render free tier
- GitHub repo for deployment (push to GitHub → Render auto-deploys)

### Files
- **server.js** — Express server, Socket.io event handlers, timer state, MongoDB connection, REST API for library CRUD, QR code generation, class code persistence. Timer state lives in memory; library and class code persist to MongoDB (primary) and JSON files (backup).
- **public/student.html** — Student-facing timer display. Shows course title, progress ring, countdown digits, label, end time, message. Color transitions: green → yellow → orange → pulsing red. Includes code entry gate for phone users, QR corner for large displays. Handles socket reconnection after disconnect-all.
- **public/instructor.html** — Instructor control panel. Single-column layout with a live phone mockup as the centerpiece. Editable fields (course title, label, end time label, message) are inline on the mockup. Below the mockup: transport buttons (play/pause/stop/restore), tabs (Library, Options, Settings), and a draggable duration popup overlay with hour/minute spinners. All native dialogs (confirm/alert/prompt) replaced with custom styled dialogs.
- **timer-library.json** — Local JSON backup of the timer library (also stored in MongoDB).
- **class-code.json** — Local JSON backup of the current class code (also stored in MongoDB).
- **package.json** — Dependencies: express, socket.io, mongodb, qrcode, dotenv. Dev: nodemon.
- **deploy.bat** — Batch script for git add/commit/push deployment.

### Key Concepts

**Timer State (server-side, in-memory):** courseTitle, label, message, totalSeconds, originalTotal, remainingSeconds, running, endTime (epoch ms), showEndTime, endTimeFormatted, endTimeLabel. The `courseTitle` persists across stop/reset — it's a session-level field, not per-timer.

**Library:** Array of timer presets (name, minutes, label, message, showEndTime, goToTab). Stored in MongoDB Atlas with JSON file fallback. Also backed up to localStorage in the instructor's browser. Supports export/import via JSON files.

**Three-layer persistence for library:** MongoDB (primary, survives redeploys), localStorage (browser backup, survives MongoDB outages), export files (manual backup).

**Keep-alive ping:** instructor.html pings `/api/library` every 5 minutes to prevent Render free tier from spinning down. Only works while instructor tab is active — browsers throttle background tabs.

**Instructor page layout:** The instructor page uses a single-column layout centered around a live phone mockup that mirrors the student view. Text fields (course title, label, end time label, message) are contenteditable elements directly on the mockup — what you edit is what students see. Transport controls (play, pause, stop, restore) sit below the mockup. Tabs below that provide access to Library, Options, and Settings.

**Instructor page tabs:**
- Library: Grid of saved presets with load/save/create/delete/reorder. Click a timer name to load, play button to start immediately.
- Options: Per-timer settings saved with library items — show end time, transparent background (OBS/display only), clock only (OBS/display only), after-loading tab
- Settings: Global settings — class code with "Disconnect All Students" button, after-starting tab, alarm, warning, mute toggle, library backup export/import, student URL/QR

**Duration popup:** A draggable overlay with hour/minute spinners and quick-set buttons. CSS uses `backdrop-filter: blur(6px)` with a light translucent background (`rgba(180, 180, 200, 0.2)`) so the timer is visible counting down underneath. Supports both duration mode and target-time mode.

**Custom dialogs:** All native browser confirm(), alert(), and prompt() calls have been replaced with custom styled modal dialogs using frosted glass styling (`backdrop-filter: blur(8px)`, `rgba(30, 30, 50, 0.7)`, `max-width: 360px`). Functions: `customConfirm(msg)` returns a Promise<boolean>, `customAlert(msg)` returns a Promise<void>, `customPrompt(label)` returns a Promise<string|null>.

**Student page layout (top to bottom):** Code entry gate (phones only, if no valid code) → Course title (large banner) → progress ring → label → countdown digits → end time → message → "Time's Up" banner (when done) → status badge → QR corner (large screens only, bottom-right: "Scan to view this timer on your phone" + QR image + class code + "Can't scan?" fallback with URL and code)

**Class code system:** Server generates a 4-character alphanumeric code on startup (no ambiguous chars like 0/O/1/l). Code persists to MongoDB and class-code.json so it survives restarts. Students must enter the code on their phone to see the timer. QR code URL includes `?code=XXXX` so scanning skips the entry screen. Large screens (≥800px, projected displays) skip the code gate entirely and connect as "display" viewers — they always show the timer plus the QR corner with class code and instructions. The instructor's "Disconnect All Students" button generates a new code and disconnects all current students.

**Code entry reconnection:** When the instructor clicks "Disconnect All Students", the server calls `disconnectSockets(true)` which kills the underlying transport. The student page uses a `codeExpired` flag to prevent stale QR code auto-retry, and explicitly calls `socket.connect()` when needed. The `submitCode()` function checks `socket.connected` and reconnects before emitting. This ensures students on phones can re-enter a new code after being disconnected.

**Mute toggle:** When muted, broadcast() only sends updates to the instructor room (instructor + preview sockets), not to students. Unmuting pushes the current state to all connected students. Useful for debugging/developing without disrupting students' phones.

**Line breaks:** Course Title, Title, and Message fields support `\n` (literal backslash-n) which converts to a real newline when pushed. Student view uses `white-space: pre-line` to render them. The `\n` code is stripped before placeholder detection so it doesn't trigger a prompt.

**Color states on student view:** CSS classes on body — state-idle (#1a1a2e), state-green (#0d3b2e), state-yellow (#3b3010), state-orange (#3b2010), state-done (#4a0e0e). The "almost done" state uses orange, not red, because students were confusing it with "time's up." Hybrid color thresholds: yellow = min(35% of total, 10 minutes), orange = min(15% of total, 3 minutes). This prevents long timers (e.g. multi-hour) from turning yellow/orange too early — short timers use percentages, long timers cap at fixed times.

**Phone mockup as li