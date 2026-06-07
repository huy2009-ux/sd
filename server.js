require('dotenv').config();
const express = require('express');
const session = require('express-session');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');

// ── MONGODB CONNECT ──
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

// ── SCHEMAS ──
const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  name:  { type: String, required: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model('User', userSchema);

const friendSchema = new mongoose.Schema({
  email:    { type: String, unique: true },
  friends:  [String],
  sent:     [String],
  received: [String],
});
const Friend = mongoose.model('Friend', friendSchema);

const messageSchema = new mongoose.Schema({
  key:  String, // "emailA|emailB" sorted
  from: String,
  text: String,
  time: { type: Date, default: Date.now },
});
const Message = mongoose.model('Message', messageSchema);

const postSchema = new mongoose.Schema({
  authorEmail: String,
  authorName:  String,
  text:        { type: String, default: '' },
  image:       { type: String, default: null },
  visibility:  { type: String, default: 'friends' },
  likes:       [String],
  createdAt:   { type: Date, default: Date.now },
});
const Post = mongoose.model('Post', postSchema);

// ── APP SETUP ──
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

// Ensure avatars & post-images dirs
const AVATARS_DIR = path.join(__dirname, 'public', 'avatars');
const POSTS_IMG_DIR = path.join(__dirname, 'public', 'post-images');
if (!fs.existsSync(AVATARS_DIR)) fs.mkdirSync(AVATARS_DIR, { recursive: true });
if (!fs.existsSync(POSTS_IMG_DIR)) fs.mkdirSync(POSTS_IMG_DIR, { recursive: true });

const otpStore = {};
const onlineUsers = {};

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.BREVO_USER,
    pass: process.env.BREVO_PASS,
  },
});
async function sendOTP(email, otp) {
  await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': process.env.BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: { name: 'MailBox', email: 'quanghuy2009s@gmail.com' },
      to: [{ email }],
      subject: '🔐 Mã xác thực OTP',
      htmlContent: `<div style="font-family:sans-serif;max-width:400px;margin:auto;padding:30px;border:1px solid #eee;border-radius:12px"><h2>Mã OTP</h2><div style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#e94560;text-align:center;padding:20px;background:#f5f5f5;border-radius:8px;margin:20px 0">${otp}</div><p style="color:#888;font-size:13px">Hiệu lực 5 phút.</p></div>`,
    }),
  });
}
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 86400000 },
});
app.use(sessionMiddleware);

function generateOTP() { return Math.floor(100000 + Math.random() * 900000).toString(); }

// ── AUTH ──
app.post('/api/register/send-otp', async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.json({ success: false, message: 'Điền đầy đủ thông tin.' });
  const exists = await User.findOne({ email });
  if (exists) return res.json({ success: false, message: 'Email đã đăng ký.' });
  const otp = generateOTP();
  otpStore[email] = { otp, expires: Date.now() + 5 * 60 * 1000, name, password };
  try {
    await sendOTP(email, otp);
    res.json({ success: true, message: 'OTP đã gửi!' });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: 'Không thể gửi email. Kiểm tra lại Gmail.' });
  }
});

app.post('/api/register/verify-otp', async (req, res) => {
  const { email, otp } = req.body;
  const record = otpStore[email];
  if (!record) return res.json({ success: false, message: 'Không tìm thấy OTP.' });
  if (Date.now() > record.expires) { delete otpStore[email]; return res.json({ success: false, message: 'OTP hết hạn.' }); }
  if (record.otp !== otp) return res.json({ success: false, message: 'Mã OTP sai.' });
  const hashed = await bcrypt.hash(record.password, 10);
  await User.create({ email, name: record.name, password: hashed });
  delete otpStore[email];
  req.session.user = { email, name: record.name };
  res.json({ success: true });
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.json({ success: false, message: 'Email không tồn tại.' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ success: false, message: 'Mật khẩu sai.' });
  req.session.user = { email: user.email, name: user.name };
  res.json({ success: true });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/me', (req, res) => {
  if (req.session.user) res.json({ loggedIn: true, user: req.session.user });
  else res.json({ loggedIn: false });
});

