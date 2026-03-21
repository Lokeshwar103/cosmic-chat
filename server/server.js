require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const nodemailer = require("nodemailer");
const path = require("path");
const cors = require("cors"); // ✅ added

const User = require("../models/User");
const Message = require("../models/Message");

const app = express();
const server = http.createServer(app);

// ✅ FIXED Socket.IO CORS
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(cors()); // ✅ added
app.use(express.static(path.join(__dirname, "../public")));

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

// ✅ ENV safety check
if (!process.env.MONGO_URI || !process.env.JWT_SECRET) {
  console.log("❌ Missing environment variables");
  process.exit(1);
}

// =======================
// MongoDB Connection
// =======================

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err.message));

// =======================
// Email Transporter
// =======================

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// =======================
// OTP Generator
// =======================

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// =======================
// Register
// =======================

app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const otp = generateOTP();

    const user = new User({
      username,
      email,
      password: hashed,
      otp,
      verified: false
    });

    await user.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Cosmic Chat OTP Verification",
      text: `Your OTP is: ${otp}`
    });

    res.json({ message: "OTP sent to email" });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Server error" });
  }
});

// =======================
// Verify OTP
// =======================

app.post("/api/auth/verify", async (req, res) => {
  const { email, otp } = req.body;

  const user = await User.findOne({ email });

  if (!user) return res.status(404).json({ message: "User not found" });

  if (user.otp !== otp)
    return res.status(400).json({ message: "Invalid OTP" });

  user.verified = true;
  user.otp = null;

  await user.save();

  res.json({ message: "Account verified" });
});

// =======================
// Login
// =======================

app.post("/api/auth/login", async (req, res) => {

  const { email, password } = req.body;

  const user = await User.findOne({ email });

  if (!user)
    return res.status(404).json({ message: "User not found" });

  if (!user.verified)
    return res.status(400).json({ message: "Verify OTP first" });

  const valid = await bcrypt.compare(password, user.password);

  if (!valid)
    return res.status(400).json({ message: "Wrong password" });

  const token = jwt.sign({ id: user._id }, JWT_SECRET);

  res.json({ token, username: user.username });
});

// =======================
// Socket.IO Chat
// =======================

let onlineUsers = {};

io.on("connection", socket => {

  socket.on("join", username => {

    onlineUsers[username] = socket.id;

    io.emit("onlineUsers", Object.keys(onlineUsers));
  });

  socket.on("sendMessage", async data => {

    const msg = new Message(data);
    await msg.save();

    io.emit("receiveMessage", data);
  });

  socket.on("privateMessage", data => {

    const targetSocket = onlineUsers[data.to];

    if (targetSocket) {
      io.to(targetSocket).emit("receivePrivate", data);
    }

  });

  socket.on("disconnect", () => {

    for (let user in onlineUsers) {
      if (onlineUsers[user] === socket.id) {
        delete onlineUsers[user];
      }
    }

    io.emit("onlineUsers", Object.keys(onlineUsers));
  });

});

// =======================
// Start Server
// =======================

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});