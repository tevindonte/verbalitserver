// models/NotebookPage.js
const mongoose = require("mongoose");

const notebookPageSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "users", 
    required: true 
  },
  name: { 
    type: String, 
    required: true 
  },
  content: { 
    type: String, 
    default: "" 
  },
  folderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "folders" 
  },
  collaborators: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "users" },
    role: { type: String, enum: ["viewer", "editor"], default: "viewer" }
  }]
}, { timestamps: true });

module.exports = mongoose.model("NotebookPage", notebookPageSchema);