const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: String,
    receiver: String,
    room: String,
    text: String,
    seen: {
  type: Boolean,
  default: false
}
  },
  { timestamps: true }
);

module.exports = mongoose.model("Message", messageSchema);