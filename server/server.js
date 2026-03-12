const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const nodemailer = require("nodemailer");

const User = require("./models/User");
const Message = require("./models/Message");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 5000;
const JWT_SECRET = "supersecretkey";



// =====================
// OTP
// =====================

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}


// =====================
// EMAIL
// =====================
require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


// =====================
// DATABASE
// =====================

mongoose
.connect("mongodb://127.0.0.1:27017/chatapp")
.then(()=>console.log("✅ MongoDB Connected"))
.catch(err=>console.log("❌ MongoDB Error:",err.message));


app.use(express.json());
app.use(express.static(path.join(__dirname,"public")));

app.get("/",(req,res)=>{
res.redirect("/splash.html");
});


/// =====================
// REGISTER
// =====================

app.post("/api/auth/register", async (req,res)=>{

try{

const {username,email,phone,password} = req.body;

if(!username){
return res.status(400).json({message:"Username required"});
}

if(!email && !phone){
return res.status(400).json({message:"Email or phone required"});
}

let user;

if(email){
user = await User.findOne({email});
}

if(phone){
user = await User.findOne({phone});
}

if(user){

if(user.isVerified){
return res.status(400).json({message:"User already registered"});
}

const otp = generateOTP();

user.otp = otp;
user.otpExpires = Date.now() + 5*60*1000;

await user.save();

if(email){
transporter.sendMail({
from:"Cosmic Chat",
to:email,
subject:"Cosmic Chat OTP",
text:`Your OTP is ${otp}`
});
}

return res.json({
message:"OTP resent",
userId:user._id
});

}

const otp = generateOTP();
const hashed = await bcrypt.hash(password,10);

user = await User.create({
username,
email,
phone,
password:hashed,
otp,
otpExpires:Date.now()+5*60*1000,
isVerified:false
});

if(email){
transporter.sendMail({
from:"Cosmic Chat",
to:email,
subject:"Cosmic Chat OTP",
text:`Your OTP is ${otp}`
});
}

res.json({
message:"OTP sent",
userId:user._id
});

}catch(err){

console.log("REGISTER ERROR:",err);
res.status(500).json({message:"Server error"});

}

});


// =====================
// VERIFY OTP
// =====================

app.post("/api/auth/verify-otp", async(req,res)=>{

try{

const {userId,otp} = req.body;

if(!userId || !otp){
return res.status(400).json({message:"Missing data"});
}

const user = await User.findById(userId);

if(!user){
return res.status(400).json({message:"User not found"});
}

if(user.otp !== otp){
return res.status(400).json({message:"Invalid OTP"});
}

if(user.otpExpires < Date.now()){
return res.status(400).json({message:"OTP expired"});
}

user.isVerified = true;
user.otp = null;
user.otpExpires = null;

await user.save();

res.json({message:"Account verified"});

}catch(err){

console.log("VERIFY ERROR:",err);
res.status(500).json({message:"Server error"});

}

});


// =====================
// LOGIN
// =====================

app.post("/api/auth/login", async(req,res)=>{

const {email,password} = req.body;

const user = await User.findOne({email});

if(!user){
return res.status(400).json({message:"Invalid credentials"});
}

if(!user.isVerified){
return res.status(400).json({message:"Verify OTP first"});
}

const ok = await bcrypt.compare(password,user.password);

if(!ok){
return res.status(400).json({message:"Invalid credentials"});
}

const token = jwt.sign({id:user._id},JWT_SECRET);

res.json({
token,
username:user.username
});

});


// =====================
// SOCKET
// =====================

const onlineUsers = {};

io.on("connection",(socket)=>{

console.log("User connected");


// JOIN
socket.on("join", async(username)=>{

socket.username = username;

onlineUsers[username] = socket.id;

io.emit("online_users",Object.keys(onlineUsers));

const groupMsgs = await Message
.find({room:"group"})
.sort({createdAt:1});

socket.emit("load_group_messages",groupMsgs);

});


// PRIVATE CHAT OPEN
socket.on("chat_request", ({sender,receiver})=>{

const senderId = onlineUsers[sender];
const receiverId = onlineUsers[receiver];

if(senderId){
io.to(senderId).emit("chat_request_accepted",{sender,receiver});
}

if(receiverId){
io.to(receiverId).emit("chat_request_accepted",{sender,receiver});
}

});


// JOIN PRIVATE
socket.on("join_private", async({sender,receiver})=>{

const room = [sender,receiver].sort().join("_");

socket.join(room);

const msgs = await Message
.find({room})
.sort({createdAt:1});

socket.emit("load_private_messages",msgs);

});


// GROUP MESSAGE
socket.on("send_group_message", async({sender,text})=>{

const msg = await Message.create({
sender,
room:"group",
text
});

io.emit("receive_group_message",msg);

});

// =====================
// MESSAGE SEEN
// =====================

socket.on("messages_seen", async ({ room, messageIds }) => {

  try{

    for(const id of messageIds){

      const msg = await Message.findById(id);

      if(!msg) continue;

      msg.seen = true;

      await msg.save();

    }

    io.to(room).emit("messages_seen", {
      room,
      messageIds
    });

  }catch(err){
    console.log("Seen error:",err);
  }

});

// PRIVATE MESSAGE
socket.on("send_private_message", async({sender,receiver,text})=>{

const room = [sender,receiver].sort().join("_");

const msg = await Message.create({
sender,
receiver,
room,
text,
seen:false
});

io.to(room).emit("receive_private_message",msg);

});


// DELETE MESSAGE
socket.on("delete_message", async({messageId})=>{

const msg = await Message.findById(messageId);

if(!msg) return;

const room = msg.room;

await Message.findByIdAndDelete(messageId);

if(room==="group"){
io.emit("message_deleted",messageId);
}else{
io.to(room).emit("message_deleted",messageId);
}

});


// TYPING
socket.on("typing", ({sender,receiver})=>{

const id = onlineUsers[receiver];

if(id){
io.to(id).emit("user_typing",sender);
}

});


// DISCONNECT
socket.on("disconnect",()=>{

delete onlineUsers[socket.username];

io.emit("online_users",Object.keys(onlineUsers));

console.log("User disconnected");

});

});


// =====================
// START SERVER
// =====================

server.listen(PORT,()=>{
console.log(`🚀 Server running on http://localhost:${PORT}`);
});