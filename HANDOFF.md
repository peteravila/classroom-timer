# LiveTimer — Handoff Document for Claude

## What This App Does

LiveTimer is a real-time classroom timer for virtual Zoom/OBS instruction. The instructor controls timers from a control panel, and students see the countdown on their phones or on the Zoom screen share. The key differentiator is that the timer follows the student — they scan a QR code and the countdown is on their phone, so they can walk away from their desk. All clients stay in sync via WebSockets.

## URLs (Production)

- **Instructor panel:** https://classroom-timer.onrender.com/instructor
- **Student view:** https://classroom-timer.onrender.com/ (or /student.html)
- **Hosting:** Render.com (free tier) — auto-deploys from GitHub

Note: The root URL `/` serves student.html via an Express route. The instructor view is at `/instructor`.

## GitHub Repository

- **Repo:** https://github.com/peteravila/classroom-timer
- **Branch:** main
- **Owner:** Peter (peteravila)

## Deployment Workflow

Peter is not a developer. There are two methods:

**Method 1 — deploy.bat (preferred):**
A batch script in the project root runs `git add . && git commit && git push`. Peter double-clicks it.

**Method 2 — GitHub web editor (fallback):**
1. Navigate to the file in GitHub, click the pencil icon
2. Select all (Ctrl+A), delete, paste new content from local file
3. Commit changes
4. Go to Render dashboard → Manual Deploy → Deploy latest commit

See `DEPLOY.md` for detailed step-by-step instructions.

**Important:** When giving Peter instructions to update GitHub, be explicit and simple. He is comfortable using the GitHub web editor but not git command line tools.

## Local Development

Peter has Node.js installed on Windows. To test locally:

```bash
cd C:\Users\peter\Dropbox\Development\TimerApp
npm install    # only needed once or after dependency changes
npm start      # starts server on http://localhost:3000
```

- Instructor panel: http://localhost:3000/instructor
- Student view: http://localhost:3000/

Stop the server with Ctrl+C. Restart after any server.js changes. Use `npm run dev` for auto-restart with nodemon (ignores timer-library.json and class-code.json changes).

## Tech Stack

- **Runtime:** Node.js
- **Server:** Express.js
- **Real-time:** Socket.io (WebSockets)
- **Database:** MongoDB Atlas (free tier) — stores timer library and class code
- **QR Code:** qrcode (npm package, generates data URL PNGs)
- **Environment:** dotenv for MONGODB_URI
- **Frontend:** Vanilla HTML/CSS/JavaScript (no build step, no frameworks)

## File Structure

```
TimerApp/
  package.json           — Dependencies (express, socket.io, mongodb, qrcode, dotenv)
  server.js              — Express + Socket.io server, timer logic, REST API, class code persistence
  timer-library.json     — Auto-generated, JSON backup of timer library (primary is MongoDB)
  class-code.json        — Auto-generated, JSON backup of current class code
  deploy.bat             — Git add/commit/push script for deployment
  CLAUDE.md              — Working rules and architecture docs for Claude
  HANDOFF.md             — This file
  DEPLOY.md              — Step-by-step deployment instructions for Peter
  README.md              — User-facing setup instructions
  Pending Items.md       — Known issues and pending decisions
  LiveTimer_Brochure.pdf — Marketing brochure (3 pages, dark theme, screenshots)
  LiveTimer_Brochure.docx — Word version of the brochure
  ss_*.png               — Screenshots used in the brochure
  public/
    instructor.html      — Instructor control panel (single self-contained HTML file)
    student.html         — Student countdown view (single self-contained HTML file)
```

## Architecture Overview

### Server (server.js)

The server manages a single global timer state object:

```javascript
let timerState = {
  courseTitle: '',        // Session-level, persists across stop/reset
  label: '',             // Timer title shown to students
  message: '',           // Custom message shown to students
  totalSeconds: 0,       // Current total for display
  originalTotal: 0,      // Original duration for ring/color thresholds
  remainingSeconds: 0,   // Current seconds remaining
  running: false,        // Is countdown active?
  endTime: null,         // Epoch ms when timer will hit 0
  showEndTime: true,     // Whether to display end time
  endTimeFormatted: '',  // Human-readable end time
  endTimeLabel: 'Class resumes at', // Customizable label for end time
};
```

**Timer accuracy:** The server calculates `endTime` as an absolute timestamp when the timer starts. The tick interval (250ms) computes remaining time as `endTime - Date.now()`, avoiding drift from interval inaccuracy.

**Restore feature:** When a timer starts, the server snapshots it as `lastTimer`. If stopped or page refreshes, the instructor can restore — the server recalculates remaining time from the original `endTime`.

**Class code persistence:** The class code persists to MongoDB (collection `settings`, doc `_id: 'classCode'`) and `class-code.json` as fallback. On startup, the server loads the existing code or generates a new one. "Disconnect All Students" generates a new code, saves it, and force-disconnects all student sockets.

**Socket.io events (client → server):**
- `set-timer` — Load a timer with {minutes, label, message, showEndTime, endTimeLabel}
- `start` — Begin countdown
- `pause` — Pause countdown
- `stop` — Stop and reset timer
- `reset` — Reset to original duration
- `add-time` — Add minutes to running timer {minutes}
- `restore` — Restore last timer from snapshot
- `update-message` — Live-update student message {message}
- `update-label` — Live-update timer label {label}
- `update-course-title` — Update course title {courseTitle}
- `update-end-time-label` — Update end time label {endTimeLabel}
- `validate-code` — Student submits class code for validation
- `disconnect-all` — Instructor generates new code, disconnects students
- `set-transparent` / `set-clock-only` — Toggle display modes
- `toggle-mute` — Toggle mute

