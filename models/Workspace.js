const WorkspaceSchema = new mongoose.Schema({
    name: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    collaborators: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        email: String, // For guests
        role: { type: String, enum: ["viewer", "editor"], default: "viewer" },
      },
    ],
    shareToken: { type: String }, // Unique token for raw sharing links
    content: {}, // Notebook/Moodboard data
  });
  