const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleWare");

// Protected route example
router.get("/get-user-info", authMiddleware, async (req, res) => {
  try {
    res.send({ success: true, data: req.user }); // Access user info from req.user
  } catch (error) {
    res.status(400).send(error);
  }
});

module.exports = router;
