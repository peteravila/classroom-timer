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

The progress ring drains by percentage, so on multi-hour timers the visible change is tiny by the time color transitions kick in. Options discussed: rescale the ring in the capped zone, freeze at a minimum %, or leave as-is. Peter said "let me think about it."

**Status:** Awaiting Peter's decision

---

### 6. Persist Timer State to MongoDB

Currently, a server restart (e.g., Render redeploy) kills any running timer. The plan is to save timer state (endTime, label, etc.) to MongoDB so the server can recover after a restart. The keep-alive ping is the first defense; MongoDB persistence is the safety net.

**Status:** Agreed upon, not implemented

---

### 7. Clean Up Debug Code in student.html

The `submitCode()` function has diagnostic timeout/feedback code (e.g., "Validating...", "No response from server. Connected: ...") that was added during debugging of the reconnection flow. Should be simplified to just "Connecting..." or removed once the flow is confirmed stable in production.

**Status:** Low priority, cosmetic

---

### 8. LiveTimer Brochure

Marketing brochure (v10) has been generated as both PDF and DOCX. Current layout uses mixed left/right alignment, text wrapping around images, reduced word count, and larger fonts. Peter may have further feedback on the layout and content.

**Status:** Awaiting Peter's review
