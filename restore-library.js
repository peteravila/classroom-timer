// One-time script: restore library from timer-library.json to MongoDB
// Usage: node restore-library.js
// Delete this file after running.

require('dotenv').config();
const { MongoClient } = require('mongodb');
const fs = require('fs');

(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('No MONGODB_URI in .env'); process.exit(1); }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  // Find Peter's instructor ID
  const peter = await db.collection('instructors').findOne({ isAdmin: true });
  if (!peter) { console.error('No admin instructor found.'); await client.close(); process.exit(1); }
  const peterId = peter._id.toString();
  console.log('Instructor:', peter.email, '→', peterId);

  // Read JSON backup
  const timers = JSON.parse(fs.readFileSync('timer-library.json', 'utf8'));
  console.log('Timers in backup:', timers.length);

  // Write to MongoDB
  await db.collection('libraries').updateOne(
    { _id: peterId },
    { $set: { timers, updatedAt: new Date() } },
    { upsert: true }
  );
  console.log('Restored', timers.length, 'timers to MongoDB.');

  await client.close();
})();
