require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const nodemailer = require("nodemailer");
const path = require("path");
const cors = require("cors");

const User = require(__dirname + "/models/User");
const Message = require(__dirname + "/models/Message");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/splash.html"));
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;

// ✅ FIXED ENV CHECK
if (
  !process.env.MONGO_URI ||
  !process.env.JWT_SECRET ||
  !process.env.EMAIL_USER ||
  !process.env.EMAIL_PASS
) {
  console.log("❌ Missing environment variables");
  process.exit(1);
}

// =======================
// MongoDB
// =======================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch(err => console.log("❌ MongoDB Error:", err.message));

// =======================
// EMAIL (FIXED)
// =======================
const transporter = nodemailer.createTransport({
  host: "smtp-relay.brevo.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ✅ Check transporter
transporter.verify((err, success) => {
  if (err) {
    console.log("❌ Email config error:", err.message);
  } else {
    console.log("✅ Email server ready");
  }
});

// =======================
// OTP
// =======================
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// =======================
// REGISTER
// =======================
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    let user = await User.findOne({ email });

    const otp = generateOTP();

    if (user) {
      user.otp = otp;
      await user.save();

      try {
        const info = await transporter.sendMail({
          from: "Cosmic Chat <cosmicchat10@gmail.com>",
          to: email,
          subject: "Cosmic Chat OTP Verification",
          text: `Your OTP is: ${otp}`
        });

        console.log("🔁 OTP resent:", info.response);

      } catch (emailErr) {
        console.log("❌ Email failed:", emailErr.message);
        return res.status(500).json({ message: "Failed to send OTP" });
      }

      return res.json({ message: "OTP resent to your email" });
    }

    const hashed = await bcrypt.hash(password, 10);

    user = new User({
      username,
      email,
      password: hashed,
      otp,
      verified: false
    });

    await user.save();

    try {
      const info = await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,
        subject: "Cosmic Chat OTP Verification",
        text: `Your OTP is: ${otp}`
      });

      console.log("📩 OTP sent:", info.response);

    } catch (emailErr) {
      console.log("❌ Email failed:", emailErr.message);
      return res.status(500).json({ message: "Failed to send OTP" });
    }

    res.json({ message: "OTP sent to your email" });

  } catch (err) {
    console.log("❌ Register error:", err.message);
    res.status(500).json({ message: "Registration error" });
  }
});

// =======================
// VERIFY OTP
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
// LOGIN
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
// SOCKET
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
// START
// =======================
server.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on port ${PORT}`);
});