// ── PROFILE ──
app.post('/api/profile', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const { name, avatar } = req.body;
  if (!name || !name.trim()) return res.json({ success: false, message: 'Tên không được để trống.' });
  const email = req.session.user.email;
  await User.updateOne({ email }, { name: name.trim() });
  if (avatar && avatar.startsWith('data:image/')) {
    const base64Data = avatar.replace(/^data:image\/\w+;base64,/, '');
    const safeFilename = email.replace(/[^a-z0-9]/gi, '_') + '.png';
    fs.writeFileSync(path.join(AVATARS_DIR, safeFilename), Buffer.from(base64Data, 'base64'));
  }
  req.session.user.name = name.trim();
  res.json({ success: true });
});

app.get('/api/avatar/:email', (req, res) => {
  const safeFilename = req.params.email.replace(/[^a-z0-9]/gi, '_') + '.png';
  const avatarPath = path.join(AVATARS_DIR, safeFilename);
  if (fs.existsSync(avatarPath)) res.sendFile(avatarPath);
  else res.status(404).end();
});

// ── USERS ──
app.get('/api/users', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const users = await User.find({}, 'email name');
  res.json({ success: true, users: users.map(u => ({ email: u.email, name: u.name, online: !!onlineUsers[u.email] })) });
});

// ── FRIENDS ──
async function getFriendDoc(email) {
  let doc = await Friend.findOne({ email });
  if (!doc) doc = await Friend.create({ email, friends: [], sent: [], received: [] });
  return doc;
}

app.get('/api/friends', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const myEmail = req.session.user.email;
  const data = await getFriendDoc(myEmail);
  const enrich = async (email) => {
    const u = await User.findOne({ email }, 'name');
    return { email, name: u ? u.name : email, online: !!onlineUsers[email] };
  };
  res.json({
    success: true,
    friends:  await Promise.all(data.friends.map(enrich)),
    sent:     await Promise.all(data.sent.map(enrich)),
    received: await Promise.all(data.received.map(enrich)),
  });
});

app.post('/api/friends/request', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const from = req.session.user.email;
  const { to } = req.body;
  if (from === to) return res.json({ success: false, message: 'Không thể tự kết bạn.' });
  const fromDoc = await getFriendDoc(from);
  const toDoc   = await getFriendDoc(to);
  if (fromDoc.friends.includes(to)) return res.json({ success: false, message: 'Đã là bạn bè.' });
  if (fromDoc.sent.includes(to))    return res.json({ success: false, message: 'Đã gửi lời mời.' });
  fromDoc.sent.push(to);   await fromDoc.save();
  toDoc.received.push(from); await toDoc.save();
  const fromUser = await User.findOne({ email: from }, 'name');
  if (onlineUsers[to]) io.to(onlineUsers[to]).emit('friend_request', { from, name: fromUser?.name || from });
  res.json({ success: true });
});

app.post('/api/friends/accept', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const me = req.session.user.email;
  const { from } = req.body;
  const meDoc   = await getFriendDoc(me);
  const fromDoc = await getFriendDoc(from);
  meDoc.received   = meDoc.received.filter(e => e !== from);
  fromDoc.sent     = fromDoc.sent.filter(e => e !== me);
  meDoc.friends.push(from);
  fromDoc.friends.push(me);
  await meDoc.save(); await fromDoc.save();
  const meUser = await User.findOne({ email: me }, 'name');
  if (onlineUsers[from]) io.to(onlineUsers[from]).emit('friend_accepted', { from: me, name: meUser?.name || me });
  res.json({ success: true });
});

app.post('/api/friends/decline', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const me = req.session.user.email;
  const { from } = req.body;
  const meDoc   = await getFriendDoc(me);
  const fromDoc = await getFriendDoc(from);
  meDoc.received   = meDoc.received.filter(e => e !== from);
  fromDoc.sent     = fromDoc.sent.filter(e => e !== me);
  await meDoc.save(); await fromDoc.save();
  res.json({ success: true });
});

// ── MESSAGES ──
app.get('/api/messages/:friendEmail', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const me = req.session.user.email;
  const friend = req.params.friendEmail;
  const key = [me, friend].sort().join('|');
  const msgs = await Message.find({ key }).sort({ time: 1 }).limit(200);
  res.json({ success: true, messages: msgs.map(m => ({ from: m.from, text: m.text, time: m.time })) });
});

// ── SOCKET.IO ──
io.use((socket, next) => { sessionMiddleware(socket.request, {}, next); });

