const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true
  },

  email: { type: String },

  phone: { type: String },

  password: { type: String, required: true },

  isVerified: {
    type: Boolean,
    default: false
  },

  otp: String,

  otpExpires: Date

});

module.exports = mongoose.model("User", userSchema);