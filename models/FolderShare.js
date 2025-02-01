const mongoose = require("mongoose");

const FolderShareSchema = new mongoose.Schema({
  folderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Folder",
    required: true,
  },
  token: { type: String, required: true, unique: true },
  role: { type: String, enum: ["viewer", "editor"], required: true },
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "users",
    required: true,
  },
  email: { type: String },
  createdAt: { type: Date, default: Date.now },
});

const FolderShare = mongoose.model("FolderShare", FolderShareSchema);
module.exports = FolderShare;