io.on('connection', async (socket) => {
  const user = socket.request.session?.user;
  if (!user) return socket.disconnect();
  onlineUsers[user.email] = socket.id;
  io.emit('user_online', { email: user.email });

  socket.on('send_message', async ({ to, text }) => {
    const from = user.email;
    const key = [from, to].sort().join('|');
    const msg = await Message.create({ key, from, text });
    if (onlineUsers[to]) io.to(onlineUsers[to]).emit('new_message', { from, text, time: msg.time });
    socket.emit('new_message', { from, text, time: msg.time });
  });

  // ── WEBRTC SIGNALING ──
  socket.on('call:request', async ({ to, type }) => {
    const fromUser = await User.findOne({ email: user.email }, 'name');
    if (onlineUsers[to]) io.to(onlineUsers[to]).emit('call:incoming', { from: user.email, name: fromUser?.name || user.email, type });
    else socket.emit('call:unavailable', { to });
  });
  socket.on('call:accept',  ({ to }) => { if (onlineUsers[to]) io.to(onlineUsers[to]).emit('call:accepted',  { from: user.email }); });
  socket.on('call:decline', ({ to }) => { if (onlineUsers[to]) io.to(onlineUsers[to]).emit('call:declined',  { from: user.email }); });
  socket.on('call:end',     ({ to }) => { if (onlineUsers[to]) io.to(onlineUsers[to]).emit('call:ended',     { from: user.email }); });
  socket.on('call:offer',   ({ to, offer })      => { if (onlineUsers[to]) io.to(onlineUsers[to]).emit('call:offer',   { from: user.email, offer }); });
  socket.on('call:answer',  ({ to, answer })     => { if (onlineUsers[to]) io.to(onlineUsers[to]).emit('call:answer',  { from: user.email, answer }); });
  socket.on('call:ice',     ({ to, candidate })  => { if (onlineUsers[to]) io.to(onlineUsers[to]).emit('call:ice',     { from: user.email, candidate }); });

  socket.on('disconnect', () => {
    delete onlineUsers[user.email];
    io.emit('user_offline', { email: user.email });
  });
});

// ── POSTS ──
app.post('/api/posts', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const { text, image, visibility } = req.body;
  if (!text && !image) return res.json({ success: false, message: 'Bài đăng trống.' });
  const allowed = ['public', 'friends', 'private'];
  const vis = allowed.includes(visibility) ? visibility : 'friends';
  let imagePath = null;
  if (image && image.startsWith('data:image/')) {
    const base64 = image.replace(/^data:image\/\w+;base64,/, '');
    const filename = `post_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
    fs.writeFileSync(path.join(POSTS_IMG_DIR, filename), Buffer.from(base64, 'base64'));
    imagePath = `/post-images/${filename}`;
  }
  const post = await Post.create({
    authorEmail: req.session.user.email,
    authorName:  req.session.user.name,
    text: text || '',
    image: imagePath,
    visibility: vis,
  });
  res.json({ success: true, post });
});

app.get('/api/posts', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const me = req.session.user.email;
  const friendDoc = await getFriendDoc(me);
  const myFriends = friendDoc.friends || [];
  const posts = await Post.find({
    $or: [
      { visibility: 'public' },
      { authorEmail: me },
      { visibility: 'friends', authorEmail: { $in: myFriends } },
    ]
  }).sort({ createdAt: -1 }).limit(50);
  res.json({ success: true, posts });
});

app.post('/api/posts/:id/like', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const me = req.session.user.email;
  const post = await Post.findById(req.params.id);
  if (!post) return res.json({ success: false });
  const idx = post.likes.indexOf(me);
  let liked;
  if (idx === -1) { post.likes.push(me); liked = true; }
  else { post.likes.splice(idx, 1); liked = false; }
  await post.save();
  res.json({ success: true, liked, likeCount: post.likes.length });
});

app.delete('/api/posts/:id', async (req, res) => {
  if (!req.session.user) return res.json({ success: false });
  const post = await Post.findById(req.params.id);
  if (!post || post.authorEmail !== req.session.user.email) return res.json({ success: false });
  if (post.image) {
    const imgFile = path.join(__dirname, 'public', post.image);
    if (fs.existsSync(imgFile)) fs.unlinkSync(imgFile);
  }
  await Post.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

server.listen(PORT, () => console.log(`\n✅ Server chạy tại: http://localhost:${PORT}\n`));
