require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const cors = require("cors");
const axios = require("axios");

// Models
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

// =======================
// ENV CHECK
// =======================
if (!process.env.MONGO_URI || !process.env.JWT_SECRET || !process.env.BREVO_API_KEY) {
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
// OTP
// =======================
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendOTP(email, otp) {
  try {
    await axios.post(
      "https://api.brevo.com/v3/smtp/email",
      {
        sender: {
          email: "cosmicchat10@gmail.com",
          name: "Cosmic Chat"
        },
        to: [{ email }],
        subject: "Cosmic Chat OTP Verification",
        textContent: `Your OTP is: ${otp}`
      },
      {
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("✅ OTP sent:", email);

  } catch (err) {
    console.log("❌ Email error:", err.response?.data || err.message);
    throw err;
  }
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
      user.isVerified = false;
      await user.save();

      await sendOTP(email, otp);
      return res.json({ message: "OTP resent" });
    }

    const hashed = await bcrypt.hash(password, 10);

    user = new User({
      username,
      email,
      password: hashed,
      otp,
      isVerified: false
    });

    await user.save();
    await sendOTP(email, otp);

    res.json({ message: "OTP sent" });

  } catch (err) {
    res.status(500).json({ message: "Registration error" });
  }
});

// =======================
// VERIFY OTP
// =======================
app.post("/api/auth/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.otp !== otp) return res.status(400).json({ message: "Invalid OTP" });

    user.isVerified = true;
    user.otp = null;

    await user.save();

    res.json({ message: "Account verified" });

  } catch {
    res.status(500).json({ message: "Verification error" });
  }
});

// =======================
// LOGIN
// =======================
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) return res.status(404).json({ message: "User not found" });
    if (!user.isVerified) return res.status(400).json({ message: "Verify OTP first" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(400).json({ message: "Wrong password" });

    const token = jwt.sign({ id: user._id }, JWT_SECRET);

    res.json({ token, username: user.username });

  } catch {
    res.status(500).json({ message: "Login error" });
  }
});

// =======================
// SOCKET.IO (FINAL FIX)
// =======================
let onlineUsers = {};

io.on("connection", (socket) => {

  socket.on("join", (username) => {
    onlineUsers[username] = socket.id;
    io.emit("online_users", Object.keys(onlineUsers));
  });

  socket.on("send_group_message", async ({ sender, text }) => {

    const msg = new Message({ sender, text });
    await msg.save();

    io.emit("receive_group_message", msg);
  });

  socket.on("send_private_message", async ({ sender, receiver, text }) => {

    const msg = new Message({ sender, receiver, text });
    await msg.save();

    const target = onlineUsers[receiver];

    if (target) io.to(target).emit("receive_private_message", msg);

    socket.emit("receive_private_message", msg);
  });

  socket.on("disconnect", () => {
    for (let user in onlineUsers) {
      if (onlineUsers[user] === socket.id) delete onlineUsers[user];
    }
    io.emit("online_users", Object.keys(onlineUsers));
  });

});

// =======================
server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Server running on", PORT);
});