# Classroom Timer — Handoff Document for Claude

## What This App Does

A real-time classroom timer for virtual Zoom instruction. The instructor controls a timer from a control panel, and students see the countdown on their phones or in the Zoom screen share. All clients stay in sync via WebSockets.

## URLs (Production)

- **Instructor panel:** https://classroom-timer.onrender.com/instructor
- **Student view:** https://classroom-timer.onrender.com/student.html
- **Hosting:** Render.com (free tier) — auto-deploys from GitHub

Note: The root URL `/` is supposed to serve student.html via an Express route, but in production it currently serves the instructor view instead. The workaround is using `/student.html` directly (served by express.static). This could be investigated and fixed.

## GitHub Repository

- **Repo:** https://github.com/peteravila/classroom-timer
- **Branch:** main
- **Owner:** Peter (peteravila)

## Deployment Workflow

Peter is not a developer. The current workflow for making changes is:

1. Claude makes changes to local files in `C:\Users\peter\Dropbox\Development\TimerApp`
2. Peter manually updates files on GitHub (edit via browser, copy/paste content)
3. Peter goes to Render dashboard → clicks **Manual Deploy** → **Deploy latest commit**
4. GitHub's file upload UI does NOT support folders — individual files must be created via **Add file → Create new file** and using slashes in the filename to create directories (e.g., `public/instructor.html`)

**Important:** When giving Peter instructions to update GitHub, be explicit and simple. He is comfortable using the GitHub web editor but not git command line tools.

## Local Development

Peter has Node.js v24.15.0 installed on Windows. To test locally:

```bash
cd C:\Users\peter\Dropbox\Development\TimerApp
npm install    # only needed once or after dependency changes
npm start      # starts server on http://localhost:3000
```

- Instructor panel: http://localhost:3000/instructor
- Student view: http://localhost:3000/student.html

Stop the server with Ctrl+C. Restart after any server.js changes.

## Tech Stack

- **Runtime:** Node.js
- **Server:** Express.js
- **Real-time:** Socket.io (WebSockets)
- **QR Code:** qrcode (npm package, generates data URL PNGs)
- **Frontend:** Vanilla HTML/CSS/JavaScript (no build step, no frameworks)

## File Structure

```
TimerApp/
  package.json           — Dependencies (express, socket.io, qrcode)
  server.js              — Express + Socket.io server, timer logic, REST API for library
  timer-library.json     — Auto-generated on first run, persists saved timers
  HANDOFF.md             — This file
  README.md              — User-facing setup instructions
  public/
    instructor.html      — Instructor control panel (single self-contained HTML file)
    student.html         — Student countdown view (single self-contained HTML file)
```

## Architecture Overview

### Server (server.js)

The server manages a single global timer state object:

```javascript
let timerState = {
  label: '',              // Timer title shown to students (e.g., "Lunch Break")
  message: '',            // Custom message shown to students
  totalSeconds: 0,        // Original duration
  remainingSeconds: 0,    // Current seconds remaining
  running: false,         // Is countdown active?
  endTime: null,          // Epoch ms when timer will hit 0 (for accurate timing)
  showEndTime: true,      // Whether to display end time to students
  endTimeFormatted: '',   // Human-readable end time (e.g., "1:30 PM")
};
```

**Timer accuracy:** The server calculates `endTime` as an absolute timestamp when the timer starts. The tick interval (250ms) computes remaining time as `endTime - Date.now()`, avoiding drift from interval inaccuracy.

**Socket.io events (client → server):**
- `set-timer` — Load a timer with {minutes, label, message, showEndTime}
- `start` — Begin countdown
- `pause` — Pause countdown
- `reset` — Reset to original duration
- `add-time` — Add minutes to running timer {minutes}
- `update-message` — Live-update student message {message}
- `update-label` — Live-update timer label {label}

**Socket.io events (server → client):**
- `timer-update` — Broadcasts full timerState to all clients (4x/second while running)
- `timer-done` — Fired when countdown reaches zero
- `client-count` — Number of connected clients

### Timer Library (REST API)

Saved timer presets persist to `timer-library.json`. Each timer has:

```javascript
{
  id: '1',                    // Unique ID
  name: 'Lunch Break',       // Display name in library sidebar
  minutes: 60,               // Duration
  label: 'Lunch Break',      // Title shown to students
  message: 'Enjoy your lunch!', // Message shown to students
  showEndTime: true           // Whether to show end time
}
```

