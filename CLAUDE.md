# CLAUDE.md — Working Rules for This Project

## How We Work Together

1. **Question everything.** Don't blindly execute requests. If you have a question, concern, or a better idea about any request — no matter how small — voice it before doing any work. This isn't about questioning for the sake of it; it's about surfacing anything useful rather than silently going along.

2. **Finish the conversation first.** When discussing a change, don't start development until the discussion is fully resolved and Peter gives explicit go-ahead (e.g., "go ahead," "proceed," or similar). Never jump into implementation mid-conversation.

3. **Watch for "..." signals.** If Peter's message ends with `...` on its own line, it means he has more to say. Do not act on the message. Wait for a follow-up that either gives the go-ahead or arrives without the ellipsis and without a question or request for feedback.

---

## Architecture

This is a real-time classroom timer for virtual instruction (Zoom + OBS). An instructor sets timers (breaks, labs, etc.) and students see a live countdown on their phones or screens.

### Stack
- Node.js + Express + Socket.io (real-time WebSocket communication)
- MongoDB Atlas free tier for persistent library storage
- Hosted on Render free tier
- GitHub repo for deployment (push to GitHub → Render auto-deploys)

### Files
- **server.js** — Express server, Socket.io event handlers, timer state, MongoDB connection, REST API for library CRUD, QR code generation. Timer state lives in memory; library persists to MongoDB (primary) and JSON file (backup).
- **public/student.html** — Student-facing timer display. Shows course title, progress ring, countdown digits, label, end time, message. Color transitions: green (>35%) → yellow (15–35%) → orange (≤15%) → pulsing red (time's up/overtime). Also used as preview iframe inside the instructor page.
- **public/instructor.html** — Instructor control panel. Two-column layout: left column has tabs (Text, Time, Library, Settings), right column has clock display with transport buttons and an embedded student preview iframe.
- **timer-library.json** — Local JSON backup of the timer library (also stored in MongoDB).
- **package.json** — Dependencies: express, socket.io, mongodb, qrcode. Dev: nodemon.

### Key Concepts

**Timer State (server-side, in-memory):** courseTitle, label, message, totalSeconds, originalTotal, remainingSeconds, running, endTime (epoch ms), showEndTime, endTimeFormatted, endTimeLabel. The `courseTitle` persists across stop/reset — it's a session-level field, not per-timer.

**Library:** Array of timer presets (name, minutes, label, message, showEndTime, goToTab). Stored in MongoDB Atlas with JSON file fallback. Also backed up to localStorage in the instructor's browser. Supports export/import via JSON files.

**Three-layer persistence for library:** MongoDB (primary, survives redeploys), localStorage (browser backup, survives MongoDB outages), export files (manual backup).

**Keep-alive ping:** instructor.html pings `/api/library` every 5 minutes to prevent Render free tier from spinning down. Only works while instructor tab is active — browsers throttle background tabs.

**Instructor page tabs:**
- Text: Course Title, Name (library only), Title, End Time Label, Message — each with Push/checkbox/Clear controls
- Time: Duration input with quick-set buttons
- Library: Grid of saved presets with load/save/create/delete/reorder
- Options: Per-timer settings saved with library items — show end time, transparent background (OBS/display only), clock only (OBS/display only), after-loading tab
- Settings: Global settings — class code with "Disconnect All Students" button, after-starting tab, alarm, warning, mute toggle, library backup export/import, student URL/QR

**Student page layout (top to bottom):** Code entry gate (phones only, if no valid code) → Course title (large banner) → progress ring → label → countdown digits → end time → message → "Time's Up" banner (when done) → status badge → QR corner (large screens only, bottom-right: "Scan to view this timer on your phone" + QR image + class code + "Can't scan?" fallback with URL and code)

**Class code system:** Server generates a 4-character alphanumeric code on startup (no ambiguous chars like 0/O/1/l). Students must enter the code on their phone to see the timer. QR code URL includes `?code=XXXX` so scanning skips the entry screen. Large screens (≥800px, projected displays) skip the code gate entirely and connect as "display" viewers — they always show the timer plus the QR corner with class code and instructions. The instructor's "Disconnect All Students" button generates a new code and disconnects all current students. Current code is displayed in Settings for the instructor to read aloud if needed.

**Mute toggle:** When muted, broadcast() only sends updates to the instructor room (instructor + preview sockets), not to students. Unmuting pushes the current state to all connected students. Useful for debugging/developing without disrupting students' phones.

**Line breaks:** Course Title, Title, and Message fields support `\n` (literal backslash-n) which converts to a real newline when pushed. Student view uses `white-space: pre-line` to render them. The `\n` code is stripped before placeholder detection so it doesn't trigger a prompt.

**Color states on student view:** CSS classes on body — state-idle (#1a1a2e), state-green (#0d3b2e), state-yellow (#3b3010), state-orange (#3b2010), state-done (#4a0e0e). The "almost done" state uses orange, not red, because students were confusing it with "time's up." Hybrid color thresholds: yellow = min(35% of total, 10 minutes), orange = min(15% of total, 3 minutes). This prevents long timers (e.g. multi-hour) from turning yellow/orange too early — short timers use percentages, long timers cap at fixed times.

**Preview iframe:** instructor.html embeds student.html?preview in an iframe. Preview mode hides the QR code, hides scrollbars, and doesn't count as a connected student. Supports draft label/message updates via postMessage.

**Display modes (per-timer, saved with library items):**
- **Transparent**: Background becomes transparent on OBS/display viewers. Phones are unaffected. Useful for OBS overlays.
- **Clock only**: Hides everything except the countdown digits on OBS/display viewers. Phones show the full view. Digit color transitions still apply.
- Both modes can be enabled simultaneously. They only affect display/preview/OBS viewers, never phone students.

**OBS browser source**: Use `?obs=true` parameter (e.g. `https://your-url/?obs=true`). Skips the code gate, hides QR code, identifies as a display viewer, and respects transparent/clock-only modes regardless of window size.

**Restore feature:** When a timer starts, the server snapshots it as `lastTimer` (label, message, originalTotal, showEndTime, endTimeLabel, endTime). If the timer is stopped or the page refreshes, the instructor can restore it — the server recalculates remaining time from the original endTime.

### Deployment
- Push updated files to GitHub
- Render auto-deploys from latest commit (or use Manual Deploy)
- Deploying restarts the server, which kills any running timer (planned fix: persist timer state to MongoDB)
- OBS browser sources cache aggressively — right-click → "Refresh cache of current page" after deploys
- Phone browsers also cache — hard refresh or re-scan QR code after deploys

### Planned / In Progress
- **Persist timer state to MongoDB** — Save running timer state (endTime, label, etc.) so the server can recover after a restart. The keep-alive ping is the first line of defense; MongoDB persistence is the safety net.
- **Progress ring scaling for long timers** — Currently the ring drains by percentage, so on multi-hour timers it's a tiny sliver by the time colors change. Under discussion: rescale the ring in the capped zone, freeze at a minimum %, or leave as-is.
- **Multi-instructor support (Phase 2)** — Eventually make the app available to multiple instructors, each with their own library and timer state.
