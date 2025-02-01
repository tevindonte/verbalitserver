const socketio = require("socket.io");
const jwt = require("jsonwebtoken");
const Board = require("../models/Board");
require("dotenv").config(); // Ensure environment variables are loaded

module.exports = (server) => {
    const io = socketio(server, {
        cors: {
            origin: "http://localhost:3000",
            methods: ["GET", "POST"],
        },
    });

    io.on("connection", (socket) => {
        console.log("New client connected for Moodboard collaboration");

        // Join a moodboard room
        socket.on("joinMoodboard", async ({ boardId, token }) => {
            try {
                const board = await Board.findById(boardId);
                if (!board) {
                    socket.emit("error", "Board not found.");
                    return;
                }

                // Check if the token matches shareToken
                if (board.shareToken === token) {
                    socket.join(boardId);
                    console.log(`User joined moodboard ${boardId} as viewer.`);
                    socket.emit("joined", { role: "viewer" });
                    return;
                }

                // Try to verify JWT token
                const decoded = jwt.verify(token, process.env.JWT_SECRET || "yourSecretKey");

                if (decoded.boardId === boardId && ["viewer", "editor"].includes(decoded.role)) {
                    socket.join(boardId);
                    console.log(`User joined moodboard ${boardId} as ${decoded.role}.`);
                    socket.emit("joined", { role: decoded.role });
                } else {
                    socket.emit("error", "Invalid token for this board.");
                }
            } catch (error) {
                console.error("Error in joinMoodboard:", error);
                socket.emit("error", "Invalid or expired token.");
            }
        });

        // Handle content updates from editors
        socket.on("updateMoodboard", async (boardId, updatedElements) => {
            try {
                const board = await Board.findById(boardId);
                if (!board) {
                    socket.emit("error", "Board not found.");
                    return;
                }

                // Here, you might want to implement role checking to ensure only editors can update
                // For simplicity, we'll assume that if a user can emit "updateMoodboard", they're authorized

                // Update the board's elements
                board.elements = updatedElements;
                await board.save();

                // Broadcast the updated elements to other clients in the room
                socket.to(boardId).emit("contentUpdated", updatedElements);
            } catch (error) {
                console.error("Error updating moodboard:", error);
                socket.emit("error", "Failed to update moodboard.");
            }
        });

        socket.on("disconnect", () => {
            console.log("Client disconnected from Moodboard collaboration");
        });
    });
};
