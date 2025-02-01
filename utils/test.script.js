
const nodemailer = require("nodemailer");
require("dotenv").config();
async function sendTestEmail() {
  try {
    // Create a transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // Prepare the email options
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: "verbalitnoreply@gmail.com",
      subject: "Test Email",
      text: "This is a test email sent using Nodemailer.",
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent:", info.messageId);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

sendTestEmail();













