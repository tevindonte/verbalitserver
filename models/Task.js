const mongoose = require("mongoose");

const TaskSchema = new mongoose.Schema(
  {
    projectId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Folder",
      required: false,
    }, // Optional if no folder
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
      required: true,
    }, // Associate task with a user
    text: { type: String, required: true },
    start: { type: Date, required: true }, // Start date of the task
    end: { type: Date, required: true }, // End date of the task
    isComplete: { type: Boolean, default: false }, // Task completion status
    backColor: { type: String, default: "#ffffff" }, // Background color (optional)
  },
  { timestamps: true }
);

module.exports = mongoose.model("Task", TaskSchema);
