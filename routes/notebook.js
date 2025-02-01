const express = require("express");
const NotebookPage = require("../models/NotebookPage");
const router = express.Router();

// Get all pages for a user
router.get("/:userId/pages", async (req, res) => {
  try {
    const pages = await NotebookPage.find({ userId: req.params.userId });
    res.status(200).json(pages);
  } catch (error) {
    res.status(500).json({ message: "Error fetching pages", error });
  }
});

// Create a new page
router.post("/:userId/pages", async (req, res) => {
  try {
    const { name, content } = req.body;
    const newPage = await NotebookPage.create({ userId: req.params.userId, name, content });
    res.status(201).json(newPage);
  } catch (error) {
    res.status(500).json({ message: "Error creating page", error });
  }
});

// Update a page's name or content
router.put("/pages/:id", async (req, res) => {
  try {
    const { name, content, folderId } = req.body; // Include folderId in request body
    const updatedPage = await NotebookPage.findByIdAndUpdate(
      req.params.id,
      { name, content, folderId }, // Update folderId
      { new: true }
    );
    if (!updatedPage) {
      return res.status(404).json({ message: "Page not found" });
    }
    res.status(200).json(updatedPage);
  } catch (error) {
    console.error("Error updating page:", error);
    res.status(500).json({ message: "Error updating page", error });
  }
});

// Fetch pages by folderId
router.get("/pages/folder/:folderId", async (req, res) => {
  try {
    const { folderId } = req.params;
    const pages = await NotebookPage.find({ folderId });
    res.status(200).json(pages);
  } catch (error) {
    console.error("Error fetching pages by folderId:", error);
    res.status(500).json({ message: "Error fetching pages by folderId", error });
  }
});

// Update Notebook Page to link/unlink with a folder
router.put("/api/notebook/pages/:pageId/link-folder", async (req, res) => {
  try {
    const { pageId } = req.params;
    const { folderId } = req.body;

    // Validate folderId if provided (allow null for unlinking)
    if (folderId && !mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ message: "Invalid folder ID format." });
    }

    // Update the notebook page's folderId (set to folderId or null)
    const updatedPage = await NotebookPage.findByIdAndUpdate(
      pageId,
      { folderId: folderId || null },
      { new: true }
    );

    if (!updatedPage) {
      return res.status(404).json({ message: "Notebook page not found." });
    }

    res.status(200).json(updatedPage);
  } catch (error) {
    console.error("Error linking notebook page with folder:", error);
    res.status(500).json({ message: "Server error while updating folder link." });
  }
});



// Delete a page
router.delete("/pages/:id", async (req, res) => {
  try {
    await NotebookPage.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Page deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: "Error deleting page", error });
  }
});









module.exports = router;
