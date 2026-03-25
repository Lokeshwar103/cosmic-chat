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

const normalTop = document.getElementById("normalTop");
const selectionTop = document.getElementById("selectionTop");
const selectedCount = document.getElementById("selectedCount");

let currentChat = "group";
let selectedUser = null;

let selectionMode = false;
let selectedMessages = new Set();
let typingTimer;
let unread = {};


// SEND
sendBtn.onclick = sendMessage;

messageInput.addEventListener("keypress", e => {
  if (e.key === "Enter") sendMessage();
});

messageInput.addEventListener("input", () => {
  if (currentChat === "private" && selectedUser) {
    socket.emit("typing", {
      sender: username,
      receiver: selectedUser
    });
  }
});


async function sendMessage() {

  const text = messageInput.value.trim();
  if (!text) return;

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

  // ✅ FIX: message not disappearing
  addMessage({
    sender: username,
    text
  });

  messageInput.value = "";
}


// USERS
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

    li.onclick = () => {

      unread[user] = 0;

      const badge = document.getElementById("badge_"+user);
      if(badge) badge.style.display="none";

      socket.emit("chat_request", {
        sender: username,
        receiver: user
      });

    };

    usersList.appendChild(li);

  });

});


// CHAT REQUEST RECEIVED
socket.on("chat_request_received", ({ sender }) => {

  const accept = confirm(`${sender} wants to start a chat. Accept?`);

  if (accept) {

    socket.emit("chat_request_accept", {
      sender,
      receiver: username
    });

  } else {

    socket.emit("chat_request_reject", {
      sender,
      receiver: username
    });

  }

});


// CHAT REQUEST ACCEPTED
socket.on("chat_request_accepted", ({ sender, receiver }) => {

  const otherUser = sender === username ? receiver : sender;

  currentChat = "private";
  selectedUser = otherUser;

  chatTitle.innerText = otherUser;
  chatBox.innerHTML = "";

  socket.emit("join_private", {
    sender: username,
    receiver: otherUser
  });

});


// LOAD GROUP
socket.on("load_group_messages", msgs => renderMessages(msgs));


// LOAD PRIVATE
socket.on("load_private_messages", async msgs => {

  const room = [username, selectedUser].sort().join("_");

  for (let msg of msgs) {

    try {
      msg.text = await decryptMessage(JSON.parse(msg.text), room);
    } catch {
      msg.text = "[Encrypted]";
    }

  }

  renderMessages(msgs);

});


// RECEIVE GROUP
socket.on("receive_group_message", msg => {

  if (currentChat === "group") addMessage(msg);

});


// RECEIVE PRIVATE
socket.on("receive_private_message", async msg => {

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

    msg.text = await decryptMessage(JSON.parse(msg.text), room);
    addMessage(msg);

    socket.emit("messages_seen", {
      room,
      messageIds:[msg._id]
    });

  } catch {}

});


// TYPING
socket.on("user_typing", user => {

  typingStatus.innerHTML = `${user} is typing<span class="dots"></span>`;

  clearTimeout(typingTimer);

  typingTimer = setTimeout(() => {
    typingStatus.innerHTML = "";
  }, 1500);

});


// SEEN
socket.on("messages_seen", ({ room, messageIds }) => {

  if (currentChat !== "private") return;

  const myRoom = [username, selectedUser].sort().join("_");

  if (myRoom !== room) return;

  messageIds.forEach(id => {

    const row = document.getElementById(id);

    if (!row) return;

    const seenEl = row.querySelector(".seenStatus");

    if (seenEl) seenEl.textContent = "Seen";

  });

});


// DELETE SYNC
socket.on("message_deleted", id => {

  const el = document.getElementById(id);

  if (el) el.remove();

});


// ===== SELECTION UI =====

function updateSelectionUI() {

  if (selectedMessages.size > 0) {

    selectionMode = true;

    normalTop.style.display = "none";
    selectionTop.style.display = "flex";

    selectedCount.textContent = selectedMessages.size + " selected";

  } else {

    selectionMode = false;

    normalTop.style.display = "flex";
    selectionTop.style.display = "none";

  }

}

function clearSelection() {

  selectedMessages.clear();

  document.querySelectorAll(".selected").forEach(el => {
    el.classList.remove("selected");
  });

  updateSelectionUI();

}


// ===== DELETE SELECTED =====

function deleteSelected() {

  if (selectedMessages.size === 0) return;

  const ok = confirm("Delete selected messages?");

  if (!ok) return;

  selectedMessages.forEach(id => {

    socket.emit("delete_message", {
      messageId: id
    });

  });

  clearSelection();

}


// RENDER
function renderMessages(msgs) {

  chatBox.innerHTML = "<div class='loader'>Loading messages...</div>";

  setTimeout(() => {

    chatBox.innerHTML = "";
    msgs.forEach(addMessage);

  }, 200);

}


// ADD MESSAGE
function addMessage(msg) {

  const row = document.createElement("div");
  row.className = "msgRow " + (msg.sender === username ? "me" : "other");
  row.id = msg._id.toString();


  row.onclick = function () {

    if (!selectionMode) selectionMode = true;

    if (selectedMessages.has(row.id)) {

      selectedMessages.delete(row.id);
      row.classList.remove("selected");

    } else {

      selectedMessages.add(row.id);
      row.classList.add("selected");

    }

    updateSelectionUI();

  };


  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.innerText = msg.sender.charAt(0).toUpperCase();

  /* PROFILE CLICK -> OPEN PRIVATE CHAT */
  avatar.onclick = () => {

    if(msg.sender === username) return;

    socket.emit("chat_request",{
      sender:username,
      receiver:msg.sender
    });

  };

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const time = msg.createdAt
    ? new Date(msg.createdAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  bubble.innerHTML = `
    <div>${msg.text}</div>
    <div class="meta">
      <span>${time}</span>
      ${
        currentChat === "private" && msg.sender === username
          ? `<span class="seenStatus">${msg.seen ? "Seen" : "Sent"}</span>`
          : ""
      }
    </div>
  `;

  row.appendChild(avatar);
  row.appendChild(bubble);

  chatBox.appendChild(row);

  chatBox.scrollTop = chatBox.scrollHeight;

}


// GROUP BUTTON
function goGroup() {

  currentChat = "group";
  selectedUser = null;

  chatTitle.innerText = "Group Chat";

  const chatSub = document.getElementById("chatSub");

  if (chatSub) chatSub.innerText = "Everyone can see these messages";

  chatBox.innerHTML = "";

  socket.emit("join", username);

}