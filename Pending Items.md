# Classroom Timer — Pending Items

**Date:** May 9, 2026

---

### 1. Library Mismatch

Local instructor page shows 5 timers, but there should be 8–10. Need to check MongoDB Atlas Data Explorer to see what's actually stored. If the extra timers only exist in localStorage on another computer's browser, they'll need to be exported from that browser (Settings > Library Backup > Export) and imported locally or into production.

**Status:** Not started

---

### 2. Test the Push Button Fix

The course title Push button had a race condition: clicking Push right after typing would erase the field and push nothing. A mousedown-capture fix was implemented but hasn't been tested yet with a running timer.

**Status:** Implemented, needs testing

---

### 3. Instructor Page Shrinkage

The viewport meta tag was removed in a previous session to fix the instructor page shrinking on certain screens. Not yet confirmed whether the fix worked.

**Status:** Needs confirmation

---

### 4. Progress Ring Scaling for Long Timers

The progress ring drains by percentage, so on multi-hour timers the visible change is tiny by the time color transitions kick in. Options discussed: rescale the ring in the capped zone, freeze at a minimum %, or leave as-is. Peter said "let me think about it."

**Status:** Awaiting decision

---

### 5. Persist Timer State to MongoDB

Currently, a server restart (e.g., Render redeploy) kills any running timer. The plan is to save timer state (endTime, label, etc.) to MongoDB so the server can recover after a restart. The keep-alive ping is the first defense; MongoDB persistence is the safety net.

**Status:** Agreed upon, not implemented
