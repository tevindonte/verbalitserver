// backend/middlewares/authmiddleware.js
const jwt = require("jsonwebtoken");

// Middleware to verify JWT token from cookies
const verifyToken = (req, res, next) => {
  const token = req.cookies.token;

  if (!token) {
    return res
      .status(401)
      .json({ success: false, message: "Authorization token is missing" });
  }

  try {
    // Use environment variable for JWT secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attach decoded user info to the request
    next();
  } catch (error) {
    console.error("Token Verification Error:", error);
    res.status(401).json({ success: false, message: "Invalid or expired token" });
  }
};

module.exports = verifyToken;
