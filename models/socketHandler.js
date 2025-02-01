// backend/models/socketHandler.js

const socketio = require("socket.io");
const jwt = require("jsonwebtoken");
const Board = require("../models/Board");
const MoodboardShare = require("../models/MoodboardShare"); // Moodboard sharing model
const NotebookPage = require("../models/NotebookPage"); // Notebook page model
require("dotenv").config(); // Ensure environment variables are loaded

module.exports = (server) => {
    const io = socketio(server, {
        cors: {
            origin: "http://localhost:3000", // Adjust based on your frontend's URL
            methods: ["GET", "POST"],
        },
    });

    io.on("connection", (socket) => {
        console.log("New client connected:", socket.id);

  // Store socket roles by socket.id => "viewer"/"editor"
  const socketRoles = {};
    // ======================
    // Moodboard Collaboration
    // ======================
    socket.on("joinMoodboard", async ({ boardId, token }) => {
        try {
          if (!boardId || !boardId.match(/^[0-9a-fA-F]{24}$/)) {
            socket.emit("error", "Invalid board ID format.");
            return;
          }
  
          const board = await Board.findById(boardId);
          if (!board) {
            socket.emit("error", "Board not found.");
            return;
          }
  
          let finalRole = "viewer";
  
          // Attempt to find a MoodboardShare entry with given token
          const shareEntry = await MoodboardShare.findOne({ moodboardId: boardId, token });
          if (!shareEntry) {
            // Token not in DB => invalid or expired
            socket.emit("error", "Invalid or expired token.");
            return;
          }
          finalRole = shareEntry.role || "viewer";
  
          // Join the socket room
          socket.join(boardId);
          socketRoles[socket.id] = finalRole;
          console.log(`Socket ${socket.id} joined moodboard ${boardId} as ${finalRole}.`);
  
          // Let the client know we joined successfully
          socket.emit("joined", { role: finalRole });
        } catch (err) {
          console.error("Error in joinMoodboard:", err);
          socket.emit("error", "An error occurred while joining the moodboard.");
        }
      });
  
      socket.on("updateMoodboard", async (boardId, updatedElements) => {
        try {
          // Check role from socketRoles
          const role = socketRoles[socket.id] || "viewer";
          if (role !== "editor") {
            console.log(
              `Socket ${socket.id} tried to update, but role is ${role}. Ignoring.`
            );
            socket.emit("error", "You do not have permission to edit this moodboard.");
            return;
          }
  
          if (!boardId || !boardId.match(/^[0-9a-fA-F]{24}$/)) {
            socket.emit("error", "Invalid board ID format.");
            return;
          }
          const board = await Board.findById(boardId);
          if (!board) {
            socket.emit("error", "Board not found.");
            return;
          }
  
          // Save updated elements in DB
          board.elements = updatedElements;
          await board.save();
  
          // Broadcast to other clients
          socket.to(boardId).emit("contentUpdated", updatedElements);
          console.log(`Broadcast moodboard update for board ${boardId}`);
        } catch (error) {
          console.error("Error updating moodboard:", error);
          socket.emit("error", "Failed to update moodboard.");
        }
      });

        // ====================================
        // Notebook (Page) Collaboration Events
        // ====================================

        socket.on("joinPage", async (pageId) => {
            try {
                if (!pageId) {
                    socket.emit("error", "Invalid page ID.");
                    return;
                }
                socket.join(pageId);
                console.log(`Client ${socket.id} joined page ${pageId}`);
            } catch (error) {
                console.error("Error in joinPage:", error);
                socket.emit("error", "An error occurred while joining the page.");
            }
        });

        socket.on("updateContent", async (pageId, content) => {
            try {
                if (!pageId) {
                    socket.emit("error", "Invalid page ID.");
                    return;
                }
                // Update the NotebookPage content in the database
                await NotebookPage.findByIdAndUpdate(pageId, { content }, { new: true });
                // Broadcast the updated content to all clients in the same room
                io.to(pageId).emit("contentUpdated", content);
                console.log(`Broadcast update for page ${pageId}`);
            } catch (error) {
                console.error("Error updating content:", error);
                socket.emit("error", "Failed to update content.");
            }
        });

        // ====================================
        // Disconnect Handler
        // ====================================
        socket.on("disconnect", () => {
            console.log("Client disconnected:", socket.id);
        });
    });
};
