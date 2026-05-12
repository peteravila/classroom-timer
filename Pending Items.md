# LiveTimer — Pending Items

**Updated:** May 11, 2026

---

### 1. Deploy Latest Changes to Production

Local files have several changes that haven't been pushed to GitHub/Render yet:
- Custom styled dialogs replacing all native confirm/alert/prompt (instructor.html)
- Duration popup lightened to `rgba(180, 180, 200, 0.2)` with `blur(6px)` (instructor.html)
- Socket reconnection fixes after disconnect-all (student.html)
- `codeExpired` flag to prevent stale QR code auto-retry (student.html)

**Status:** Ready to deploy. Use deploy.bat or follow DEPLOY.md.

---

### 2. Library Mismatch

Local instructor page shows 5 timers, but production may have 8–10. Need to check MongoDB Atlas Data Explorer to see what's actually stored. If the extra timers only exist in localStorage on another computer's browser, they'll need to be exported from that browser (Settings > Library Backup > Export) and imported locally or into production.

**Status:** Not started

---

### 3. Test the Push Button Fix

The course title Push button had a race condition: clicking Push right after typing would erase the field and push nothing. A mousedown-capture fix was implemented but hasn't been tested yet with a running timer.

**Status:** Implemented, needs testing

---

### 4. Instructor Page Shrinkage

The viewport meta tag was removed in a previous session to fix the instructor page shrinking on certain screens. Not yet confirmed whether the fix worked.

**Status:** Needs confirmation

---

### 5. Progress Ring Scaling for Long Timers

The progress ring drains by percentage, so on multi-hour timers the visible change is tiny by the time color transitions kick in. Option