**Endpoints:**
- `GET /api/library` — List all timers
- `POST /api/library` — Create or update a timer (upsert by id)
- `DELETE /api/library/:id` — Delete a timer
- `PUT /api/library/reorder` — Reorder timers by array of IDs

**Default library** (created on first run): Lunch Break (60 min), Short Break (15 min), 10-Min Break, Lab Time (30 min), Extended Lab (60 min).

### QR Code

`GET /qr` returns `{ url, qr }` where `qr` is a data URL PNG. The URL is built from request headers (`x-forwarded-proto`, `x-forwarded-host`) to work behind Render's proxy. Currently points to `/student.html`.

### Instructor Page (public/instructor.html)

Single self-contained HTML file. Key features:

- **Two-column layout:** Main controls on the left, timer library sidebar on the right. Collapses to single column on mobile.
- **Timer display:** Large countdown digits with color states (green → yellow → red → pulsing red when done).
- **Duration/Target Time toggle:** Two input modes:
  - **Duration mode:** Enter minutes directly
  - **Target Time mode:** Pick a clock time (e.g., 1:00 PM), auto-calculates remaining minutes. Shows preview like "That's 1 hr 23 min from now."
- **"Load Timer" button:** Sends timer settings to server (sets up the countdown but doesn't start it). This is a two-step process: Load Timer, then Start.
- **Controls:** Start, Pause, Reset, +1/+5/+10/+15 min buttons
- **Library panel:** Click a timer to load its values into the editable fields. Save changes, Duplicate, Delete buttons per timer. "+ New Timer" saves current field values as a new library entry.
- **QR code & URL:** Auto-loaded from `/qr` endpoint. Copy button for the URL.
- **Connected count:** Shows number of connected clients.
- **Audio alarm:** Web Audio API generates a beep pattern when timer finishes.
- **Live updates:** Label and message fields have debounced input handlers that update students in real-time as the instructor types (300ms debounce).

**Color thresholds:**
- Green: > 35% remaining
- Yellow: 15–35% remaining
- Red: < 15% remaining
- Pulsing red: 0% (done)

### Student Page (public/student.html)

Single self-contained HTML file. Mobile-first, full-screen design.

- **Progress ring:** SVG circle that depletes as time counts down
- **Large countdown digits:** Responsive sizing with `min(28vw, 10rem)`
- **Background color transitions:** Entire page background shifts green → yellow → red → dark red
- **End time display:** Shows "Class resumes at 1:30 PM" when timer is running and showEndTime is true
- **Custom message:** Instructor's message displayed below the countdown
- **Phone vibration:** Uses `navigator.vibrate()` when timer finishes (mobile only)
- **Status badge:** Shows "Waiting for instructor", "Running", "Paused", or "Time's up"

## Known Issues / Future Work

1. **Root URL routing:** `app.get('/')` is defined to serve student.html, but in production on Render it appears to serve the instructor view instead. The `/student.html` path works correctly via express.static. Worth investigating — may be a route ordering issue or Render-specific behavior.

2. **Multi-instructor support (requested):** Currently there's one global timer state. Multiple instructors would step on each other. Planned feature: each instructor gets a unique "room" with its own timer state, using Socket.io rooms. URLs would be like `/instructor/abc123` and `/student.html?room=abc123`.

3. **Free tier sleep:** Render free tier spins down after ~15 min of inactivity. First visit takes ~50 seconds to wake up. Peter should open the instructor page a couple minutes before class.

4. **Timer library is global:** The library is stored server-side in a JSON file. If multi-instructor support is added, each instructor should have their own library (could be keyed by room or stored client-side in localStorage).

5. **No authentication:** Anyone with the instructor URL can control the timer. For a classroom setting this is acceptable, but adding a simple password for the instructor panel could be a future improvement.

6. **Access control (under consideration):** Two options discussed — (a) unique room codes per session so only people with the link can access, and/or (b) a PIN that students must enter before seeing the timer. Room codes tie naturally into multi-instructor support. Peter is still thinking about which approach he prefers.

7. **Root URL routing:** `app.get('/')` is defined to serve student.html, but in production on Render it serves the instructor view instead. The `/student.html` path works correctly via express.static. Worth investigating — may be a route ordering issue or Render-specific behavior.

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
2. Opens student.html in a separate tab
3. Shares the student tab in Zoom screen share
4. Pastes the student URL in Zoom chat (or shows QR code)
5. Picks a timer from the library, optionally tweaks it, clicks Load Timer → Start
6. Students see countdown on the Zoom share AND on their phones
