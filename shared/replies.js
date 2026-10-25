'use strict';

// The public reply posted under every matching comment, on every reel. Edit this list to change them.
const PUBLIC_REPLIES = [
  'Check your DMs! 📩',
  'DM sent! 💌',
  'Check your inbox 📬',
  'Just sent it to your DMs ✨',
  'Sent! Peek at your DMs 👀',
  "It's in your inbox 📥",
  'Check your messages 💬',
  'Done! Check your DMs 🙌',
  'Sent you a DM 📨',
  'Your DM is waiting 📩',
  'Sent! Check your DMs (or Requests) 📩',
  'On its way to your inbox 🚀',
];

// Random pick that never repeats the previous reply.
function pickReply(last, rand = Math.random, replies = PUBLIC_REPLIES) {
  const pool = replies.length > 1 ? replies.filter((r) => r !== last) : replies;
  return pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
}

module.exports = { PUBLIC_REPLIES, pickReply };
