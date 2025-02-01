const jwt = require('jsonwebtoken');  // Import the jwt module
const tokenModel = require('../models/tokenModel'); // Corrected import
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
require("dotenv").config();
module.exports = async (user, mailType) => {
  try {
    const token = jwt.sign({ userId: user._id }, 'yourSecretKey', { expiresIn: '1h' }); // JWT token with expiration
    await tokenModel.create({ token, userid: user._id, createdAt: new Date() }); // Use the correct model

    const transporter = nodemailer.createTransport({
      service: "gmail",
      host: "smtp.gmail.com",
      port: 587,
      secure: true,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS, // Replace with your actual password
      },
    });

    let emailContent, mailOptions;
    if (mailType === "verifyemail") {
      // Now send this token via email
      emailContent = `
        <div>
          <p>Dear ${user.name || "User"},</p>
          <p>To complete the setup of your Verbalit account, please verify your email address by clicking the link below:</p>
          <p><a href="http://localhost:5000/api/auth/verifyemail/${encodeURIComponent(token)}">Verify My Account</a></p>
          <p>If you did not request this, you can safely ignore this email.</p>
          <p>Thank you, <br> The Verbalit Team</p>
        </div>
      `;
      mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: "Verify Your Verbalit Account",
        html: emailContent,
      };
    } else {
      emailContent = `
        <div>
          <h1>Reset your password</h1>
          <p>Click the link below to reset your password:</p>
          <p><a href="http://localhost:3000/resetpassword/${encodeURIComponent(token)}">Reset Password</a></p>
        </div>
      `;
      mailOptions = {
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: "Reset Your Verbalit Password",
        html: emailContent,
      };
    }

    // Send the email
    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully!");
  } catch (error) {
    console.error("Error sending email:", error);
  }
};
