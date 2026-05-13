// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ── Timer Library (MongoDB with JSON file fallback) ─────────
const MONGODB_URI = process.env.MONGODB_URI;
const LIBRARY_FILE = path.join(__dirname, 'timer-library.json');

let db = null; // MongoDB database reference

const DEFAULT_LIBRARY = [
  { id: '1', name: 'Lunch 60',       minutes: 60, label: 'Lunch Break',    message: 'Enjoy your lunch! See you back in class soon.', showEndTime: true },
  { id: '2', name: 'Break 15',       minutes: 15, label: 'Short Break',    message: 'Quick break — grab a coffee or stretch!',       showEndTime: true },
  { id: '3', name: 'Break 10',       minutes: 10, label: 'Break',          message: 'Be back in 10!',                                showEndTime: true },
  { id: '4', name: 'Lab 30',         minutes: 30, label: 'Lab Activity',   message: 'Work through the lab at your own pace.',         showEndTime: true },
  { id: '5', name: 'Lab 60',         minutes: 60, label: 'Lab Activity',   message: 'Take your time — ask questions if you get stuck.', showEndTime: true },
];

// Connect to MongoDB (if URI is configured)
async function connectMongo() {
  if (!MONGODB_URI) {
    console.log('  No MONGODB_URI set — using local JSON file for library.');
    return;
  }
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db('classroomTimer');
    console.log('  Connected to MongoDB Atlas.');
  } catch (e) {
    console.error('  MongoDB connection failed, falling back to JSON file:', e.message);
    db = null;
  }
}

async function loadLibrary() {
  // Try MongoDB first
  if (db) {
    try {
      const doc = await db.collection('libraries').findOne({ _id: 'default' });
      if (doc && doc.timers && doc.timers.length > 0) return doc.timers;
      // No data yet — seed with defaults
      await saveLibrary(DEFAULT_LIBRARY);
      return DEFAULT_LIBRARY;
    } catch (e) {
      console.error('  MongoDB loadLibrary failed:', e.message);
    }
  }
  // Fall back to JSON file
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      return JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
    }
  } catch (e) { /* fall through */ }
  await saveLibrary(DEFAULT_LIBRARY);
  return DEFAULT_LIBRARY;
}

