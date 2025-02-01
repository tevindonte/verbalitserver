// models/LoginToken.js
const mongoose = require("mongoose");

const loginTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId, // or String if you prefer
    ref: "users", // match your "users" collection name
    required: true,
  },
  token: {
    type: String,
    required: true,
  },
  createdAt: { 
    type: Date, 
    default: Date.now 
  },
  updatedAt: { 
    type: Date, 
    default: Date.now 
  },
});

// Update 'updatedAt' every time we save
loginTokenSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

const LoginToken = mongoose.model("LoginToken", loginTokenSchema);
module.exports = LoginToken;
