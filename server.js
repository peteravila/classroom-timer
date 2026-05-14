// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

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

// ── Instructor Authentication ────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'livetimer-dev-secret-change-in-production';
const SALT_ROUNDS = 10;

async function createInstructor(email, password, name, isAdmin = false) {
  if (!db) throw new Error('Database not available');
  const existing = await db.collection('instructors').findOne({ email: email.toLowerCase() });
  if (existing) throw new Error('An account with this email already exists');
  const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
  const instructor = {
    email: email.toLowerCase(),
    password: hashedPassword,
    name: name || email.split('@')[0],
    isAdmin: !!isAdmin,
    createdAt: new Date(),
  };
  const result = await db.collection('instructors').insertOne(instructor);
  instructor._id = result.insertedId;
  return instructor;
}

async function authenticateInstructor(email, password) {
  if (!db) throw new Error('Database not available');
  const instructor = await db.collection('instructors').findOne({ email: email.toLowerCase() });
  if (!instructor) throw new Error('Invalid email or password');
  const valid = await bcrypt.compare(password, instructor.password);
  if (!valid) throw new Error('Invalid email or password');
  return instructor;
}

function generateToken(instructor) {
  return jwt.sign(
    { id: instructor._id.toString(), email: instructor.email, name: instructor.name, isAdmin: !!instructor.isAdmin },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
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

// ── Timer state persistence (MongoDB) ───────────────────────
async function saveTimerState() {
  if (!db) return;
  try {
    await db.collection('settings').updateOne(
      { _id: 'timerState' },
      { $set: {
        timer: { ...timerState },
        lastTimer: lastTimer ? { ...lastTimer } : null,
        updatedAt: new Date()
      }},
      { upsert: true }
    );
  } catch (e) {
    console.error('  MongoDB saveTimerState failed:', e.message);
  }
}

async function loadTimerState() {
  if (!db) return null;
  try {
    return await db.collection('settings').findOne({ _id: 'timerState' });
  } catch (e) {
    console.error('  MongoDB loadTimerState failed:', e.message);
    return null;
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
    currentLabel: activeSequence.steps[activeSequence.currentIndex].label,
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
  saveTimerState();
  return true;
}

function autoStartTimer() {
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
  saveTimerState();
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
  const nextStep = activeSequence.steps[nextIndex];
  // Stop the old timer tick so it doesn't keep broadcasting negative values
  stopTick();
  timerState.running = false;
  if (nextStep.autoStart !== false) {
    // Notify clients of upcoming timer
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
        autoStartTimer();
      }
    }, 3000);
  } else {
    // Manual — load but don't start
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

// ── Auth endpoints ──────────────────────────────────────────
app.post('/api/signup', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const instructor = await createInstructor(email, password, name);
    const token = generateToken(instructor);
    res.json({ token, name: instructor.name, email: instructor.email });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const instructor = await authenticateInstructor(email, password);
    const token = generateToken(instructor);
    res.json({ token, name: instructor.name, email: instructor.email });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

app.get('/api/me', (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  const payload = verifyToken(auth.slice(7));
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  res.json({ name: payload.name, email: payload.email, isAdmin: !!payload.isAdmin });
});

// ── Change password ─────────────────────────────────────────
app.post('/api/change-password', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  const payload = verifyToken(auth.slice(7));
  if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  try {
    const instructor = await db.collection('instructors').findOne({ email: payload.email });
    if (!instructor) return res.status(404).json({ error: 'Account not found' });
    const valid = await bcrypt.compare(currentPassword, instructor.password);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    const hashedNew = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.collection('instructors').updateOne({ _id: instructor._id }, { $set: { password: hashedNew } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ── Admin: reset any instructor's password ──────────────────
app.post('/api/admin/reset-password', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  const payload = verifyToken(auth.slice(7));
  if (!payload || !payload.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  const { email, newPassword } = req.body;
  if (!email || !newPassword) return res.status(400).json({ error: 'Email and new password required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const instructor = await db.collection('instructors').findOne({ email: email.toLowerCase() });
    if (!instructor) return res.status(404).json({ error: 'No account found with that email' });
    const hashedNew = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.collection('instructors').updateOne({ _id: instructor._id }, { $set: { password: hashedNew } });
    res.json({ success: true, email: instructor.email });
  } catch (e) {
    res.status(500).json({ error: 'Failed to reset password' });
  }
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

// QR-only page — standalone OBS browser source for QR code display
// Responsive: scales to fill whatever browser source dimensions are set in OBS.
// Use large dimensions (e.g. 800×1000) for a dedicated full-screen QR scene,
// or small dimensions (e.g. 300×400) for a compact overlay. Same URL for both.
app.get('/qr-only', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LiveTimer QR Code</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a2e;
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    padding: 5%;
  }
  .qr-container {
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .scan-label {
    font-size: clamp(1.5rem, 4.5vw, 3rem);
    color: rgba(255,255,255,0.65);
    margin-bottom: 3%;
    max-width: 90%;
    line-height: 1.3;
    text-align: center;
  }
  .qr-image img {
    border-radius: 8px;
    background: #fff;
    padding: 6px;
    width: clamp(150px, 40vmin, 500px);
    height: auto;
  }
  .hint {
    font-size: clamp(1.2rem, 3.5vw, 2.2rem);
    color: rgba(255,255,255,0.6);
    margin-top: 4%;
    max-width: 90%;
    line-height: 1.4;
    text-align: center;
  }
  .hint b { color: rgba(255,255,255,0.75); display: block; margin-top: 0.5em; }
  .class-code {
    font-size: clamp(2.4rem, 7vw, 6rem);
    font-weight: 800;
    letter-spacing: 0.3em;
    color: rgba(255,255,255,0.85);
    font-family: monospace;
    margin-top: 4%;
    text-align: center;
  }
</style>
</head>
<body>
<div class="qr-container">
  <div class="scan-label">Scan to connect to LiveTimer</div>
  <div class="qr-image" id="qrImg"></div>
  <div class="hint" id="qrHint"></div>
  <div class="class-code" id="classCode"></div>
</div>
<script src="/socket.io/socket.io.js"></script>
<script>
  function loadQR() {
    fetch('/qr').then(r => r.json()).then(data => {
      document.getElementById('qrImg').innerHTML = '<img src="' + data.qr + '" alt="QR code">';
      document.getElementById('classCode').textContent = data.code;
      const baseUrl = data.url.replace(/\\?.*$/, '');
      document.getElementById('qrHint').innerHTML = "Can't scan? Go to<br><b>" + baseUrl + "</b>";
    }).catch(() => {});
  }
  loadQR();

  // Auto-update when class code changes
  const socket = io();
  socket.on('connect', () => { socket.emit('identify', 'preview'); });
  socket.on('class-code', () => { loadQR(); });
</script>
</body>
</html>`);
});

// ── Socket.io ────────────────────────────────────────────────
let connectedStudents = 0;

io.on('connection', (socket) => {
  let role = 'pending'; // pending | student | instructor | preview
  let validated = false;
  let studentPersistentId = null; // UUID from student's localStorage

  socket.on('identify', (r) => {
    if (r === 'instructor') {
      // Verify auth token
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const payload = token ? verifyToken(token) : null;
      if (!payload) {
        socket.emit('connect_error', { message: 'Authentication required' });
        socket.disconnect(true);
        return;
      }
      role = 'instructor';
      validated = true;
      socket.instructorId = payload.id;
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
    saveTimerState();
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
    saveTimerState();
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
      saveTimerState();
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
      saveTimerState();
    }
  });

  socket.on('reset', () => {
    timerState.remainingSeconds = timerState.totalSeconds;
    timerState.running = false;
    timerState.endTime = null;
    timerState.endTimeFormatted = '';
    stopTick();
    broadcast();
    saveTimerState();
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
    saveTimerState();
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
    saveTimerState();
  });

  socket.on('update-message', ({ message }) => {
    timerState.message = message || '';
    broadcast();
    saveTimerState();
  });

  socket.on('update-label', ({ label }) => {
    timerState.label = label || '';
    broadcast();
    saveTimerState();
  });

  socket.on('update-end-time-label', ({ endTimeLabel }) => {
    timerState.endTimeLabel = endTimeLabel || 'Class resumes at';
    broadcast();
    saveTimerState();
  });

  socket.on('update-course-title', ({ courseTitle }) => {
    timerState.courseTitle = courseTitle || '';
    broadcast();
    saveTimerState();
  });

  socket.on('update-display-modes', ({ transparent, blackBg, clockOnly }) => {
    timerState.transparent = !!transparent;
    timerState.blackBg = !!blackBg;
    timerState.clockOnly = !!clockOnly;
    broadcast();
    saveTimerState();
  });

  socket.on('update-show-end-time', ({ showEndTime }) => {
    timerState.showEndTime = showEndTime !== false;
    broadcast();
    saveTimerState();
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
    saveTimerState();
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
        autoStart: step.autoStart !== false,
      };
    }).filter(Boolean);
    if (resolvedSteps.length === 0) return;
    clearSequenceState();
    activeSequence = {
      id: seq.id,
      name: seq.name,
      steps: resolvedSteps,
      currentIndex: 0,
    };
    // Load first step
    loadSequenceStep(0);
    // Auto-start if the first step says so
    if (resolvedSteps[0].autoStart !== false) {
      autoStartTimer();
    }
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
      saveTimerState();
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
    saveTimerState();
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

  // Ensure at least one instructor account exists (seed)
  if (db) {
    const count = await db.collection('instructors').countDocuments();
    if (count === 0) {
      console.log('  No instructor accounts found — creating seed account.');
      console.log('  Email: peterpsavila@gmail.com');
      console.log('  Password: livetimer (change this after first login!)');
      try {
        await createInstructor('peterpsavila@gmail.com', 'livetimer', 'Peter', true);
      } catch (e) {
        console.error('  Failed to create seed account:', e.message);
      }
    }
  }

  // Recover timer state from MongoDB
  const savedState = await loadTimerState();
  if (savedState) {
    if (savedState.timer) {
      Object.assign(timerState, savedState.timer);
      if (timerState.running && timerState.endTime) {
        const remaining = Math.round((timerState.endTime - Date.now()) / 1000);
        if (remaining > 0) {
          timerState.remainingSeconds = remaining;
          startTick();
          console.log(`  Recovered running timer: ${remaining}s remaining`);
        } else {
          // Timer expired while server was down
          timerState.running = false;
          timerState.remainingSeconds = 0;
          timerState.endTime = null;
          timerState.endTimeFormatted = '';
          console.log('  Timer had expired during downtime — cleared.');
          await saveTimerState();
        }
      } else {
        console.log('  Recovered timer state (not running).');
      }
    }
    if (savedState.lastTimer) {
      lastTimer = savedState.lastTimer;
    }
  }

  server.listen(PORT, () => {
    console.log(`\n  Classroom Timer is running!`);
    console.log(`   Instructor panel : http://localhost:${PORT}/instructor`);
    console.log(`   Student view     : http://localhost:${PORT}/`);
    console.log(`\n   Share the student URL (or QR code) with your class.\n`);
  });
})();
