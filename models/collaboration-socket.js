// socketHandler.js
module.exports = (server) => {
    const io = require("socket.io")(server, {
      cors: {
        origin: "http://localhost:3000",
        methods: ["GET", "POST"]
      }
    });
  
    io.on("connection", (socket) => {
      console.log("New client connected");
  
      socket.on("joinPage", async (pageId) => {
        socket.join(pageId);
        console.log(`User joined page ${pageId}`);
      });
  
      socket.on("updateContent", async (pageId, content) => {
        try {
          // Save to database
          await require("./models/NotebookPage").findByIdAndUpdate(
            pageId,
            { content },
            { new: true }
          );
          // Broadcast to all clients
          io.to(pageId).emit("contentUpdated", content);
        } catch (error) {
          console.error("Error updating content:", error);
        }
      });
  
      socket.on("disconnect", () => {
        console.log("Client disconnected");
      });
    });
  };