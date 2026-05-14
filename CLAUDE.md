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
- **server.js** — Express server, Socket.io event handlers, timer state, MongoDB connection, REST API for library CRUD, QR code generation, class code persistence. Timer state, library, and class code persist to MongoDB (primary). Library and class code also back up to JSON files.
- **public/student.html** — Student-facing timer display. Shows course title, progress ring, countdown digits, label, end time, message. Color transitions: green → yellow → orange → pulsing red. Includes code entry gate for phone users. Handles socket reconnection after disconnect-all.
- **public/instructor.html** — Instructor control panel. Single-column layout with a live phone mockup as the centerpiece. Editable fields (course title, label, end time label, message) are inline on the mockup. Below the mockup: transport buttons (play/pause/stop/restore), tabs (Library, Options, Settings), and a draggable duration popup overlay with hour/minute spinners. All native dialogs (confirm/alert/prompt) replaced with custom styled dialogs.
- **timer-library.json** — Local JSON backup of the timer library (also stored in MongoDB).
- **class-code.json** — Local JSON backup of the current class code (also stored in MongoDB).
- **package.json** — Dependencies: express, socket.io, mongodb, qrcode, dotenv. Dev: nodemon.
- **deploy.bat** — Batch script for git add/commit/push deployment.

### Key Concepts

**Timer State (server-side, persisted to MongoDB):** courseTitle, label, message, totalSeconds, originalTotal, remainingSeconds, running, endTime (epoch ms), showEndTime, endTimeFormatted, endTimeLabel. The `courseTitle` persists across stop/reset — it's a session-level field, not per-timer. Timer state and the lastTimer restore snapshot are saved to MongoDB on every user-initiated state change (start, pause, stop, load, text edits, etc.) but not on every tick — the saved endTime is sufficient for recovery. On server restart, if a timer was running and its endTime is still in the future, the server resumes ticking automatically.

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

**Student page layout (top to bottom):** Code entry gate (phones only, if no valid code) → Course title (large banner) → progress ring → label → countdown digits → end time → message → "Time's Up" banner (when done) → status badge. The QR corner was removed from the student page — QR code display is now handled by the dedicated `/qr-only` route (see below).

**Class code system:** Server generates a 4-character alphanumeric code on startup (no ambiguous chars like 0/O/1/l). Code persists to MongoDB and class-code.json so it survives restarts. Students must enter the code on their phone to see the timer. QR code URL includes `?code=XXXX` so scanning skips the entry screen. Large screens (≥800px, projected displays) skip the code gate entirely and connect as "display" viewers. The instructor's "Disconnect All Students" button generates a new code and disconnects all current students.

**Code entry reconnection:** When the instructor clicks "Disconnect All Students", the server calls `disconnectSockets(true)` which kills the underlying transport. The student page uses a `codeExpired` flag to prevent stale QR code auto-retry, and explicitly calls `socket.connect()` when needed. The `submitCode()` function checks `socket.connected` and reconnects before emitting. This ensures students on phones can re-enter a new code after being disconnected.

**Mute toggle:** When muted, broadcast() only sends updates to the instructor room (instructor + preview sockets), not to students. Unmuting pushes the current state to all connected students. Useful for debugging/developing without disrupting students' phones.

**Line breaks:** Course Title, Title, and Message fields support `\n` (literal backslash-n) which converts to a real newline when pushed. Student view uses `white-space: pre-line` to render them. The `\n` code is stripped before placeholder detection so it doesn't trigger a prompt.