async function saveLibrary(lib) {
  // Save to MongoDB if available
  if (db) {
    try {
      await db.collection('libraries').updateOne(
        { _id: 'default' },
        { $set: { timers: lib, updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (e) {
      console.error('  MongoDB saveLibrary failed:', e.message);
    }
  }
  // Always save to JSON file as backup
  try {
    fs.writeFileSync(LIBRARY_FILE, JSON.stringify(lib, null, 2));
  } catch (e) { /* ignore on read-only filesystems */ }
}

let library = [];
let savedOrders = [];

async function loadSavedOrders() {
  if (db) {
    try {
      const doc = await db.collection('settings').findOne({ _id: 'savedOrders' });
      if (doc && doc.orders) return doc.orders;
    } catch (e) {
      console.error('  MongoDB loadSavedOrders failed:', e.message);
    }
  }
  return [];
}

async function saveSavedOrders(orders) {
  if (db) {
    try {
      await db.collection('settings').updateOne(
        { _id: 'savedOrders' },
        { $set: { orders, updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (e) {
      console.error('  MongoDB saveSavedOrders failed:', e.message);
    }
  }
}

// ── Class code & mute ───────────────────────────────────────
function generateCode() {
  // 4-char alphanumeric, no ambiguous chars (0O1lI)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

let classCode = null;     // loaded from DB on startup, or generated fresh
let muted = false;        // when true, students don't receive updates

async function loadClassCode() {
  if (db) {
    try {
      const doc = await db.collection('settings').findOne({ _id: 'classCode' });
      if (doc && doc.code) return doc.code;
    } catch (e) {
      console.error('  MongoDB loadClassCode failed:', e.message);
    }
  }
  // Fall back to JSON file
  const codeFile = path.join(__dirname, 'class-code.json');
  try {
    if (fs.existsSync(codeFile)) {
      const data = JSON.parse(fs.readFileSync(codeFile, 'utf8'));
      if (data.code) return data.code;
    }
  } catch (e) { /* fall through */ }
  return null;
}

async function saveClassCode(code) {
  if (db) {
    try {
      await db.collection('settings').updateOne(
        { _id: 'classCode' },
        { $set: { code, updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (e) {
      console.error('  MongoDB saveClassCode failed:', e.message);
    }
  }
  // Always save to JSON file as backup
  const codeFile = path.join(__dirname, 'class-code.json');
  try {
    fs.writeFileSync(codeFile, JSON.stringify({ code }, null, 2));
  } catch (e) { /* ignore on read-only filesystems */ }
}

// ── Student check-in tracking ────────────────────────────────
// Map of persistent student UUID → { id, name, state, socketId, timestamp }
// state: 'idle' | 'working' | 'done'
const students = new Map();
let studentCounter = 0; // for auto-assigning "Student N"
let checkinEnabled = false; // instructor toggle: show/hide check-in buttons on student phones

function broadcastStudentList() {
  const list = Array.from(students.values()).map(s => ({
    id: s.id,
    name: s.name,
    state: s.state,
    timestamp: s.timestamp,
  }));
  io.to('instructor').emit('student-list', list);
}

function resetAllStudentStates() {
  for (const s of students.values()) {
    s.state = 'idle';
    s.timestamp = null;
  }
  broadcastStudentList();
}

// ── Sequences (saved timer chains) ──────────────────────────
let sequences = [];

async function loadSequences() {
  if (db) {
    try {
      const doc = await db.collection('settings').findOne({ _id: 'sequences' });
      if (doc && doc.sequences) return doc.sequences;
    } catch (e) {
      console.error('  MongoDB loadSequences failed:', e.message);
    }
  }
  return [];
}

async function saveSequences(seqs) {
  if (db) {
    try {
      await db.collection('settings').updateOne(
        { _id: 'sequences' },
        { $set: { sequences: seqs, updatedAt: new Date() } },
        { upsert: true }
      );
    } catch (e) {
      console.error('  MongoDB saveSequences failed:', e.message);
    }
  }
}

// Active sequence playback state (in memory)
let activeSequence = null;  // { id, name, autoAdvance, steps: [...resolved timer data], currentIndex }
let sequenceAdvanceTimeout = null;  // setTimeout handle for auto-advance delay

function clearSequenceState() {
  activeSequence = null;
  if (sequenceAdvanceTimeout) {
    clearTimeout(sequenceAdvanceTimeout);
    sequenceAdvanceTimeout = null;
  }
}

function broadcastSequenceState() {
  const seqState = activeSequence ? {
    id: activeSequence.id,
    name: activeSequence.name,
    currentIndex: activeSequence.currentIndex,
    totalSteps: activeSequence.steps.length,
    autoAdvance: activeSequence.autoAdvance,
    nextLabel: activeSequence.currentIndex < activeSequence.steps.length - 1
      ? activeSequence.steps[activeSequence.currentIndex + 1].label
      : null,
  } : null;
  io.to('instructor').emit('sequence-state', seqState);
}

function loadSequenceStep(index) {
  if (!activeSequence || index >= activeSequence.steps.length) {
    // Sequence finished
    clearSequenceState();
    broadcastSequenceState();
    return false;
  }
  activeSequence.currentIndex = index;
  const step = activeSequence.steps[index];
  timerState.totalSeconds = step.totalSeconds;
  timerState.originalTotal = step.totalSeconds;
  timerState.remainingSeconds = step.totalSeconds;
  timerState.label = step.label || '';
  timerState.message = step.message || '';
  timerState.showEndTime = step.showEndTime !== false;
  timerState.endTimeLabel = 'Class resumes at';
  timerState.running = false;
  timerState.endTime = null;
  timerState.endTimeFormatted = '';
  stopTick();
  broadcast();
  broadcastSequenceState();
  return true;
}

function advanceSequence() {
  if (!activeSequence) return;
  const nextIndex = activeSequence.currentIndex + 1;
  if (nextIndex >= activeSequence.steps.length) {
    // Sequence complete
    clearSequenceState();
    broadcastSequenceState();
    return;
  }
  if (activeSequence.autoAdvance) {
    // Stop the old timer tick so it doesn't keep broadcasting negative values
    stopTick();
    timerState.running = false;
    // Notify clients of upcoming timer
    const nextStep = activeSequence.steps[nextIndex];
    const preview = { label: nextStep.label, index: nextIndex, total: activeSequence.steps.length };
    if (muted) {
      io.to('instructor').emit('sequence-next-preview', preview);
    } else {
      io.emit('sequence-next-preview', preview);
    }
    // Auto-start after 3-second interstitial
    sequenceAdvanceTimeout = setTimeout(() => {
      sequenceAdvanceTimeout = null;
      if (loadSequenceStep(nextIndex)) {
        // Auto-start the timer
        timerState.running = true;
        lastTimer = {
          label: timerState.label,
          message: timerState.message,
          originalTotal: timerState.originalTotal,
          remainingSeconds: timerState.remainingSeconds,
          showEndTime: timerState.showEndTime,
          endTimeLabel: timerState.endTimeLabel,
          endTime: Date.now() + timerState.remainingSeconds * 1000,
        };
        startTick();
        broadcast();
        io.to('instructor').emit('last-timer', lastTimer);
      }
    }, 3000);
  } else {
    // Manual advance — load but don't start
    loadSequenceStep(nextIndex);
  }
}

// ── Timer state ──────────────────────────────────────────────
let timerState = {
  courseTitle: '',      // persistent course title — survives stop/reset
  label: '',
  message: '',
  totalSeconds: 0,
  originalTotal: 0,    // original duration for ring/color thresholds (survives pause/restart)
  remainingSeconds: 0,
  running: false,
  endTime: null,       // epoch ms when timer will hit 0
  showEndTime: true,
  endTimeFormatted: '',
  endTimeLabel: 'Class resumes at',
  transparent: false,  // transparent background (for OBS/display)
  blackBg: false,      // solid black background (for OBS/display)
  clockOnly: false,    // show only countdown digits (for OBS/display)
};

// Snapshot of last running timer for "restore" feature
let lastTimer = null;

let tickInterval = null;

function formatEndTime(epochMs) {
  if (!epochMs) return '';
  const d = new Date(epochMs);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m} ${ampm}`;
}

function broadcast() {
  if (timerState.endTime) {
    timerState.endTimeFormatted = formatEndTime(timerState.endTime);
  }
  if (muted) {
    // Only send to instructor/preview sockets
    io.to('instructor').emit('timer-update', timerState);
  } else {
    io.emit('timer-update', timerState);
  }
}

function startTick() {
  stopTick();
  timerState.endTime = Date.now() + timerState.remainingSeconds * 1000;
  timerState.endTimeFormatted = formatEndTime(timerState.endTime);
  let doneFired = false;
  tickInterval = setInterval(() => {
    const left = Math.round((timerState.endTime - Date.now()) / 1000);
    timerState.remainingSeconds = left;
    if (left <= 0 && !doneFired) {
      doneFired = true;
      if (muted) {
        io.to('instructor').emit('timer-done');
      } else {
        io.emit('timer-done');
      }
      // If running in a sequence, advance to next step
      if (activeSequence) {
        advanceSequence();
      }
    }
    broadcast();
  }, 250);
}

function stopTick() {
  if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
}

// ── Routes ───────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'student.html')));
app.get('/instructor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'instructor.html')));

// Library REST endpoints
app.get('/api/library', (req, res) => res.json(library));

app.post('/api/library', async (req, res) => {
  const item = req.body;
  item.id = item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const idx = library.findIndex(t => t.id === item.id);
  if (idx >= 0) library[idx] = item;
  else library.push(item);
  await saveLibrary(library);
  res.json(library);
});

app.delete('/api/library/:id', async (req, res) => {
  library = library.filter(t => t.id !== req.params.id);
  await saveLibrary(library);
  res.json(library);
});

app.put('/api/library/reorder', async (req, res) => {
  const { ids } = req.body;
  if (Array.isArray(ids)) {
    const map = Object.fromEntries(library.map(t => [t.id, t]));
    library = ids.map(id => map[id]).filter(Boolean);
    await saveLibrary(library);
  }
  res.json(library);
});

// Library export/import
app.get('/api/library/export', (req, res) => {
  res.setHeader('Content-Disposition', 'attachment; filename="timer-library.json"');
  res.json(library);
});

app.post('/api/library/import', async (req, res) => {
  const imported = req.body;
  if (!Array.isArray(imported)) return res.status(400).json({ error: 'Expected an array of timers' });
  library = imported;
  await saveLibrary(library);
  res.json(library);
});

// Saved orders REST endpoints
app.get('/api/orders', (req, res) => res.json(savedOrders));

app.post('/api/orders', async (req, res) => {
  const { name, ids } = req.body;
  if (!name || !Array.isArray(ids)) return res.status(400).json({ error: 'name and ids required' });
  const id = req.body.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const idx = savedOrders.findIndex(o => o.id === id);
  const order = { id, name, ids };
  if (idx >= 0) savedOrders[idx] = order;
  else savedOrders.push(order);
  await saveSavedOrders(savedOrders);
  res.json(savedOrders);
});

app.delete('/api/orders/:id', async (req, res) => {
  savedOrders = savedOrders.filter(o => o.id !== req.params.id);
  await saveSavedOrders(savedOrders);
  res.json(savedOrders);
});

// Sequence REST endpoints
app.get('/api/sequences', (req, res) => res.json(sequences));

app.post('/api/sequences', async (req, res) => {
  const seq = req.body;
  seq.id = seq.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const idx = sequences.findIndex(s => s.id === seq.id);
  if (idx >= 0) sequences[idx] = seq;
  else sequences.push(seq);
  await saveSequences(sequences);
  res.json(sequences);
});

app.delete('/api/sequences/:id', async (req, res) => {
  sequences = sequences.filter(s => s.id !== req.params.id);
  await saveSequences(sequences);
  res.json(sequences);
});

// QR code — includes class code in URL
app.get('/qr', async (req, res) => {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const studentUrl = `${protocol}://${host}/?code=${classCode}`;
  try {
    const dataUrl = await QRCode.toDataURL(studentUrl, { width: 300, margin: 2 });
    res.json({ url: studentUrl, qr: dataUrl, code: classCode });
  } catch (err) {
    res.status(500).json({ error: 'Could not generate QR code' });
  }
});

// ── Socket.io ────────────────────────────────────────────────
let connectedStudents = 0;

io.on('connection', (socket) => {
  let role = 'pending'; // pending | student | instructor | preview
  let validated = false;
  let studentPersistentId = null; // UUID from student's localStorage

  socket.on('identify', (r) => {
    if (r === 'instructor') {
      role = 'instructor';
      validated = true;
      socket.join('instructor');
      // Send current state to instructor
      socket.emit('timer-update', timerState);
      socket.emit('last-timer', lastTimer);
      socket.emit('class-code', classCode);
      socket.emit('mute-state', muted);
      socket.emit('checkin-enabled', checkinEnabled);
      io.to('instructor').emit('client-count', connectedStudents);
      broadcastStudentList();
      broadcastSequenceState();
    } else if (r === 'preview' || r === 'display') {
      role = r;
      validated = true;
      socket.join('instructor'); // preview/display get same updates as instructor
      socket.emit('timer-update', timerState);
    }
  });

  // Student validates with class code
  socket.on('validate-code', (code) => {
    if (code === classCode) {
      role = 'student';
      validated = true;
      socket.join('students');
      connectedStudents++;
      socket.emit('code-accepted');
      socket.emit('timer-update', timerState);
      socket.emit('checkin-enabled', checkinEnabled);
      io.to('instructor').emit('client-count', connectedStudents);
    } else {
      socket.emit('code-rejected');
    }
  });

  // Student identifies with persistent UUID and optional name
  socket.on('student-identify', ({ id, name }) => {
    if (role !== 'student') return;
    studentPersistentId = id;
    let student = students.get(id);
    if (student) {
      // Returning student — update socket and name if provided
      student.socketId = socket.id;
      if (name) student.name = name;
    } else {
      // New student
      studentCounter++;
      student = {
        id,
        name: name || `Student ${studentCounter}`,
        state: 'idle',
        socketId: socket.id,
        timestamp: null,
      };
      students.set(id, student);
    }
    // Tell the student their assigned name and current state
    socket.emit('student-name', student.name);
    socket.emit('student-state-restore', student.state);
    broadcastStudentList();
  });

  // Student changes check-in status
  socket.on('student-status', ({ state }) => {
    if (role !== 'student' || !studentPersistentId) return;
    const student = students.get(studentPersistentId);
    if (!student) return;
    if (!['idle', 'working', 'done', 'away'].includes(state)) return;
    student.state = state;
    student.timestamp = Date.now();
    broadcastStudentList();
  });

  socket.on('disconnect', () => {
    if (role === 'student' && validated) {
      connectedStudents--;
      io.to('instructor').emit('client-count', connectedStudents);
      // Don't remove from students map — they may reconnect.
      // Just clear the socketId so instructor can see they're disconnected if needed.
      if (studentPersistentId && students.has(studentPersistentId)) {
        students.get(studentPersistentId).socketId = null;
      }
    }
  });

  // ── Instructor-only: generate new class code ──
  socket.on('generate-code', async () => {
    if (role !== 'instructor') return;
    classCode = generateCode();
    await saveClassCode(classCode);
    // Disconnect all students
    io.to('students').emit('code-expired');
    io.in('students').disconnectSockets(true);
    connectedStudents = 0;
    // Clear student tracking
    students.clear();
    studentCounter = 0;
    // Notify instructor
    io.to('instructor').emit('class-code', classCode);
    io.to('instructor').emit('client-count', connectedStudents);
    broadcastStudentList();
  });

  // ── Instructor-only: reset student check-in states ──
  socket.on('reset-student-states', () => {
    if (role !== 'instructor') return;
    resetAllStudentStates();
  });

  // ── Instructor-only: toggle check-in buttons on student phones ──
  socket.on('set-checkin-enabled', (enabled) => {
    if (role !== 'instructor') return;
    checkinEnabled = !!enabled;
    io.to('instructor').emit('checkin-enabled', checkinEnabled);
    io.to('students').emit('checkin-enabled', checkinEnabled);
  });

  // ── Instructor-only: mute/unmute student updates ──
  socket.on('set-mute', (isMuted) => {
    if (role !== 'instructor') return;
    muted = !!isMuted;
    io.to('instructor').emit('mute-state', muted);
    if (!muted) {
      // Unmuting — push current state to all students
      io.to('students').emit('timer-update', timerState);
    }
  });

  socket.on('set-timer', ({ minutes, label, message, showEndTime, transparent, blackBg, clockOnly }) => {
    const secs = Math.max(0, Math.round(minutes * 60));
    timerState.totalSeconds = secs;
    timerState.originalTotal = secs;
    timerState.remainingSeconds = secs;
    timerState.label = label || '';
    timerState.message = message || '';
    timerState.showEndTime = showEndTime !== false;
    timerState.transparent = !!transparent;
    timerState.blackBg = !!blackBg;
    timerState.clockOnly = !!clockOnly;
    timerState.running = false;
    timerState.endTime = null;
    timerState.endTimeFormatted = '';
    stopTick();
    broadcast();
  });

  // Set timer duration only — does not touch label or message
  socket.on('set-timer-only', ({ minutes, showEndTime }) => {
    const secs = Math.max(0, Math.round(minutes * 60));
    timerState.totalSeconds = secs;
    timerState.originalTotal = secs;
    timerState.remainingSeconds = secs;
    timerState.showEndTime = showEndTime !== false;
    timerState.running = false;
    timerState.endTime = null;
    timerState.endTimeFormatted = '';
    stopTick();
    broadcast();
  });

  socket.on('start', () => {
    if (timerState.totalSeconds > 0 && !timerState.running) {
      timerState.running = true;
      // Snapshot for restore feature
      lastTimer = {
        label: timerState.label,
        message: timerState.message,
        originalTotal: timerState.originalTotal,
        remainingSeconds: timerState.remainingSeconds,
        showEndTime: timerState.showEndTime,
        endTimeLabel: timerState.endTimeLabel,
        endTime: Date.now() + timerState.remainingSeconds * 1000,
      };
      startTick();
      broadcast();
      io.to('instructor').emit('last-timer', lastTimer);
    }
  });

  socket.on('pause', () => {
    if (timerState.running) {
      timerState.running = false;
      timerState.endTime = null;
      timerState.endTimeFormatted = '';
      stopTick();
      // Update lastTimer with current remaining so restore resumes from here
      if (lastTimer) {
        lastTimer.remainingSeconds = timerState.remainingSeconds;
      }
      broadcast();
    }
  });

  socket.on('reset', () => {
    timerState.remainingSeconds = timerState.totalSeconds;
    timerState.running = false;
    timerState.endTime = null;
    timerState.endTimeFormatted = '';
    stopTick();
    broadcast();
  });

  socket.on('add-time', ({ minutes }) => {
    const extra = Math.round(minutes * 60);
    timerState.totalSeconds += extra;
    timerState.originalTotal += extra;
    timerState.remainingSeconds += extra;
    if (timerState.running && timerState.endTime) {
      timerState.endTime += extra * 1000;
      // Update lastTimer snapshot too
      if (lastTimer) {
        lastTimer.endTime += extra * 1000;
        lastTimer.originalTotal += extra;
      }
    }
    broadcast();
  });

  socket.on('stop', () => {
    // Save remaining time before clearing so restore can resume
    if (lastTimer && timerState.remainingSeconds > 0) {
      lastTimer.remainingSeconds = timerState.remainingSeconds;
    }
    timerState.totalSeconds = 0;
    timerState.originalTotal = 0;
    timerState.remainingSeconds = 0;
    timerState.running = false;
    timerState.endTime = null;
    timerState.endTimeFormatted = '';
    timerState.label = '';
    timerState.message = '';
    timerState.endTimeLabel = '';
    timerState.showEndTime = false;
    stopTick();
    // Stop clears any active sequence
    clearSequenceState();
    broadcastSequenceState();
    broadcast();
  });

  socket.on('update-message', ({ message }) => {
    timerState.message = message || '';
    broadcast();
  });

  socket.on('update-label', ({ label }) => {
    timerState.label = label || '';
    broadcast();
  });

  socket.on('update-end-time-label', ({ endTimeLabel }) => {
    timerState.endTimeLabel = endTimeLabel || 'Class resumes at';
    broadcast();
  });

  socket.on('update-course-title', ({ courseTitle }) => {
    timerState.courseTitle = courseTitle || '';
    broadcast();
  });

  socket.on('update-display-modes', ({ transparent, blackBg, clockOnly }) => {
    timerState.transparent = !!transparent;
    timerState.blackBg = !!blackBg;
    timerState.clockOnly = !!clockOnly;
    broadcast();
  });

  socket.on('update-show-end-time', ({ showEndTime }) => {
    timerState.showEndTime = showEndTime !== false;
    broadcast();
  });

  // Restore last timer — resume from where it was paused/stopped
  socket.on('restore-last-timer', () => {
    if (!lastTimer || lastTimer.remainingSeconds <= 0) return;
    const remaining = lastTimer.remainingSeconds;
    const now = Date.now();
    const newEndTime = now + remaining * 1000;
    timerState.label = lastTimer.label;
    timerState.message = lastTimer.message;
    timerState.originalTotal = lastTimer.originalTotal;
    timerState.totalSeconds = lastTimer.originalTotal;
    timerState.remainingSeconds = remaining;
    timerState.showEndTime = lastTimer.showEndTime;
    timerState.endTimeLabel = lastTimer.endTimeLabel;
    timerState.running = true;
    timerState.endTime = newEndTime;
    timerState.endTimeFormatted = formatEndTime(newEndTime);
    startTick();
    broadcast();
  });

  // ── Sequence playback ──
  socket.on('start-sequence', ({ sequenceId }) => {
    if (role !== 'instructor') return;
    // Stop any currently running timer/sequence first
    stopTick();
    timerState.running = false;
    clearSequenceState();
    const seq = sequences.find(s => s.id === sequenceId);
    if (!seq || !seq.steps || seq.steps.length === 0) return;
    // Resolve library item IDs to timer data snapshots
    const resolvedSteps = seq.steps.map(step => {
      const libItem = library.find(t => t.id === step.timerId);
      if (!libItem) return null;
      return {
        timerId: libItem.id,
        label: libItem.label || libItem.name || '',
        message: libItem.message || '',
        totalSeconds: Math.max(0, Math.round((libItem.minutes || 0) * 60)),
        showEndTime: libItem.showEndTime !== false,
      };
    }).filter(Boolean);
    if (resolvedSteps.length === 0) return;
    clearSequenceState();
    activeSequence = {
      id: seq.id,
      name: seq.name,
      autoAdvance: seq.autoAdvance !== false,
      steps: resolvedSteps,
      currentIndex: 0,
    };
    // Load first step (but don't auto-start — instructor hits play)
    loadSequenceStep(0);
  });

  socket.on('skip-sequence-step', () => {
    if (role !== 'instructor' || !activeSequence) return;
    stopTick();
    timerState.running = false;
    timerState.endTime = null;
    timerState.endTimeFormatted = '';
    // Clear any pending auto-advance
    if (sequenceAdvanceTimeout) {
      clearTimeout(sequenceAdvanceTimeout);
      sequenceAdvanceTimeout = null;
    }
    const nextIndex = activeSequence.currentIndex + 1;
    if (nextIndex >= activeSequence.steps.length) {
      clearSequenceState();
      broadcastSequenceState();
      broadcast();
    } else {
      loadSequenceStep(nextIndex);
    }
  });

  socket.on('stop-sequence', () => {
    if (role !== 'instructor') return;
    clearSequenceState();
    // Stop the current timer too
    stopTick();
    timerState.running = false;
    timerState.endTime = null;
    timerState.endTimeFormatted = '';
    broadcastSequenceState();
    broadcast();
  });

  // Send sequence state when instructor connects
  socket.on('get-sequence-state', () => {
    if (role !== 'instructor') return;
    broadcastSequenceState();
  });

});

// ── Start ────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

(async () => {
  await connectMongo();
  library = await loadLibrary();
  savedOrders = await loadSavedOrders();
  sequences = await loadSequences();
  classCode = await loadClassCode() || generateCode();
  await saveClassCode(classCode);
  server.listen(PORT, () => {
    console.log(`\n  Classroom Timer is running!`);
    console.log(`   Instructor panel : http://localhost:${PORT}/instructor`);
    console.log(`   Student view     : http://localhost:${PORT}/`);
    console.log(`\n   Share the student URL (or QR code) with your class.\n`);
  });
})();