**Socket.io events (server → client):**
- `timer-update` — Broadcasts full timerState to all clients (4x/second while running)
- `timer-done` — Fired when countdown reaches zero
- `client-count` — Number of connected clients
- `last-timer` — Sends restore snapshot to instructor
- `class-code` — Sends current code to instructor
- `code-accepted` / `code-rejected` — Response to student validation
- `code-expired` — Sent to students when code changes (disconnect-all)

### Timer Library (REST API)

Saved timer presets persist to MongoDB (collection `library`) with JSON file fallback. Each timer has:

```javascript
{
  id: '1',
  name: 'Lunch Break',
  minutes: 60,
  label: 'Lunch Break',
  message: 'Enjoy your lunch!',
  showEndTime: true,
  goToTab: 'library'  // which tab to switch to after loading
}
```

**Endpoints:**
- `GET /api/library` — List all timers
- `POST /api/library` — Create or update a timer (upsert by id)
- `DELETE /api/library/:id` — Delete a timer
- `PUT /api/library/reorder` — Reorder timers by array of IDs

### QR Code

`GET /qr` returns `{ url, qr, code }` where `qr` is a data URL PNG. The URL includes `?code=XXXX` so students who scan bypass the code entry screen.

### Instructor Page (public/instructor.html)

Single self-contained HTML file (~2100 lines). Key features:

- **Phone mockup centerpiece:** A live phone-shaped preview that mirrors the student view. Not an iframe — native HTML/CSS with contenteditable fields. Updates in real time during countdown (digits, ring, colors, state classes).
- **Contenteditable fields:** Course title, label, end time label, and message are editable directly on the mockup. Changes push to server on blur or via Push buttons.
- **Transport controls:** Play, Pause, Stop, Restore buttons below the mockup.
- **Duration popup:** Draggable overlay with hour/minute spinners and quick-set buttons. Translucent frosted glass (`backdrop-filter: blur(6px)`) so the timer is visible underneath. Supports duration mode and target-time mode.
- **Tabs:** Library (grid of presets), Options (per-timer display settings), Settings (class code, mute, alarm, backup).
- **Custom dialogs:** All native confirm/alert/prompt replaced with styled modal dialogs using frosted glass. `customConfirm(msg)` → Promise<boolean>, `customAlert(msg)` → Promise<void>, `customPrompt(label)` → Promise<string|null>.
- **Audio alarm:** Web Audio API beep pattern when timer finishes.
- **Connected count:** Shows number of connected clients.
- **Library backup:** Export/import via JSON files in Settings tab.

**Color thresholds (hybrid):**
- Green: > min(35%, 10 min) remaining
- Yellow: min(35%, 10 min) – min(15%, 3 min) remaining
- Orange: < min(15%, 3 min) remaining
- Pulsing red: 0% (done)

### Student Page (public/student.html)

Single self-contained HTML file (~440 lines). Mobile-first, full-screen design.

- **Code entry gate:** Phone-sized devices must enter a 4-character class code or scan QR. Large screens (≥800px) bypass the gate as "display" viewers.
- **Reconnection after disconnect-all:** Uses `codeExpired` flag to prevent stale QR code auto-retry. Explicitly calls `socket.connect()` when the student submits a new code after being disconnected.
- **Progress ring:** SVG circle that depletes as time counts down
- **Large countdown digits:** Responsive sizing
- **Background color transitions:** Entire page background shifts through color states
- **End time display:** Shows customizable label (e.g., "Class resumes at 1:30 PM")
- **Phone vibration:** Uses `navigator.vibrate()` when timer finishes (mobile only)
- **QR corner:** Large screens show QR code + class code + URL in bottom-right
- **OBS mode:** `?obs=true` parameter skips code gate, hides QR, respects transparent/clock-only modes

## Known Issues / Future Work

See `Pending Items.md` for the detailed list. Summary:

1. **Persist timer state to MongoDB** — Server restart kills running timer. Agreed upon, not yet implemented.
2. **Progress ring scaling for long timers** — Ring drains by percentage; tiny changes on multi-hour timers. Awaiting Peter's decision.
3. **Multi-instructor support (Phase 2)** — One global timer state currently. Planned: unique rooms per instructor.
4. **Free tier sleep** — Render spins down after ~15 min inactivity. Keep-alive ping mitigates but only while instructor tab is active.
5. **No authentication** — Anyone with the instructor URL can control the timer.
6. **Debug code in student.html submitCode()** — Diagnostic timeout/feedback code should be cleaned up once reconnection flow is confirmed stable.
7. **Undeployed local changes** — Custom dialogs, reconnection fixes, duration popup styling haven't been pushed to production yet.
8. **Library mismatch** — Local shows 5 timers but production may have more. Check MongoDB Atlas.

## CSS Design System

Both pages use a consistent dark theme:

```css
--bg: #1a1a2e        /* Page background */
--card: #16213e      /* Card/section background */
--card2: #1c2a4a     /* Library item background */
--accent: #0f3460    /* Borders, active states */
--text: #e0e0e0      /* Primary text */
--dim: #888          /* Secondary text */
--green: #4ecca3     /* Timer safe / start button */
--yellow: #f0c24b    /* Timer warning / pause button */
--red: #e74c3c       /* Timer urgent / done state */
--blue: #3498db      /* Links, end time, info accents */
```

## How Peter Uses This in Class

1. Opens instructor panel a couple minutes before needed (to wake up Render)
2. Shares the student view in Zoom screen share (or uses OBS)
3. Students scan QR code from shared screen — timer is now on their phone
4. Picks a timer from the library, optionally tweaks fields on the mockup, clicks play
5. Students see countdown on the Zoom share AND on their phones
6. When students walk away (break, lunch), the timer is in their pocket
7. Color transitions give at-a-glance status; no one needs to ask "how much time is left?"