**Color states on student view:** CSS classes on body — state-idle (#1a1a2e), state-green (#0d3b2e), state-yellow (#3b3010), state-orange (#3b2010), state-done (#4a0e0e). The "almost done" state uses orange, not red, because students were confusing it with "time's up." Hybrid color thresholds: yellow = min(35% of total, 10 minutes), orange = min(15% of total, 3 minutes). This prevents long timers (e.g. multi-hour) from turning yellow/orange too early — short timers use percentages, long timers cap at fixed times.

**Phone mockup as live preview:** The instructor page's phone mockup is not an iframe — it's native HTML/CSS that mirrors the student view. During countdown, it receives timer-update events and updates digits, ring, colors, and state classes in real time. Contenteditable fields on the mockup push changes to the server on blur or via Push buttons.

**Display modes (per-timer, saved with library items):**
- **Transparent**: Background becomes transparent on OBS/display viewers. Phones are unaffected. Useful for OBS overlays.
- **Clock only**: Hides everything except the countdown digits on OBS/display viewers. Phones show the full view. Digit color transitions still apply.
- Both modes can be enabled simultaneously. They only affect display/preview/OBS viewers, never phone students.

**OBS browser source**: Use `?obs=true` parameter (e.g. `https://your-url/?obs=true`). Skips the code gate, identifies as a display viewer, and respects transparent/clock-only modes regardless of window size.

**`/qr-only` route (QR code display page):** A dedicated server-rendered page at `/qr-only` that shows only the QR code, class code, and connection instructions — designed to be used as an OBS browser source in its own scene or as part of an OBS URL grid. The page displays "Scan to connect to LiveTimer" above the QR image, the class code in large monospace text, and a "Can't scan? Go to [URL]" hint below. Connects as a "preview" socket role to receive class-code update events in real time. Uses responsive CSS with `clamp()` for font sizing and `vmin` for QR image sizing so it scales well at any OBS browser source dimensions. Styled with a dark background (`#1a1a2e`) matching the student page idle state.

**OBS scene setup:** The instructor uses an OBS URL grid approach — multiple browser sources (timer, QR-only page, slides, camera, etc.) arranged across scenes. OBS browser sources cache aggressively; enable "Refresh browser when scene becomes active" in each source's properties so they reload on scene switch. After deploying changes, switch away from the scene and back to trigger a refresh. Set browser source dimensions to match the actual display size to avoid fuzzy text from OBS raster downscaling.

**Restore feature:** When a timer starts, the server snapshots it as `lastTimer` (label, message, originalTotal, showEndTime, endTimeLabel, endTime). If the timer is stopped or the page refreshes, the instructor can restore it — the server recalculates remaining time from the original endTime.

### Deployment
- Push updated files to GitHub (Peter uses the GitHub web editor or deploy.bat)
- Render auto-deploys from latest commit (or use Manual Deploy)
- Deploying restarts the server, but running timers recover automatically from MongoDB (endTime-based resumption)
- OBS browser sources: enable "Refresh browser when scene becomes active" in source properties, then switch scenes after deploy to trigger refresh
- Phone browsers also cache — hard refresh or re-scan QR code after deploys
- See DEPLOY.md for step-by-step instructions for Peter

### Marketing Materials
- **LiveTimer_Brochure.pdf** — 3-page dark-themed marketing brochure with screenshots. Generated via Python/reportlab. Source script is session-local (livetimer_brochure10.py). Screenshots are ss_*.png files in the project root.
- **LiveTimer_Brochure.docx** — Word version of the same brochure, generated via python-docx.

### Pending / In Progress
- **Instructor page authentication** — Discussed but not yet implemented. Needed before multi-instructor support.
- **Progress ring scaling for long timers** — Currently the ring drains by percentage, so on multi-hour timers it's a tiny sliver by the time colors change. Under discussion: rescale the ring in the capped zone, freeze at a minimum %, or leave as-is. Awaiting Peter's decision.
- **Multi-instructor support (Phase 2)** — Eventually make the app available to multiple instructors, each with their own library and timer state.
- **Clean up debug code in student.html** — The submitCode() function still has diagnostic timeout/feedback code ("Validating...", "No response from server") that should be simplified once the reconnection flow is confirmed stable.
- **Delete old Render services** — classroom-timer and any test services should be removed.
- **Brochure iteration** — The brochure (v10) has mixed-alignment layout with text wrapping around images, reduced word count, larger fonts. Peter may have further feedback.
