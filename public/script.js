// ===== E2EE UTIL =====
async function generateKeyFromRoom(room) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(room),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("cosmic_salt"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptMessage(text, room) {
  const key = await generateKeyFromRoom(room);
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(text)
  );

  return {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted)),
  };
}

async function decryptMessage(encryptedObj, room) {
  const key = await generateKeyFromRoom(room);
  const iv = new Uint8Array(encryptedObj.iv);
  const data = new Uint8Array(encryptedObj.data);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  return new TextDecoder().decode(decrypted);
}

const socket = io("https://cosmic-chat-y27g.onrender.com");

const username = localStorage.getItem("username");
if (!username) window.location.href = "/login.html";

socket.emit("join", username);

const chatBox = document.getElementById("chatBox");
const usersList = document.getElementById("usersList");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const chatTitle = document.getElementById("chatTitle");
const onlineCount = document.getElementById("onlineCount");
const typingStatus = document.getElementById("typingStatus");

let currentChat = "group";
let selectedUser = null;
let unread = {};
let typingTimer;

// ================= SEND =================
sendBtn.onclick = sendMessage;

messageInput.addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});

async function sendMessage() {

  const text = messageInput.value.trim();
  if (!text) return;

  // ✅ FIX 1: clear input FIRST
  messageInput.value = "";

  if (currentChat === "group") {

    socket.emit("send_group_message", {
      sender: username,
      text
    });

  } else {

    const room = [username, selectedUser].sort().join("_");

    const encrypted = await encryptMessage(text, room);

    socket.emit("send_private_message", {
      sender: username,
      receiver: selectedUser,
      text: JSON.stringify(encrypted)
    });
  }

  // ✅ FIX: show instantly
  addMessage({
    sender: username,
    text
  });
}

// ================= USERS =================
socket.on("online_users", users => {

  onlineCount.textContent = `Online: ${users.length}`;
  usersList.innerHTML = "";

  users.forEach(user => {

    if (user === username) return;

    const li = document.createElement("li");

    const badgeCount = unread[user] || 0;

    li.innerHTML = `
      <span class="dot"></span>
      ${user}
      <span class="unreadBadge" id="badge_${user}" style="display:${badgeCount ? "inline-block":"none"}">${badgeCount}</span>
    `;

    // ✅ FIX 2: DIRECT OPEN PRIVATE CHAT
    li.onclick = () => {

      unread[user] = 0;

      const badge = document.getElementById("badge_"+user);
      if(badge) badge.style.display="none";

      currentChat = "private";
      selectedUser = user;

      chatTitle.innerText = user;
      chatBox.innerHTML = "";

      socket.emit("join_private", {
        sender: username,
        receiver: user
      });
    };

    usersList.appendChild(li);
  });
});

// ================= RECEIVE GROUP =================
socket.on("receive_group_message", msg => {
  if (currentChat === "group") addMessage(msg);
});

// ================= RECEIVE PRIVATE =================
socket.on("receive_private_message", async msg => {

  // unread counter
  if (currentChat !== "private" || selectedUser !== msg.sender) {

    unread[msg.sender] = (unread[msg.sender] || 0) + 1;

    const badge = document.getElementById("badge_" + msg.sender);
    if (badge) {
      badge.innerText = unread[msg.sender];
      badge.style.display = "inline-block";
    }
  }

  if (currentChat !== "private") return;

  const room = [username, selectedUser].sort().join("_");

  try {
    // ✅ FIX 3: decrypt properly
    msg.text = await decryptMessage(JSON.parse(msg.text), room);
    addMessage(msg);
  } catch {}
});

// ================= ADD MESSAGE =================
function addMessage(msg) {

  const row = document.createElement("div");
  row.className = "msgRow " + (msg.sender === username ? "me" : "other");

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  bubble.innerHTML = `<div>${msg.text}</div>`;

  row.appendChild(bubble);
  chatBox.appendChild(row);

  chatBox.scrollTop = chatBox.scrollHeight;
}

// ================= GROUP BUTTON =================
function goGroup() {

  currentChat = "group";
  selectedUser = null;

  chatTitle.innerText = "Group Chat";
  chatBox.innerHTML = "";

  socket.emit("join", username);
}