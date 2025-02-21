const express = require("express");
const router = express.Router();
const User = require("../models/userModel");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const sendEmail = require("../utils/sendEmail");
const Token = require("../models/tokenModel");
const verifyToken = require("../middlewares/authMiddleWare"); // Correct path


router.post("/register", async (req, res) => {
  try {
    const existingUser = await User.findOne({ email: req.body.email });
    if (existingUser)
      return res
        .status(200)
        .send({ success: false, message: "User Already Registered" });

    const password = req.body.password;
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    req.body.password = hashedPassword;
    const newuser = new User(req.body);
    const result = await newuser.save();
    await sendEmail(result, "verifyemail");
    res.status(200).send({
      success: true,
      message: "Registration successful , Please verify your email",
    });
  } catch (error) {
    console.log(error);
    res.status(400).send(error);
  }
});



// Login Route
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Authenticate user
    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "User does not exist." });
    }

    const isPasswordMatched = await bcrypt.compare(password, user.password);
    if (!isPasswordMatched) {
      return res
        .status(401)
        .json({ success: false, message: "Incorrect Password" });
    }

    if (!user.isVerifed) { // Ensure field name is correct in your model
      return res
        .status(401)
        .json({ success: false, message: "Email not verified" });
    }

    // Generate JWT using environment variable
    const token = jwt.sign(
      { _id: user._id, email: user.email, name: user.name },
      process.env.JWT_SECRET, // Ensure this matches your .env
      { expiresIn: "1h" } // 1 hour
    );

    // Set token in HTTP-only cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: true, // false in dev
      sameSite: "None", // Helps prevent CSRF
      maxAge: 60 * 60 * 1000, // 1 hour
    });

    res.status(200).json({
      success: true,
      message: "User Login Successful",
      data: { _id: user._id, email: user.email, name: user.name },
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(400).send({ success: false, message: "Login failed." });
  }
});

// Logout Route
router.post("/logout", (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Strict",
  });
  res.json({ success: true, message: "Logged out successfully" });
});

// Get Authenticated User's Info
router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }
    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error("Fetch User Info Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

router.post("/send-password-reset-link", async (req, res) => {
  try {
    const result = await User.findOne({ email: req.body.email });
    await sendEmail(result, "resetpassword");
    res.send({
      success: true,
      message: "Password reset link sent to your email successfully",
    });
  } catch (error) {
    res.status(500).send(error);
  }
});

router.post("/reset-password", async (req, res) => {
  try {
   
    const tokenData = await Token.findOne({ token: req.body.token });
    if (tokenData) {
      const password = req.body.password;
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      await User.findOneAndUpdate({ _id: tokenData.userid, password: hashedPassword });
      await Token.findOneAndDelete({ token: req.body.token });
      res.send({ success: true, message: "Password reset successful" });
    } else {
      res.send({ success: false, message: "Invalid token" });
    }
  } catch (error) {
    res.status(500).send(error);
  }
});


router.get('/verifyemail/:token', async (req, res) => {
  try {
    const token = req.params.token;

    // Decode and verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET); // Use your secret key
    if (!decoded) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    console.log('Decoded token:', decoded); // Log the decoded token to check its contents

    // Find the user by userId from the decoded token
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    console.log('User before update:', user); // Log the user before update

    // Update isVerifed to true
    user.isVerifed = true; // Corrected field name
    await user.save();

    console.log('User after update:', user); // Log the user after update

    // Optionally delete the token record
    await Token.deleteOne({ token });

    res.status(200).json({ message: 'Email verified successfully!' });
  } catch (error) {
    console.error('Error during verification:', error);
    res.status(500).json({ message: 'Server error' });
  }
});




module.exports = router;






module.exports = router;
