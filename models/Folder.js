const mongoose = require("mongoose");

// Updated FolderSchema to include userId
const FolderSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    },
    name: {
      type: String,
      required: true,
      // unique: true, // Typically remove unique if multiple users can have the same folder name
    },
    files: [
      {
        name: { type: String, required: true },
        type: { type: String, required: true },
        url: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model("Folder", FolderSchema);
