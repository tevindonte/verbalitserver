// routes/collabRoutes.js
const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const NotebookPage = require("../models/NotebookPage");
const nodemailer = require("nodemailer");

// Generate shareable link
router.post("/share-page/:pageId", async (req, res) => {
  try {
    const { pageId } = req.params;
    const { role = "viewer" } = req.body;

    const token = jwt.sign(
      { pageId, role },
      process.env.JWT_SECRET || "yourSecretKey",
      { expiresIn: "7d" }
    );

    const shareLink = `http://localhost:3000/collaboration/${pageId}/${token}`;
    res.status(200).json({ shareLink });
  } catch (error) {
    console.error("Error generating share link:", error);
    res.status(500).json({ message: "Failed to generate share link." });
  }
});

// Send email invitation
router.post("/invite-page/:pageId", async (req, res) => {
  try {
    const { pageId } = req.params;
    const { email, role } = req.body;

    // Verify page exists
    const page = await NotebookPage.findById(pageId);
    if (!page) throw new Error("Page not found");

    // Create token
    const token = jwt.sign(
      { pageId, role },
      process.env.JWT_SECRET || "yourSecretKey",
      { expiresIn: "7d" }
    );

    // Send email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Collaboration Invitation",
      html: `<p>You've been invited to collaborate on a notebook page!</p>
             <p>Role: <strong>${role}</strong></p>
             <a href="http://localhost:3000/collaboration/${pageId}/${token}">Join Collaboration</a>`
    };

    await transporter.sendMail(mailOptions);
    res.status(200).json({ message: "Invitation sent!" });
  } catch (error) {
    console.error("Invitation error:", error);
    res.status(500).json({ message: "Failed to send invitation." });
  }
});

// Verify token
router.get("/verify-token/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "yourSecretKey");
    
    const page = await NotebookPage.findById(decoded.pageId);
    if (!page) throw new Error("Invalid page");

    res.status(200).json({
      role: decoded.role,
      pageId: decoded.pageId
    });
  } catch (error) {
    console.error("Token verification failed:", error);
    res.status(401).json({ message: "Invalid or expired token" });
  }
});

module.exports = router;