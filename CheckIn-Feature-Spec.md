# Student Check-In / Done Feature — Spec

## Overview
Students can signal their progress to the instructor during activities (labs, exercises, etc.) by tapping "Working on it" or "Done" on their phone. The instructor sees a live status board on a new **Students** tab.

---

## Student Phone — Two-Tab UI

After entering the class code, the student's phone shows two tabs at the top:

- **Timer** — the existing countdown view (unchanged)
- **Check In** — the new status view

### Check In Tab
- Shows the student's display name
- Two large buttons: **Working on it** and **Done**
- Tapping a button highlights it (filled color); tapping the same button again toggles back to idle
- Status text updates: "Not checked in" → "Working on it..." → "Done!"
- Hint text: "Let your instructor know your progress."

### Student Identity
- A persistent UUID is generated and stored in `localStorage` on first visit — survives reconnects and page refreshes
- On the code entry screen, a new **optional** name field appears below the code input ("Your name (optional)")
- If the student doesn't provide a name, the server auto-assigns "Student 1", "Student 2", etc.
- If they provided a name previously, it's pre-filled on return visits
- QR code scans also prompt for identity on first connect

### Display/OBS/Large Screens
- No tabs, no check-in UI — these viewers show only the timer as before

---

## Instructor — Students Tab

A new fourth tab appears in the right-column tab bar: **Library | Options | Settings | Students**

### Summary Bar
A single-line summary at the top:
> **3** working · **5** done · **2** idle

Color-coded counts: green for working, blue for done, gray for idle.

### Student List
Sorted list of all connected students (working first, then done, then idle):

| Dot | Name | State | Time |
|-----|------|-------|------|
| 🟢 | Alex | WORKING | 2m ago |
| 🔵 | Student 3 | DONE | 1m ago |
| ⚫ | Jordan | IDLE | — |

- Colored dot indicates state (green/blue/gray)
- Relative timestamp shows when they last changed state
- List updates in real-time via Socket.io

### Toolbar
- **Reset All** button — sets all students back to idle (for starting a new activity)

### Tab Badge
The Students tab button shows a badge with the count of active (working + done) students, so the instructor can see at a glance without switching tabs.

---

## Server Changes

### Student Tracking
- In-memory `Map` keyed by persistent student UUID
- Each entry: `{ id, name, state, socketId, timestamp }`
- `studentCounter` for auto-assigning names

### New Socket Events
| Event | Direction | Payload | Purpose |
|-------|-----------|---------|---------|
| `student-identify` | Client → Server | `{ id, name }` | Register/reconnect student identity |
| `student-status` | Client → Server | `{ state }` | Update check-in state (idle/working/done) |
| `student-list` | Server → Instructor | `[{ id, name, state, timestamp }]` | Broadcast full student list |
| `student-name` | Server → Client | `string` | Tell student their assigned display name |
| `reset-student-states` | Instructor → Server | — | Reset all students to idle |

### Lifecycle
- Students persist in the map across socket reconnects (matched by UUID)
- "Disconnect All Students" clears the entire student map and resets the counter
- The instructor receives `student-list` on connect and after every state change

---

## What's NOT Included (Future Considerations)
- Per-timer toggle for check-in (buttons are always visible)
- Automatic reset on timer start/stop (can be added later)
- Persistent student data to MongoDB (in-memory only for now)
- Student-to-student visibility of status
