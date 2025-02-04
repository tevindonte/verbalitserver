require("dotenv").config();
const express = require("express");
const SpeechSDK = require('microsoft-cognitiveservices-speech-sdk'); // Import SpeechSDK here

const { 
  SpeechConfig, 
  SpeechSynthesizer, 
  AudioConfig, 
  ResultReason, 
  SpeechSynthesisOutputFormat 
} = require("microsoft-cognitiveservices-speech-sdk");
const cors = require('cors');
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const mongoose = require("mongoose");
const stripe = require("stripe")(process.env.STRIPE_API_KEY);
const bodyParser = require("body-parser");
const router = express.Router();
require("./models/Folder"); // Ensure this path is correct
const Folder = mongoose.model("Folder");
const cookieParser = require("cookie-parser"); // Import cookie-parser
const helmet = require("helmet"); // For secure HTTP headers
const http = require("http");
const Jimp = require('jimp');
const axios = require("axios");
const nodemailer = require('nodemailer');

// ...
const MoodboardShare = require('./models/MoodboardShare'); // Adjust the path if necessary

// Increase the limit for JSON and URL-encoded payloads ///
////////
const app = express();
const port = process.env.PORT || 10000;
//

// 1) Create a raw HTTP server from the Express app
const server = http.createServer(app);

//const initCollaborationSocket = require("./models/collaboration-socket");
//initCollaborationSocket(server);

// Initialize Moodboard collaboration Socket.IO
//const initMoodboardCollaborationSocket = require("./models/moodboard-collaboration-socket");
//initMoodboardCollaborationSocket(server);


const socketHandler = require("./models/socketHandler"); // Import the unified socket handler
socketHandler(server);

//app.use(helmet()); // Secure HTTP headers
app.use(
  cors({
    origin: [
      "https://verbalit.netlify.app", // Netlify subdomain
      "https://verbalit.top", // Primary domain
      "https://www.verbalit.top", // Redirected www domain
      "http://localhost:3000" // Local frontend for testing
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // Allow cookies to be sent
  })
);





// Increase the limit for JSON and URL-encoded payloads
app.use(bodyParser.json({ limit: '50mb' })); // Adjust as needed
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));


app.use(express.urlencoded({ extended: true })); // Add this to parse URL-encoded data
app.use(cookieParser()); // Use cookie-parser globally



// UserTier Schema
const userTierSchema = new mongoose.Schema({
  userId: String, // Link to the user
  subscriptionId: String, // Stripe subscription ID
  customerId: String, // Stripe customer ID
  tier: String, // Tier (e.g., Basic, Premium)
  status: String, // Subscription status (e.g., active, canceled)
  currentPeriodEnd: Date, // When the current subscription period ends
});

// Add this model at the top
const userUsageSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  ttsDaily: { type: Number, default: 0 },
  ttsMonthly: { type: Number, default: 0 },
  sttDaily: { type: Number, default: 0 },
  sttMonthly: { type: Number, default: 0 },
  lastReset: { type: Date, default: Date.now }
});
const UserUsage = mongoose.model("UserUsage", userUsageSchema);

// Daily reset job
const schedule = require('node-schedule');

// Reset daily counters at midnight
schedule.scheduleJob('0 0 * * *', async () => {
  await UserUsage.updateMany(
    {},
    { $set: { ttsDaily: 0, sttDaily: 0 } }
  );
  console.log('Daily usage counters reset');
});

// Monthly reset on first day of month
schedule.scheduleJob('0 0 1 * *', async () => {
  await UserUsage.updateMany(
    {},
    { $set: { ttsMonthly: 0, sttMonthly: 0 } }
  );
  console.log('Monthly usage counters reset');
});

const UserTier = mongoose.model("UserTier", userTierSchema);


// Define a schema for subscriptions
const subscriptionSchema = new mongoose.Schema({
  userId: String,
  subscriptionId: String,
  customerId: String,
});
const Subscription = mongoose.model("Subscription", subscriptionSchema);

// Stripe webhook secret
const endpointSecret = "whsec_c69b1a866ab65ebef2f91bc1c7efc4c374a482c952c1199233ae8a112adcfa10";

// listen to checkout.session.completed events when a subscription is created.
// Middleware for raw body required by Stripe
app.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log("Webhook session object:", session);

      const userId = session.client_reference_id; // Sent when creating dynamic sessions
      const subscriptionId = session.subscription; // Subscription ID
      const customerId = session.customer; // Customer ID

      if (!subscriptionId || !customerId) {
        console.error("Missing required fields:", { userId, subscriptionId, customerId });
        return res.status(400).send("Missing required fields");
      }

      // Save subscription to the database
      try {
        const newSubscription = new Subscription({
          userId,
          subscriptionId,
          customerId,
        });
        await newSubscription.save();
        console.log("Subscription saved to database:", newSubscription);
      } catch (error) {
        console.error("Error saving subscription:", error);
        return res.status(500).send("Internal server error");
      }
    }

    res.status(200).send("Webhook handled");
  }
);


app.post("/user-tier-webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log("Stripe event received:", event.type);

    if (event.type === "customer.subscription.updated") {
      const data = event.data.object;
      const { id: subscriptionId, customer, plan, status, current_period_end } = data;

      console.log("Received subscription data:", { subscriptionId, customer, plan, status });

      // Use getUserIdFromCustomerId to map customer to userId
      const userId = await getUserIdFromCustomerId(customer);
      if (!userId) {
        console.error("User ID not found for customer:", customer);
        return res.status(400).send("User ID mapping failed");
      }

      console.log("Mapped User ID:", userId);

      const updateResult = await UserTier.updateOne(
        { userId },
        {
          subscriptionId,
          customerId: customer,
          tier: plan.nickname || "Unknown",
          status,
          currentPeriodEnd: new Date(current_period_end * 1000),
        },
        { upsert: true }
      );

      console.log("Database update result:", updateResult);
      console.log("UserTier updated successfully.");
    }

    res.status(200).send("Webhook handled");
  } catch (err) {
    console.error("Error processing webhook:", err.message);
    res.status(500).send(`Webhook Error: ${err.message}`);
  }
});







app.use(express.json());
const collabRoutes = require("./routes/collabRoutes");
app.use("/api/collab", collabRoutes);



app.post("/create-checkout-session", async (req, res) => {
  const { userId, priceId } = req.body;

  if (!userId || !priceId) {
    return res.status(400).json({ error: "Missing userId or priceId" });
  }

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "subscription", // Change from "payment" to "subscription"
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: "https://your-site.com/success",
      cancel_url: "https://your-site.com/cancel",
      client_reference_id: userId, // Attach the userId here
    });
    

    res.json({ url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({ error: error.message });
  }
});




app.get("/get-subscription", async (req, res) => {
  const { userId } = req.query;

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "User ID is required." });
  }

  try {
    const subscription = await Subscription.findOne({ userId });
    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: "No active subscription found for the user.",
      });
    }

    res.json({ success: true, subscriptionId: subscription.subscriptionId });
  } catch (error) {
    console.error("Error fetching subscription:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch subscription.",
    });
  }
});




app.get("/api/get-user-tier/:userId", async (req, res) => {
  const { userId } = req.params;

  if (!userId) {
    return res.status(400).json({ success: false, message: "User ID is required." });
  }

  try {
    // Fetch subscription from database
    const subscription = await Subscription.findOne({ userId });

    let tier = "Freemium"; // Default to Freemium
    let status = "active";
    let currentPeriodEnd = null;

    if (subscription) {
      // Map the subscription plan ID to a tier
      const tierMapping = {
        "price_1QgyeaHt9BB7buYyq5AqBnLY": "Basic Month",
        "price_1Qgyg8Ht9BB7buYyvjldBtmc": "Premium Month",
        "price_1QhbNPHt9BB7buYy7k3LihZG": "Basic Year",
        "price_1QhbQVHt9BB7buYyY9EbJ0Hr": "Premium Year",
      };

      tier = tierMapping[subscription.planId] || "Freemium";
      status = subscription.status;
      currentPeriodEnd = subscription.currentPeriodEnd;
    }

    // Save or update the UserTier in the database
    await UserTier.updateOne(
      { userId }, // Find by userId
      { userId, tier, status, currentPeriodEnd }, // Update or insert this data
      { upsert: true } // If it doesn't exist, create it
    );

    res.json({
      success: true,
      tier,
      status,
      currentPeriodEnd,
    });
  } catch (error) {
    console.error("Error fetching or saving user tier:", error);
    res.status(500).json({ success: false, message: "Failed to fetch or save user tier." });
  }
});



app.post("/cancel-subscription", async (req, res) => {
  const { subscriptionId } = req.body;

  console.log("Received subscriptionId:", subscriptionId);

  // Validate subscriptionId
  if (!subscriptionId) {
    return res
      .status(400)
      .json({ success: false, message: "Subscription ID is required." });
  }

  try {
    // Check subscription existence
    console.log("Fetching subscription details...");
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    console.log("Fetched subscription details:", subscription);

    // Cancel the subscription
    console.log("Attempting to cancel subscription...");
    const canceledSubscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true, // Cancels at the end of the billing cycle
    });

    console.log("Canceled subscription details:", canceledSubscription);

    // Remove the subscription from your database
    console.log("Deleting subscription from database...");
    const dbResponse = await Subscription.deleteOne({ subscriptionId });
    console.log("Database response:", dbResponse);

    res.json({
      success: true,
      message: "Subscription set to cancel at the end of the billing cycle.",
      canceledSubscription,
    });
  } catch (error) {
    console.error("Error canceling subscription:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to cancel subscription.",
    });
  }
});



const LoginToken = require("./models/LoginToken"); // Make sure the path is correct



// Add a new endpoint to store or update the user’s current login token
app.put("/api/logintoken", async (req, res) => {
  try {
    const { userId, token } = req.body;
    if (!userId || !token) {
      return res.status(400).json({ success: false, message: "userId and token are required." });
    }

    // Upsert => if document with userId doesn’t exist, create it; otherwise update
    await LoginToken.findOneAndUpdate(
      { userId: userId },
      { token: token },
      { upsert: true, new: true } 
    );

    return res.status(200).json({ success: true, message: "Token stored or updated successfully." });
  } catch (error) {
    console.error("Error storing token:", error);
    return res.status(500).json({ success: false, message: "Failed to store token." });
  }
});


// Add a new endpoint to retrieve the user’s current login token
app.get("/api/logintoken/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required." });
    }

    // Find the login token by userId
    const loginToken = await LoginToken.findOne({ userId });

    if (!loginToken) {
      return res.status(404).json({ success: false, message: "Login token not found." });
    }

    return res.status(200).json({
      success: true,
      data: {
        userId: loginToken.userId,
        token: loginToken.token,
      },
    });
  } catch (error) {
    console.error("Error retrieving login token:", error);
    return res.status(500).json({ success: false, message: "Failed to retrieve login token." });
  }
});


require("./models/Task"); // Make sure this path is correct
const Task = mongoose.model("Task");
const { GridFsStorage } = require('multer-gridfs-storage');
const { GridFSBucket } = require('mongodb');
const connection = require("./config/mongodbConnection"); // Import the connection
const multer  = require('multer')
const parseFormData = multer().none(); // Parses fields in multipart/form-data

let gfs;

connection.on("connected", () => {
  console.log("Initializing GridFSBucket...");

  const bucket = new GridFSBucket(connection.db, {
    bucketName: "resources", // Set your bucket name
  });

  app.locals.bucket = bucket; // Store the bucket in app.locals for global access
  gfs = bucket; // Optional: Assign bucket to a variable for immediate use

  console.log("GridFSBucket initialized.");
});


const allowedMimeTypes = [
  // Documents
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/pdf",
  "application/rtf",
  "text/plain",
  "application/vnd.oasis.opendocument.text",
  // Spreadsheets
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "application/csv",
  "text/tab-separated-values",
  "application/vnd.oasis.opendocument.spreadsheet",
  // Presentations
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.presentation",
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/bmp",
  "image/tiff",
  "image/svg+xml",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "audio/aac",
  "audio/webm",
  "audio/flac",
  // Video
  "video/mp4",
  "video/x-msvideo",
  "video/webm",
  "video/quicktime",
  "video/x-ms-wmv",
  "video/x-flv",
  "video/x-matroska",
  // Compressed Files
  "application/zip",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/gzip",
  // Miscellaneous
  "application/epub+zip",
  "application/x-mobipocket-ebook",
  "text/html",
  "application/javascript",
  "text/css",
  "application/json",
  "text/json",
  "application/xml",
  "text/x-python",
  "text/x-java-source",
  "text/x-c++src",
];


const gridFsStorage = new GridFsStorage({
  db: connection,
  options: { useNewUrlParser: true, useUnifiedTopology: true },
  file: (req, file) => {
    const folderId = req.params.folderId || req.body.folderId; // Support both URL and body
    console.log("GridFsStorage folderId:", folderId); // Log folderId
    if (!folderId) {
      return Promise.reject(new Error("Folder ID is required."));
    }
    return {
      bucketName: "resources",
      filename: `${Date.now()}-${file.originalname}`,
      metadata: { folderId },
    };
  },
});



// Update your Multer instance to use this storage
const gridFsUpload = multer({ storage: gridFsStorage });

// Updated File Upload Endpoint
app.post("/gridfs-upload/:folderId", gridFsUpload.single("file"), async (req, res) => {
  try {
    const { folderId } = req.params;
    const folder = await Folder.findById(folderId);
    const userTier = await UserTier.findOne({ userId: folder.userId }) || { tier: "Freemium" };

    // Storage limits (in bytes)
    const storageLimits = {
      "Freemium": 100 * 1024 * 1024,    // 100MB
      "Basic Month": 500 * 1024 * 1024, // 500MB
      "Basic Year": 500 * 1024 * 1024,
      "Premium Month": 1500 * 1024 * 1024, // 1.5GB
      "Premium Year": 1500 * 1024 * 1024
    };

    // Calculate current project storage
    const files = await gfs.find({ 'metadata.folderId': folderId }).toArray();
    const currentStorage = files.reduce((sum, file) => sum + file.length, 0);

    // Check storage limit
    if ((currentStorage + req.file.size) > storageLimits[userTier.tier]) {
      // Clean up the uploaded file
      await gfs.delete(new mongoose.Types.ObjectId(req.file.id));
      return res.status(403).json({
        message: `Storage limit exceeded (${storageLimits[userTier.tier]/1024/1024}MB/project)`
      });
    }

    res.status(201).json({ message: "File uploaded successfully", file: req.file });

  } catch (error) {
    console.error("Error uploading file:", error);
    res.status(500).json({ message: "Server error during file upload" });
  }
});

app.get("/api/folders/:folderId/resources", async (req, res) => {
  const { folderId } = req.params;

  try {
    const files = await gfs.find({ "metadata.folderId": folderId }).toArray(); // Fetch files by folderId
    if (!files || files.length === 0) {
      return res.status(404).json({ message: "No resources found." });
    }

    const resources = files.map((file) => ({
      _id: file._id,
      filename: file.filename,
      contentType: file.contentType,
    }));

    res.status(200).json(resources);
  } catch (error) {
    console.error("Error fetching resources:", error);
    res.status(500).json({ message: "Server error while fetching resources." });
  }
});
app.get("/api/folders/:folderId/resources/:filename", async (req, res) => {
  const { filename } = req.params;

  try {
    const file = await gfs.find({ filename }).toArray();

    if (!file || file.length === 0) {
      return res.status(404).json({ message: "File not found" });
    }

    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`); // Set download header
    gfs.openDownloadStreamByName(filename).pipe(res);
  } catch (error) {
    console.error("Error fetching file:", error);
    res.status(500).json({ message: "Server error while fetching file." });
  }
});




app.delete("/api/resources/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;

    const bucket = new mongoose.mongo.GridFSBucket(connection.db, {
      bucketName: "resources",
    });

    // Delete file from GridFS
    bucket.delete(new mongoose.Types.ObjectId(fileId), (err) => {
      if (err) {
        console.error("Error deleting file from GridFS:", err);
        return res.status(500).json({ message: "Failed to delete file." });
      }
    });

    // Remove the file reference from Folder
    await Folder.updateOne(
      { "files._id": fileId },
      { $pull: { files: { _id: fileId } } }
    );

    res.status(200).json({ message: "File deleted successfully." });
  } catch (error) {
    console.error("Error deleting resource:", error);
    res.status(500).json({ message: "Server error while deleting resource." });
  }
});


console.log("Folder model loaded:", Folder);



const notebookRoute = require("./routes/notebook");

app.use("/api/notebook", notebookRoute);


const authRoute = require("./routes/auth");
const userRoute = require("./routes/user");

const mongodbConnection = require("./config/mongodbConnection");
const { createRequire } = require("module");


app.use("/api/auth", authRoute);
app.use("/api/user", userRoute);

app.get("/", (req, res) => res.send("Hello World!"));


require('./models/PdfModel')
const PdfSchema = mongoose.model('PdfDetails')

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, './files')
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null,uniqueSuffix+file.originalname)
  }
})

const upload = multer({ storage: storage })


const seedBookPdf = async () => {
  const bookFileName = "KNOW CHANGE GROW by Tevin Parboosingh (1).pdf";
  
  try {
    const existingPdf = await PdfSchema.findOne({ pdf: bookFileName });
    if (!existingPdf) {
      await PdfSchema.create({ pdf: bookFileName });
      console.log("Seeded book PDF into the database.");
    } else {
      console.log("Book PDF already exists in the database.");
    }
  } catch (error) {
    console.error("Error seeding book PDF:", error);
  }
};

// Call the seeding function when the server starts
seedBookPdf();
const pdfParse = require("pdf-parse");

app.post('/api/track-download', (req, res) => {
  // Logic to log download (e.g., increment a counter in the database)
  console.log('Download tracked');
  res.status(200).send('Download tracked');
});

app.post("/upload-files", upload.single("file"), async (req, res) => {
  try {
    const { userId } = req.query; // Get userId from query parameters
    console.log("Uploaded file info:", req.file);

    const filePath = req.file.path;
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdfParse(dataBuffer);

    const fileName = req.file.filename;
    const extractedText = pdfData.text;

    if (!extractedText) {
      console.error("No text extracted from PDF:", fileName);
      return res.status(400).json({ message: "No text found in the uploaded PDF." });
    }

    const savedPdf = await PdfSchema.create({
      pdf: fileName,
      text: extractedText,
      type: "upload",
      userId, // Include userId in the document
    });

    console.log("Saved PDF with extracted text:", savedPdf);

    res.json({ status: "ok", extractedText });
  } catch (error) {
    console.error("Error uploading and extracting PDF:", error);
    res.status(500).json({ status: "error", message: "Failed to upload and extract text" });
  }
});


app.use("/files", express.static("files"));

app.get("/get-files", async (req, res) => {
  const { userId } = req.query; // Get userId from query parameters

  try {
    const userFiles = await PdfSchema.find({ userId }); // Fetch all entries for the user
    res.status(200).json({ status: "ok", data: userFiles });
  } catch (error) {
    console.error("Error fetching files:", error);
    res.status(500).json({ status: "error", message: "Failed to fetch files" });
  }
});


router.delete("/delete-upload/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Find and delete the upload
    const result = await PdfSchema.findByIdAndDelete(id);

    if (!result) {
      return res.status(404).json({ status: "error", message: "Upload not found" });
    }

    // Optionally delete the associated file from the server
    const filePath = `./files/${result.pdf}`;
    fs.unlinkSync(filePath); // Delete the file if it exists

    res.status(200).json({ status: "ok", message: "Upload deleted successfully" });
  } catch (error) {
    console.error("Error deleting upload:", error);
    res.status(500).json({ status: "error", message: "Failed to delete upload" });
  }
});



app.delete("/api/delete-file/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query; // Get userId from query parameters

    const result = await PdfSchema.findOneAndDelete({ _id: id, userId }); // Ensure the document belongs to the user
    if (!result) {
      return res.status(404).json({ status: "error", message: "Submission not found" });
    }
    res.json({ status: "ok", message: "Submission deleted successfully" });
  } catch (error) {
    console.error("Error deleting submission:", error);
    res.status(500).json({ status: "error", message: "Failed to delete submission" });
  }
});




// Delete Folder by ID Endpoint
app.delete("/api/folders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const folder = await Folder.findByIdAndDelete(id);

    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    res.status(200).json({ message: "Folder deleted successfully" });
  } catch (error) {
    console.error("Error deleting folder by ID:", error);
    res.status(500).json({ message: "Server error while deleting folder by ID" });
  }
});

// Get Folder by ID Endpoint
app.get("/api/folders/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const folder = await Folder.findById(id);

    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    res.status(200).json(folder);
  } catch (error) {
    console.error("Error fetching folder by ID:", error);
    res.status(500).json({ message: "Server error while fetching folder by ID" });
  }
});


const TaskModel = require('./models/Task'); // Adjust the path as necessary
require("./models/Task"); // Ensure this file exists and is correct


app.post('/api/folders/:folderId/tasks', async (req, res) => {
  console.log('Route hit: POST /api/folders/:folderId/tasks');
  console.log('Request Params:', req.params);
  console.log('Request Body:', req.body);

  try {
    const { folderId } = req.params;
    const { text, start, end, backColor } = req.body;

    // Handle case where folderId is "null" (no folder/project)
    if (folderId === 'null') {
      const newTask = new Task({
        projectId: null, // No folder/project
        text,
        start: new Date(start),
        end: new Date(end),
        backColor,
      });

      const savedTask = await newTask.save();
      console.log('Task saved without folder:', savedTask);
      return res.status(201).json(savedTask);
    }

    // Check if folder exists
    const folder = await Folder.findById(folderId);
    if (!folder) {
      console.log('Folder not found');
      return res.status(404).json({ message: 'Folder not found.' });
    }
    console.log('Folder found:', folder);

    // Create task associated with a folder
    const newTask = new Task({
      projectId: folderId,
      text,
      start: new Date(start),
      end: new Date(end),
      backColor,
    });

    const savedTask = await newTask.save();
    console.log('Task saved with folder:', savedTask);

    res.status(201).json(savedTask);
  } catch (error) {
    console.error('Error creating task:', error);
    res.status(500).json({ message: 'Server error while creating task.' });
  }
});



app.get('/api/folders/:folderId/tasks', async (req, res) => {
  console.log('Route hit: GET /api/folders/:folderId/tasks');
  console.log('Request Params:', req.params);

  try {
    const { folderId } = req.params;

    // Check if folder exists
    const folder = await Folder.findById(folderId);
    if (!folder) {
      console.log('Folder not found');
      return res.status(404).json({ message: 'Folder not found.' });
    }
    console.log('Folder found:', folder);

    // Retrieve all tasks for the folder
    const tasks = await Task.find({ projectId: folderId });
    console.log('Tasks retrieved:', tasks);

    res.status(200).json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ message: 'Server error while fetching tasks.' });
  }
});

app.put("/api/notebook/pages/:pageId/link-folder", async (req, res) => {
  try {
    const { pageId } = req.params;
    const { folderId } = req.body;
    console.log("Updating NotebookPage:", pageId, "with folderId:", folderId);
    
    if (folderId && !mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ message: "Invalid folder ID format." });
    }

    const updatedPage = await NotebookPage.findByIdAndUpdate(
      pageId,
      { folderId: folderId || null },
      { new: true }
    );

    if (!updatedPage) {
      console.log("No NotebookPage found with ID:", pageId);
      return res.status(404).json({ message: "Notebook page not found." });
    }

    console.log("Updated page:", updatedPage);
    res.status(200).json(updatedPage);
  } catch (error) {
    console.error("Error linking notebook page with folder:", error);
    res.status(500).json({ message: "Server error while updating folder link." });
  }
});

// New endpoint for collaborators to add a task (no JWT verification)
app.post("/api/collab/folders/:folderId/tasks", async (req, res) => {
  try {
    const { folderId } = req.params;
    // Destructure the task details from the request body.
    // (Viewers/editors may not send a userId.)
    const { userId, text, start, end, backColor } = req.body;
    
    // Ensure required task fields are present.
    if (!text || !start || !end) {
      return res.status(400).json({ message: "Missing required fields: text, start, or end." });
    }
    
    // Check if the folder exists.
    const folder = await Folder.findById(folderId);
    if (!folder) {
      return res.status(404).json({ message: "Folder not found." });
    }
    
    // Since collaborators may not have a userId, we use a fallback.
    // In this example, we assign the folder owner's userId.
    const finalUserId = userId || folder.userId;
    if (!finalUserId) {
      return res.status(400).json({ message: "A valid userId is required." });
    }
    
    // Create a new Task.
    const newTask = new Task({
      userId: finalUserId,    // Use the provided userId or fallback to the folder owner’s userId.
      projectId: folderId,
      text,
      start: new Date(start),
      end: new Date(end),
      backColor,
    });
    
    const savedTask = await newTask.save();
    return res.status(201).json(savedTask);
  } catch (error) {
    console.error("Error creating collab task:", error);
    return res.status(500).json({ message: "Server error while creating task." });
  }
});



app.delete('/api/folders/:folderId/tasks/:taskId', async (req, res) => {
  console.log('Route hit: DELETE /api/folders/:folderId/tasks/:taskId');
  console.log('Request Params:', req.params);

  try {
    const { folderId, taskId } = req.params;

    // Check if the folder exists
    const folder = await Folder.findById(folderId);
    if (!folder) {
      console.log('Folder not found');
      return res.status(404).json({ message: 'Folder not found.' });
    }

    // Delete the task
    const deletedTask = await Task.findOneAndDelete({
      _id: taskId,
      projectId: folderId,
    });

    if (!deletedTask) {
      console.log('Task not found');
      return res.status(404).json({ message: 'Task not found.' });
    }

    console.log('Task deleted:', deletedTask);
    res.status(200).json({ message: 'Task deleted successfully.', task: deletedTask });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ message: 'Server error while deleting task.' });
  }
});

app.put('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { text, start, end, isComplete } = req.body;

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      { text, start: new Date(start), end: new Date(end), isComplete },
      { new: true, runValidators: true }
    );

    if (!updatedTask) {
      return res.status(404).json({ message: 'Task not found.' });
    }

    res.status(200).json(updatedTask);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ message: 'Server error while updating task.' });
  }
});






// Update a task
router.put('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { text, start, end, isComplete } = req.body;

    const updatedTask = await Task.findByIdAndUpdate(
      taskId,
      { text, start, end, isComplete },
      { new: true, runValidators: true }
    );

    if (!updatedTask) {
      return res.status(404).json({ message: 'Task not found.' });
    }

    res.status(200).json(updatedTask);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ message: 'Server error while updating task.' });
  }
});

app.delete("/api/tasks/:taskId", async (req, res) => {
  const { taskId } = req.params;

  try {
    const result = await TaskModel.findByIdAndDelete(taskId); // Adjust based on your ORM or database
    if (!result) {
      return res.status(404).json({ message: "Task not found" });
    }
    res.status(200).json({ message: "Task deleted successfully" });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ message: "Server error" });
  }
});



// Get all tasks
app.get('/api/tasks', async (req, res) => {
  console.log('Route hit: GET /api/tasks');

  try {
    // Retrieve all tasks
    const tasks = await Task.find();
    console.log('Tasks retrieved:', tasks);

    res.status(200).json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ message: 'Server error while fetching tasks.' });
  }
});




// Create a task under a user's folder
// server.js

app.post("/api/users/:userId/folders/:folderId/tasks", async (req, res) => {
  console.log('Route hit: POST /api/users/:userId/folders/:folderId/tasks');
  console.log('Request Params:', req.params);
  console.log('Request Body:', req.body);

  try {
    const { userId, folderId } = req.params;
    const { text, start, end, backColor } = req.body;

    // Validate required fields
    if (!text || !start || !end) {
      return res.status(400).json({ message: "Missing required fields: text, start, or end." });
    }

    // Handle case where folderId is "null" (no folder/project)
    if (folderId === 'null') {
      const newTask = new Task({
        userId: userId, // Include userId
        projectId: null, // No folder/project
        text,
        start: new Date(start),
        end: new Date(end),
        backColor,
      });

      const savedTask = await newTask.save();
      console.log('Task saved without folder:', savedTask);
      return res.status(201).json(savedTask);
    }

    // Check if folder exists and belongs to the user
    const folder = await Folder.findOne({ _id: folderId, userId });
    if (!folder) {
      console.log('Folder not found or does not belong to user');
      return res.status(404).json({ message: 'Folder not found or does not belong to user.' });
    }
    console.log('Folder found:', folder);

    // Create task associated with a folder
    const newTask = new Task({
      userId: userId, // Include userId
      projectId: folderId,
      text,
      start: new Date(start),
      end: new Date(end),
      backColor,
    });

    const savedTask = await newTask.save();
    console.log('Task saved with folder:', savedTask);

    res.status(201).json(savedTask);
  } catch (error) {
    console.error('Error creating task:', error.message);
    console.error('Error Stack:', error.stack);
    res.status(500).json({ message: 'Server error while creating task.', error: error.message });
  }
});


// Get tasks for a specific user
app.get("/api/users/:userId/tasks", async (req, res) => {
  try {
    const { userId } = req.params;

    // Fetch all folders for the user
    const userFolders = await Folder.find({ userId }).select("_id");
    const folderIds = userFolders.map((f) => f._id);

    // Fetch all tasks belonging to these folders or with projectId null
    const tasks = await Task.find({
      $or: [
        { projectId: { $in: folderIds } },
        { projectId: null }
      ]
    });

    res.status(200).json(tasks);
  } catch (error) {
    console.error("Error fetching tasks for user:", error);
    res.status(500).json({ message: "Server error while fetching tasks." });
  }
});


// Update a task for a specific user
// Update a task for a specific user
app.put("/api/users/:userId/tasks/:taskId", async (req, res) => {
  try {
    const { userId, taskId } = req.params;
    const { text, start, end, isComplete, backColor, projectId } = req.body;

    // Find the task by ID
    const task = await Task.findById(taskId);
    if (!task) {
      console.log(`Task with ID ${taskId} not found.`);
      return res.status(404).json({ message: "Task not found." });
    }

    // Verify that the task belongs to the user
    if (!task.userId) {
      console.log(`Task userId is undefined for Task ID ${taskId}.`);
      return res.status(500).json({ message: "Task userId is undefined." });
    }

    if (task.userId.toString() !== String(userId)) {
      console.log(`User ID mismatch: task.userId = ${task.userId}, route userId = ${userId}`);
      return res.status(403).json({ message: "You do not have permission to update this task." });
    }

    // If task has projectId, verify folder ownership
    if (task.projectId) {
      const folder = await Folder.findOne({ _id: task.projectId, userId });
      if (!folder) {
        console.log(`Folder with ID ${task.projectId} not found or does not belong to user.`);
        return res.status(404).json({ message: "Folder for this task not found or not owned by user." });
      }
    }

    // Update the task fields
    task.text = text !== undefined ? text : task.text;
    task.start = start ? new Date(start) : task.start;
    task.end = end ? new Date(end) : task.end;
    task.isComplete = isComplete !== undefined ? isComplete : task.isComplete;
    task.backColor = backColor !== undefined ? backColor : task.backColor;

    // Handle projectId update
    if (projectId !== undefined) {
      if (projectId === null || projectId === "null") {
        task.projectId = null;
      } else {
        // Verify that the new folder exists and belongs to the user
        const folder = await Folder.findOne({ _id: projectId, userId });
        if (!folder) {
          console.log(`Folder with ID ${projectId} not found or does not belong to user.`);
          return res.status(404).json({ message: "Folder not found or does not belong to user." });
        }
        task.projectId = projectId;
      }
    }

    // Log the task before saving
    console.log(`Task before saving: ${JSON.stringify(task)}`);

    const updatedTask = await task.save();

    // Log the task after saving
    console.log(`Task after saving: ${JSON.stringify(updatedTask)}`);

    res.status(200).json(updatedTask);
  } catch (error) {
    console.error("Error updating task:", error.message);
    console.error("Error Stack:", error.stack);
    res.status(500).json({ message: "Server error while updating task.", error: error.message });
  }
});

// Delete a task for a specific user
app.delete("/api/users/:userId/folders/:folderId/tasks/:taskId", async (req, res) => {
  console.log("Route hit: DELETE /api/users/:userId/folders/:folderId/tasks/:taskId");
  try {
    const { userId, folderId, taskId } = req.params;

    if (folderId === 'null') {
      // Delete task with projectId: null
      const deletedTask = await Task.findOneAndDelete({
        _id: taskId,
        projectId: null,
        userId: userId,
      });

      if (!deletedTask) {
        return res.status(404).json({ message: "Task not found." });
      }

      return res.status(200).json({ message: "Task deleted successfully.", task: deletedTask });
    } else {
      // Check if folder belongs to user
      const folder = await Folder.findOne({ _id: folderId, userId });
      if (!folder) {
        return res.status(404).json({ message: "Folder not found or does not belong to user." });
      }

      // Delete the task associated with the folder
      const deletedTask = await Task.findOneAndDelete({
        _id: taskId,
        projectId: folderId,
        userId: userId,
      });

      if (!deletedTask) {
        return res.status(404).json({ message: "Task not found." });
      }

      return res.status(200).json({ message: "Task deleted successfully.", task: deletedTask });
    }
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ message: "Server error while deleting task." });
  }
});



app.post("/api/folders", async (req, res) => {
  try {
    const { name } = req.body;

    // Validate input
    if (!name) {
      return res.status(400).json({ message: "Folder name is required" });
    }

    // Check if folder with the same name exists
    const existingFolder = await Folder.findOne({ name });
    if (existingFolder) {
      return res.status(400).json({ message: "Folder name already exists" });
    }

    // Create new folder
    const newFolder = new Folder({ name, files: [] });
    await newFolder.save();

    res.status(201).json(newFolder);
  } catch (error) {
    console.error("Error creating folder:", error);
    res.status(500).json({ message: "Server error while creating folder" });
  }
});


app.get("/api/folders", async (req, res) => {
  try {
    const folders = await Folder.find();
    res.json(folders);
  } catch (error) {
    console.error("Error fetching folders:", error);
    res.status(500).json({ message: "Server error while fetching folders" });
  }
});






router.get("/:folderId/pages", async (req, res) => {
  const { folderId } = req.params;
  try {
    const pages = await NotebookPage.find({ folderId });
    res.status(200).json(pages);
  } catch (error) {
    console.error("Error fetching pages by folder:", error);
    res.status(500).json({ message: "Error fetching pages." });
  }
});


const Board = require('./models/Board'); // Adjust the path if necessary


/**
 * @route   POST /api/boards/:userid
 * @desc    Create a new board for a user
 * @access  Authenticated
 */
 app.post('/api/boards/:userid', async (req, res) => {
  const { userid } = req.params;
  const { name } = req.body;

  // Basic validation
  if (!name) {
    return res.status(400).json({ message: 'Board name is required.' });
  }

  try {
    // Check if a board with the same name exists for the user
    const existingBoard = await Board.findOne({ name, userId: userid });
    if (existingBoard) {
      return res.status(400).json({ message: 'Board name already exists for this user.' });
    }

    // Create a new board
    const newBoard = new Board({
      name,
      userId: userid,
      elements: [], // Initialize with empty elements
    });

    await newBoard.save();

    res.status(201).json(newBoard);
  } catch (error) {
    console.error('Error creating board:', error);
    res.status(500).json({ message: 'Server error while creating board.' });
  }
});

// GET /api/folders/:folderId/moodboards - Fetch moodboards linked to the folder
app.get('/api/folders/:folderId/moodboards', async (req, res) => {
  const { folderId } = req.params;

  // Validate folderId format
  if (!mongoose.Types.ObjectId.isValid(folderId)) {
    return res.status(400).json({ message: 'Invalid folder ID.' });
  }

  try {
    // Fetch moodboards linked to the specified folder
    const moodboards = await Board.find({ folderId });

    res.status(200).json(moodboards);
  } catch (error) {
    console.error('Error fetching moodboards:', error);
    res.status(500).json({ message: 'Server error while fetching moodboards.' });
  }
});

/**
 * @route   DELETE /api/boards/:userid/:boardId
 * @desc    Delete a board
 * @access  Authenticated
 */
 app.delete('/api/boards/:userid/:boardId', async (req, res) => {
  const { userid, boardId } = req.params;

  try {
    // Find and delete the board, ensuring it belongs to the user
    const board = await Board.findOneAndDelete({ _id: boardId, userId: userid });
    if (!board) {
      return res.status(404).json({ message: 'Board not found or already deleted.' });
    }

    res.status(200).json({ message: 'Board deleted successfully.' });
  } catch (error) {
    console.error('Error deleting board:', error);
    res.status(500).json({ message: 'Server error while deleting board.' });
  }
});



/**
 * @route   GET /api/boards/:userid
 * @desc    Retrieve all boards for a user
 * @access  Authenticated
 */
 app.get('/api/boards/:userid', async (req, res) => {
  const { userid } = req.params;
  
  try {
    const boards = await Board.find({ userId: userid });
    res.status(200).json(boards);
  } catch (error) {
    console.error('Error fetching boards:', error);
    res.status(500).json({ message: 'Server error while fetching boards.' });
  }
});


/**
 * @route   GET /api/boards/:userid/:boardId
 * @desc    Retrieve a specific board for a user
 * @access  Authenticated
 */
 app.get('/api/boards/:userid/:boardId', async (req, res) => {
  const { userid, boardId } = req.params;
  
  try {
    const board = await Board.findOne({ _id: boardId, userId: userid });
    if (!board) {
      return res.status(404).json({ message: 'Board not found.' });
    }
    res.status(200).json(board);
  } catch (error) {
    console.error('Error fetching board:', error);
    res.status(500).json({ message: 'Server error while fetching board.' });
  }
});



// Utility function to validate ObjectId
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ======================
// Folder Linkage Endpoints
// ======================

// Link a board to a folder
app.put('/api/boards/:id/link-folder', async (req, res) => {
  const boardId = req.params.id;
  const { folderId } = req.body;

  // Validate boardId
  if (!isValidObjectId(boardId)) {
    return res.status(400).json({ message: 'Invalid board ID.' });
  }

  // Validate folderId if provided
  if (folderId && !isValidObjectId(folderId)) {
    return res.status(400).json({ message: 'Invalid folder ID.' });
  }

  try {
    const board = await Board.findById(boardId);
    if (!board) {
      return res.status(404).json({ message: 'Board not found.' });
    }

    if (folderId) {
      const folder = await Folder.findById(folderId);
      if (!folder) {
        return res.status(404).json({ message: 'Folder not found.' });
      }
    }

    board.folderId = folderId || null; // Link or unlink the folder
    await board.save();

    res.status(200).json(board);
  } catch (error) {
    console.error('Error linking board to folder:', error);
    res.status(500).json({ message: 'Server error while linking board to folder.', error });
  }
});



// Update a board's name, elements, or folder linkage
app.put('/api/boards/:userId/:id', async (req, res) => {
  const userId = req.params.userId;
  const boardId = req.params.id;
  const { name, elements, folderId } = req.body;

  if (!isValidObjectId(userId) || !isValidObjectId(boardId)) {
    return res.status(400).json({ message: 'Invalid user ID or board ID.' });
  }

  if (folderId && !isValidObjectId(folderId)) {
    return res.status(400).json({ message: 'Invalid folder ID.' });
  }

  try {
    const board = await Board.findOne({ _id: boardId, userId });
    if (!board) {
      return res.status(404).json({ message: 'Board not found.' });
    }

    if (name !== undefined) board.name = name;
    if (elements !== undefined) board.elements = elements;
    if (folderId !== undefined) {
      if (folderId) {
        const folder = await Folder.findById(folderId);
        if (!folder) {
          return res.status(404).json({ message: 'Folder not found.' });
        }
      }
      board.folderId = folderId || null;
    }

    await board.save();
    res.status(200).json(board);
  } catch (error) {
    console.error('Error updating board:', error);
    res.status(500).json({ message: 'Server error while updating board.', error });
  }
});



const crypto = require("crypto");




app.get("/api/collaboration/:workspaceId/:token", async (req, res) => {
  const { workspaceId, token } = req.params;

  try {
    const workspace = await Workspace.findById(workspaceId);

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    // Optional: Validate token if tokens are saved in the database
    res.status(200).json({ workspace, token });
  } catch (error) {
    console.error("Error fetching workspace:", error);
    res.status(500).json({ message: "Server error" });
  }
});



app.post("/api/paste-text", async (req, res) => {
  const { name, text } = req.body;

  if (!name || !text) {
    return res.status(400).json({ status: "error", message: "Name and text are required." });
  }

  try {
    // Save the text with the given name to the database
    await PdfSchema.create({
      pdf: name, // Use `name` as the identifier or display name
      text, // Save the actual text
    });

    res.status(200).json({ status: "ok", message: "Text saved successfully" });
  } catch (error) {
    console.error("Error saving pasted text:", error);
    res.status(500).json({ status: "error", message: "Failed to save text" });
  }
});


app.get("/api/get-text/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId } = req.query; // Get userId from query parameters

    const pdf = await PdfSchema.findOne({ _id: id, userId }); // Ensure the PDF belongs to the user

    if (!pdf) {
      console.error("PDF not found with ID:", id);
      return res.status(404).json({ message: "PDF not found" });
    }

    if (!pdf.text) {
      console.error("No text found in PDF record:", pdf);
      return res.status(400).json({ message: "No text found in this PDF record." });
    }

    console.log("Fetched text for PDF:", pdf.text);
    res.status(200).json({ text: pdf.text });
  } catch (error) {
    console.error("Error fetching PDF text:", error);
    res.status(500).json({ message: "Failed to fetch PDF text" });
  }
});



app.post("/api/convert", async (req, res) => {
  const { text } = req.body;


  // Set up audio config and speech config
  const audioConfig = AudioConfig.fromAudioFileOutput("./file.wav");
  const subscriptionKey = process.env.SPEECH_SUBSCRIPTION_KEY;
  const serviceRegion = process.env.SPEECH_REGION;
  const speechConfig = SpeechConfig.fromSubscription(subscriptionKey, serviceRegion);

  // Create synthesizer and start speaking
  const synthesizer = new SpeechSynthesizer(speechConfig, audioConfig);
  await synthesizer.speakTextAsync(text);

  // Wait for file to finish writing before continuing
  await new Promise((resolve, reject) => {
    const interval = setInterval(() => {
      const stats = fs.statSync("./file.wav");
      if (stats.size > 0) {
        clearInterval(interval);
        resolve();
      }
    }, 100);
  });


  // Convert the audio file to M4A with AAC encoding and desired bitrate
  const outputFilePath = path.join(__dirname, "file.m4a");
  await new Promise((resolve, reject) => {
    ffmpeg()
      .input("./file.wav")
      .audioCodec("aac")
      .audioBitrate(128)
      .output(outputFilePath)
      .on("end", resolve)
      .on("error", reject)
      .run();
  });

  // Read the converted audio file into memory and delete the file
  const audio = fs.readFileSync(outputFilePath);
  fs.unlinkSync(outputFilePath);

  // Set headers for audio file and send it as a response
  res.setHeader("Content-Type", "audio/m4a");
  res.setHeader("Content-Disposition", "attachment; filename=audio.m4a");
  res.send(audio);
});




/**
 * GET /api/users/:userId/folders
 * Get all folders for a user
 */
 app.get("/api/users/:userId/folders", async (req, res) => {
  try {
    const { userId } = req.params;
    const folders = await Folder.find({ userId });
    res.json(folders);
  } catch (error) {
    console.error("Error fetching folders:", error);
    res.status(500).json({ message: "Server error while fetching folders" });
  }
});

/**
 * GET /api/users/:userId/folders/:folderId
 * Get a single folder by ID for that user
 */
app.get("/api/users/:userId/folders/:folderId", async (req, res) => {
  try {
    const { userId, folderId } = req.params;
    const folder = await Folder.findOne({ _id: folderId, userId });
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }
    res.status(200).json(folder);
  } catch (error) {
    console.error("Error fetching folder by ID:", error);
    res
      .status(500)
      .json({ message: "Server error while fetching folder by ID" });
  }
});

/**
 * DELETE /api/users/:userId/folders/:folderId
 * Delete a folder for that user
 */
app.delete("/api/users/:userId/folders/:folderId", async (req, res) => {
  try {
    const { userId, folderId } = req.params;
    const folder = await Folder.findOneAndDelete({ _id: folderId, userId });
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }
    res.status(200).json({ message: "Folder deleted successfully" });
  } catch (error) {
    console.error("Error deleting folder by ID:", error);
    res.status(500).json({ message: "Server error while deleting folder" });
  }
});

// ======= Task Endpoints (User + Folder Scoped) =======

// Create a task under a folder
app.post("/api/users/:userId/folders/:folderId/tasks", async (req, res) => {
  console.log("Route hit: POST /api/users/:userId/folders/:folderId/tasks");
  try {
    const { userId, folderId } = req.params;
    const { text, start, end, backColor } = req.body;

    // Confirm folder belongs to user
    const folder = await Folder.findOne({ _id: folderId, userId });
    if (!folder) {
      return res
        .status(404)
        .json({ message: "Folder not found or does not belong to user." });
    }

    // Create a new Task
    const newTask = new Task({
      projectId: folderId,
      text,
      start: new Date(start),
      end: new Date(end),
      backColor,
    });
    const savedTask = await newTask.save();
    console.log("Task saved with folder:", savedTask);
    res.status(201).json(savedTask);
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ message: "Server error while creating task." });
  }
});

// Get tasks for a specific folder
app.get("/api/users/:userId/folders/:folderId/tasks", async (req, res) => {
  console.log("Route hit: GET /api/users/:userId/folders/:folderId/tasks");
  try {
    const { userId, folderId } = req.params;
    const folder = await Folder.findOne({ _id: folderId, userId });
    if (!folder) {
      return res
        .status(404)
        .json({ message: "Folder not found or does not belong to user." });
    }
    const tasks = await Task.find({ projectId: folderId });
    res.status(200).json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ message: "Server error while fetching tasks." });
  }
});

// Delete a task
app.delete("/api/users/:userId/folders/:folderId/tasks/:taskId", async (req, res) => {
  console.log("Route hit: DELETE /api/users/:userId/folders/:folderId/tasks/:taskId");
  try {
    const { userId, folderId, taskId } = req.params;
    // Check if folder belongs to user
    const folder = await Folder.findOne({ _id: folderId, userId });
    if (!folder) {
      return res
        .status(404)
        .json({ message: "Folder not found or does not belong to user." });
    }
    // Delete the task
    const deletedTask = await Task.findOneAndDelete({
      _id: taskId,
      projectId: folderId,
    });
    if (!deletedTask) {
      return res.status(404).json({ message: "Task not found." });
    }
    res
      .status(200)
      .json({ message: "Task deleted successfully.", task: deletedTask });
  } catch (error) {
    console.error("Error deleting task:", error);
    res.status(500).json({ message: "Server error while deleting task." });
  }
});

// Update a task (no userId in Task, so you must confirm folder ownership)
app.put("/api/users/:userId/tasks/:taskId", async (req, res) => {
  try {
    const { userId, taskId } = req.params;
    const { text, start, end, isComplete, backColor } = req.body;

    // We need to find the task, find the folder it belongs to, ensure that folder belongs to user
    const task = await Task.findById(taskId);
    if (!task) {
      return res.status(404).json({ message: "Task not found." });
    }
    // Now check if that folder belongs to the user
    const folder = await Folder.findOne({ _id: task.projectId, userId });
    if (!folder) {
      return res
        .status(404)
        .json({ message: "Folder for this task not found or not owned by user." });
    }

    // Safe to update
    task.text = text !== undefined ? text : task.text;
    task.start = start ? new Date(start) : task.start;
    task.end = end ? new Date(end) : task.end;
    task.isComplete = isComplete !== undefined ? isComplete : task.isComplete;
    task.backColor = backColor !== undefined ? backColor : task.backColor;

    const updatedTask = await task.save();
    res.status(200).json(updatedTask);
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({ message: "Server error while updating task." });
  }
});

// Optional: Get all tasks for a user (if needed)
app.get("/api/users/:userId/tasks", async (req, res) => {
  try {
    const { userId } = req.params;
    // To get all tasks, we find all folders that belong to the user, then find tasks that match those folder IDs
    const userFolders = await Folder.find({ userId }).select("_id");
    const folderIds = userFolders.map((f) => f._id);

    const tasks = await Task.find({ projectId: { $in: folderIds } });
    res.status(200).json(tasks);
  } catch (error) {
    console.error("Error fetching tasks for user:", error);
    res.status(500).json({ message: "Server error while fetching tasks." });
  }
});



/**
 * POST /api/users/:userId/folders
 * Create a new folder for a specific user
 */
 // Updated Folder Creation Endpoint
app.post("/api/users/:userId/folders", async (req, res) => {
  try {
    const { userId } = req.params;
    const { name } = req.body;

    // Get user tier
    const userTier = await UserTier.findOne({ userId }) || { tier: "Freemium" };
    
    // Project limits configuration
    const projectLimits = {
      "Freemium": 5,
      "Basic Month": 10,
      "Basic Year": 10,
      "Premium Month": 30,
      "Premium Year": 30,
      "Premium": 30 // Fallback
    };

    // Count existing projects
    const currentProjectCount = await Folder.countDocuments({ userId });

    // Check limit
    if (currentProjectCount >= projectLimits[userTier.tier]) {
      return res.status(403).json({
        message: `Tier limit reached (${projectLimits[userTier.tier]} projects max). Upgrade for more.`
      });
    }

    // Existing folder creation logic
    const existingFolder = await Folder.findOne({ userId, name });
    if (existingFolder) {
      return res.status(400).json({ message: "Folder name already exists" });
    }

    const newFolder = new Folder({ userId, name, files: [] });
    await newFolder.save();
    res.status(201).json(newFolder);

  } catch (error) {
    console.error("Error creating folder:", error);
    res.status(500).json({ message: "Server error while creating folder" });
  }
});

// Log environment variables (for debugging purposes only)
console.log('Azure Speech Key:', process.env.FRONT_SPEECH ? 'Configured' : 'Missing');
console.log('Azure Speech Region:', process.env.SPEECH_REGION ? process.env.SPEECH_REGION : 'Missing');




const qs = require('qs'); // Ensure qs is imported if used
const fs = require("fs");

const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}


// GET /api/tts/voices
app.get('/api/tts/voices', async (req, res) => {
  try {
    const response = await axios.get(
      `https://${process.env.SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
      {
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.FRONT_SPEECH,
        },
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching voices:', error.response?.data || error.message);
    res.status(500).json({ message: 'Failed to fetch voices.' });
  }
});


// POST /api/tts/token
router.post('api/tts/token', async (req, res) => {
  try {
    const response = await axios.post(
      `https://${speechRegion}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
      qs.stringify({}),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Ocp-Apim-Subscription-Key': process.env.FRONT_SPEECH,
        },
      }
    );
    res.json({ token: response.data });
  } catch (error) {
    console.error('Error fetching token:', error.response?.data || error.message);
    res.status(500).json({ message: 'Failed to obtain authorization token.' });
  }
});


// POST /api/tts/convert
// POST /api/tts/convert
app.post('/api/tts/convert', async (req, res) => {
  try {
    const { text, voice, speed, userId } = req.body;

    // Validate required fields
    if (!text || !userId) {
      return res.status(400).json({ message: 'Text and userId are required for conversion.' });
    }

    // Get tier and usage
    const [userTier, userUsage] = await Promise.all([
      UserTier.findOne({ userId }) || { tier: "Freemium" },
      UserUsage.findOneAndUpdate(
        { userId },
        { $setOnInsert: { ttsDaily: 0, ttsMonthly: 0 } },
        { upsert: true, new: true }
      )
    ]);

    // Calculate character count
    const charCount = text.length;

    // TTS Limits configuration (characters)
    const ttsLimits = {
      "Freemium": { daily: 30000, monthly: 900000 },
      "Basic Month": { daily: 20000, monthly: 600000 },
      "Basic Year": { daily: 20000, monthly: 600000 },
      "Premium Month": { daily: 60000, monthly: 1000000 },
      "Premium Year": { daily: 60000, monthly: 1000000 }
    };

    // Check limits
    const limits = ttsLimits[userTier.tier] || ttsLimits["Freemium"];
    if (userUsage.ttsDaily + charCount > limits.daily) {
      return res.status(403).json({ message: "Daily TTS limit exceeded" });
    }
    if (userUsage.ttsMonthly + charCount > limits.monthly) {
      return res.status(403).json({ message: "Monthly TTS limit exceeded" });
    }

    // Check speed limit
    const speedLimits = {
      "Freemium": 1.0,
      "Basic Month": 1.5,
      "Basic Year": 1.5,
      "Premium Month": 2.5,
      "Premium Year": 2.5
    };
    const maxSpeed = speedLimits[userTier.tier] || 1.0;
    if (speed > maxSpeed) {
      return res.status(403).json({ 
        message: `Speed limited to ${maxSpeed}x for your tier`
      });
    }

    // Update usage first (see note below about race conditions)
    await UserUsage.updateOne(
      { userId },
      { 
        $inc: { ttsDaily: charCount, ttsMonthly: charCount },
        $set: { lastReset: userUsage.lastReset }
      }
    );

    // Set up speech configuration
    const speechConfig = SpeechConfig.fromSubscription(
      process.env.FRONT_SPEECH, 
      process.env.SPEECH_REGION
    );
    
    if (voice) {
      speechConfig.speechSynthesisVoiceName = voice;
    }
    
    speechConfig.speechSynthesisOutputFormat = 
      SpeechSynthesisOutputFormat.Audio16Khz32KBitRateMonoMp3;

    // Set up audio configuration
    const tempDir = path.join(__dirname, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const audioFilePath = path.join(tempDir, `output-${Date.now()}.mp3`);
    const audioConfig = AudioConfig.fromAudioFileOutput(audioFilePath);

    // Create synthesizer
    const synthesizer = new SpeechSynthesizer(speechConfig, audioConfig);

    // Synthesize speech
    synthesizer.speakTextAsync(
      text,
      async (result) => {
        try {
          if (result.reason === ResultReason.SynthesizingAudioCompleted) {
            // Read and send audio file
            const audio = fs.readFileSync(audioFilePath);
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Disposition', 'attachment; filename=audio.mp3');
            res.send(audio);
          } else {
            console.error('Speech synthesis failed:', result.errorDetails);
            // Roll back usage on failure
            await UserUsage.updateOne(
              { userId },
              { $inc: { ttsDaily: -charCount, ttsMonthly: -charCount } }
            );
            res.status(500).json({ message: 'Failed to synthesize speech.' });
          }
        } catch (error) {
          console.error('Error handling synthesis result:', error);
          res.status(500).json({ message: 'Error processing audio file.' });
        } finally {
          // Cleanup
          synthesizer.close();
          if (fs.existsSync(audioFilePath)) {
            fs.unlinkSync(audioFilePath);
          }
        }
      },
      async (error) => {
        console.error('Error during speech synthesis:', error);
        // Roll back usage on error
        await UserUsage.updateOne(
          { userId },
          { $inc: { ttsDaily: -charCount, ttsMonthly: -charCount } }
        );
        res.status(500).json({ message: 'Error during speech synthesis.' });
      }
    );

  } catch (error) {
    console.error('Error in TTS conversion:', error);
    res.status(500).json({ message: 'Failed to convert text to speech' });
  }
});




ffmpeg.setFfmpegPath('C:/ffmpeg/bin/ffmpeg.exe'); // Set the full path to the FFmpeg binary





// Configure multer for audio uploads
const speechUpload = multer({
  dest: 'temp_audio/', // Directory for temporary storage
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB limit (adjust as needed)
  },
  fileFilter: (req, file, cb) => {
    // Accept only audio files (e.g., webm, ogg, mp3, wav)
    const allowedTypes = ['audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/wav'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only audio files are allowed.'));
    }
  },
});


// Ensure the temp_audio directory exists
const tempAudioDir = path.join(__dirname, 'temp_audio');
if (!fs.existsSync(tempAudioDir)) {
  fs.mkdirSync(tempAudioDir, { recursive: true });
}

// POST /api/speech-to-text


// Updated Speech-to-text endpoint
app.post('/api/speech-to-text', speechUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file uploaded.' });
    }

    // Validate and get user ID
    const userId = req.body.userId;
    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ error: 'Valid user ID required.' });
    }

    // Get user tier and usage
    const [userTier, userUsage] = await Promise.all([
      UserTier.findOne({ userId }).lean() || { tier: "Freemium" },
      UserUsage.findOneAndUpdate(
        { userId },
        { $setOnInsert: { sttDaily: 0, sttMonthly: 0 } },
        { upsert: true, new: true }
      )
    ]);

    // Tier-based limits configuration
    const STT_LIMITS = {
      "Freemium": { daily: 600, monthly: 18000 }, // 10 minutes daily, 5 hours monthly
      "Basic Month": { daily: 1200, monthly: 18000 }, // 20 minutes daily, 5 hours monthly
      "Basic Year": { daily: 1200, monthly: 18000 },
      "Premium Month": { daily: 3600, monthly: 28800 }, // 1 hour daily, 8 hours monthly
      "Premium Year": { daily: 3600, monthly: 28800 }
    };

    // Get limits for the user's tier
    const limits = STT_LIMITS[userTier.tier] || STT_LIMITS["Freemium"];

    // Check daily and monthly limits
    if (userUsage.sttDaily >= limits.daily) {
      return res.status(403).json({ error: 'Daily speech-to-text limit exceeded.' });
    }
    if (userUsage.sttMonthly >= limits.monthly) {
      return res.status(403).json({ error: 'Monthly speech-to-text limit exceeded.' });
    }

    // Convert audio to WAV and process it
    const uploadedFilePath = req.file.path;
    const wavFilePath = path.join(tempDir, `${Date.now()}.wav`);

    await new Promise((resolve, reject) => {
      ffmpeg(uploadedFilePath)
        .output(wavFilePath)
        .format('wav')
        .audioCodec('pcm_s16le')
        .audioFrequency(16000)
        .audioChannels(1)
        .on('end', resolve)
        .on('error', reject)
        .run();
    });

    // Verify WAV file
    const buffer = fs.readFileSync(wavFilePath);
    const header = buffer.toString('utf8', 0, 4);
    if (header !== 'RIFF') {
      throw new Error('Invalid WAV file format');
    }

    // Configure Azure Speech SDK
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(
      process.env.FRONT_SPEECH,
      process.env.SPEECH_REGION
    );
    speechConfig.speechRecognitionLanguage = 'en-US';

    // Use push stream for audio input
    const pushStream = SpeechSDK.AudioInputStream.createPushStream();
    pushStream.write(buffer);
    pushStream.close();

    const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(pushStream);
    const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

    // Perform speech recognition
    const result = await new Promise((resolve, reject) => {
      recognizer.recognizeOnceAsync(
        result => result.reason === SpeechSDK.ResultReason.RecognizedSpeech 
          ? resolve(result) 
          : reject(new Error(result.errorDetails)),
        error => reject(error)
      );
    });

    const transcription = result.text;

    // Calculate audio duration for usage tracking
    const duration = await new Promise((resolve, reject) => {
      ffmpeg.ffprobe(uploadedFilePath, (err, metadata) => {
        if (err) {
          console.error('FFprobe error:', err);
          reject(new Error('Failed to extract audio duration'));
        } else {
          resolve(metadata.format.duration || 0);
        }
      });
    });

    const durationSeconds = Math.ceil(Number(duration)) || 0;

    // Update usage
    await UserUsage.updateOne(
      { userId },
      { 
        $inc: { sttDaily: durationSeconds, sttMonthly: durationSeconds },
        $setOnInsert: { lastReset: new Date() }
      }
    );

    // Cleanup files
    [uploadedFilePath, wavFilePath].forEach(file => {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    });

    res.json({ transcription });
  } catch (error) {
    console.error('Speech-to-text error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    // Cleanup uploaded file
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
  }
});


// Function to generate the moodboard image
const generateMoodboardImage = async (elements) => {
  // Define base dimensions
  const width = 1200;
  const height = 800;
  
  // Create a blank white image
  const image = new Jimp(width, height, '#ffffff'); // White background

  // Iterate through each element and add it to the base image
  for (const el of elements) {
    if (el.type === "image") {
      try {
        // Load the image from the provided source
        const elImage = await Jimp.read(el.src); // el.src should be a valid URL or base64 string
        // Resize the image while maintaining aspect ratio
        elImage.resize(el.width, el.height);
        // Rotate the image if rotation is specified
        elImage.rotate(el.rotation || 0);
        // Composite the image onto the base image at (x, y)
        image.composite(elImage, el.x, el.y);
      } catch (err) {
        console.error(`Error processing image element with id ${el.id}:`, err);
      }
    } else if (el.type === "text") {
      // Implement text rendering if needed
      // Jimp has limited text support; consider using another library like Canvas for advanced text
      // For simplicity, this example skips text elements
      // You can integrate text rendering as per your requirements
    }
    // Handle other element types (e.g., shapes) as needed
  }

  return image;
};

// Updated /api/moodboard/export endpoint
app.post('/api/moodboard/export', async (req, res) => {
  try {
    const { userId, elements, format } = req.body; // Expecting 'format' to be 'png' or 'jpg'
    
    // Validate request body
    if (!userId || !elements) {
      return res.status(400).json({ message: 'userId and elements are required.' });
    }

    // Validate userId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: 'Invalid userId format.' });
    }

    // Retrieve user tier from the database
    const userTierDoc = await UserTier.findOne({ userId });
    const userTier = userTierDoc ? userTierDoc.tier : "Freemium";

    // Generate the base moodboard image
    const image = await generateMoodboardImage(elements);

    // If user is Freemium, apply the watermark
    if (userTier === "Freemium") {
      // Path to the watermark image
      const watermarkPath = path.join(__dirname, 'files', 'Verbalitlong.png');
      
      // Load the watermark image
      const watermark = await Jimp.read(watermarkPath);
      
      // Option 2: Bottom-right small watermark
      // Resize watermark to have a height of 50px while maintaining aspect ratio
      watermark.resize(Jimp.AUTO, 50); // Adjust height as needed
      
      // Calculate position: 20px from the bottom and right edges
      const x = image.bitmap.width - watermark.bitmap.width - 20;
      const y = image.bitmap.height - watermark.bitmap.height - 20;
      
      // Composite the watermark onto the base image
      image.composite(watermark, x, y, {
        mode: Jimp.BLEND_SOURCE_OVER,
        opacitySource: 0.7, // 70% opacity for the watermark
        opacityDest: 1.0
      });
    }

    // Determine the MIME type based on the requested format
    let mimeType;
    if (format === 'jpg') {
      mimeType = Jimp.MIME_JPEG;
    } else {
      // Default to PNG
      mimeType = Jimp.MIME_PNG;
    }

    // Convert the Jimp image to a buffer in the specified format
    image.getBuffer(mimeType, (err, buffer) => {
      if (err) {
        console.error('Error generating image buffer:', err);
        return res.status(500).json({ message: 'Failed to generate image buffer.' });
      }
      // Set the appropriate Content-Type header
      res.set('Content-Type', mimeType);
      // Send the image buffer as the response
      res.send(buffer);
    });

  } catch (error) {
    console.error('Moodboard export error:', error);
    res.status(500).json({ message: 'Failed to export moodboard' });
  }
});

const jwt = require("jsonwebtoken");
const NotebookPage = require("./models/NotebookPage");


app.get('/api/notebook/pages/:pageId', async (req, res) => {
  try {
    const pageId = req.params.pageId;
    const page = await NotebookPage.findById(pageId);
    if (!page) {
      return res.status(404).json({ message: 'Page not found' });
    }
    res.status(200).json(page);
  } catch (error) {
    console.error('Error fetching page:', error);
    res.status(500).json({ message: 'Server error while fetching page' });
  }
});

app.get('/api/collab/verify-token/:token', async (req, res) => {
  try {
    const token = req.params.token;
    const decoded = jwt.verify(token,'yourSecretKey');
    const pageId = decoded.pageId;

    // Check if the page exists
    const page = await NotebookPage.findById(pageId);
    if (!page) {
      return res.status(404).json({ message: 'Page not found' });
    }

    res.status(200).json({ role: decoded.role, pageId });
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(401).json({ message: 'Invalid or expired token' });
  }
});


app.post('/api/notebook/pages/:pageId/update', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]; // Extract token from headers
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    // Verify the token and extract the role
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { role, pageId } = decoded;

    // Check if the user is an editor
    if (role !== 'editor') {
      return res.status(403).json({ message: 'You do not have permission to edit this page' });
    }

    // Proceed with the update
    const { content } = req.body;
    const updatedPage = await NotebookPage.findByIdAndUpdate(
      pageId,
      { content },
      { new: true }
    );

    if (!updatedPage) {
      return res.status(404).json({ message: 'Page not found' });
    }

    // Broadcast the update to all connected clients (real-time collaboration)
    io.to(pageId).emit('contentUpdated', updatedPage.content);

    res.status(200).json(updatedPage);
  } catch (error) {
    console.error('Error updating page:', error);
    res.status(500).json({ message: 'Server error while updating page' });
  }
});

// Endpoint to update (link/unlink) a notebook page with a folder
app.put("/api/notebook/pages/:pageId/link-folder", async (req, res) => {
  try {
    const { pageId } = req.params;
    const { folderId } = req.body;

    // Validate folderId if provided (it must be a valid ObjectId)
    if (folderId && !mongoose.Types.ObjectId.isValid(folderId)) {
      return res.status(400).json({ message: "Invalid folder ID format." });
    }

    // Update the notebook page's folderId.
    // If folderId is not provided (or empty), we set it to null.
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


const FolderShare = require("./models/FolderShare"); // Import FolderShare model

// Generate Share Link
app.post("/api/folders/share", async (req, res) => {
  const { folderId, role } = req.body;

  try {
    // Check if the folder exists
    const folder = await Folder.findById(folderId);
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    // Generate a token for the folder
    const token = crypto.randomBytes(16).toString("hex");
    const shareLink = `https://verbalit.top/folders/collaborate/${folderId}/${token}`;

    // Save token to the database
    await FolderShare.create({
      folderId,
      token,
      role: role || "viewer", // Default role is viewer if not specified
      invitedBy: folder.userId, // Owner of the folder
      email: "", // Not tied to an email for public links
    });

    res.status(200).json({ shareLink });
  } catch (error) {
    console.error("Error generating share link:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Invite Collaborator via Email
app.post("/api/folders/invite", async (req, res) => {
  const { folderId, email, role } = req.body;

  try {
    // Check if the folder exists
    const folder = await Folder.findById(folderId);
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    // Generate a token for the invite
    const token = jwt.sign({ folderId, role }, "yourSecretKey", { expiresIn: "7d" });

    // Save invite details to the database
    await FolderShare.create({
      folderId,
      token,
      role,
      invitedBy: folder.userId,
      email,
    });

    // Send invitation email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const shareLink = `https://verbalit.top/folders/collaborate/${folderId}/${token}`;
    const emailContent = `<div>
      <p>You have been invited to collaborate on a folder.</p>
      <p>Role: <strong>${role}</strong></p>
      <p>Click the link below to access the folder:</p>
      <p><a href="${shareLink}">${shareLink}</a></p>
    </div>`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Invitation to Collaborate on a Folder",
      html: emailContent,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({ message: "Invitation sent successfully!" });
  } catch (error) {
    console.error("Error sending invitation:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Verify Token and Get Role
app.get("/api/folders/collaborate/:folderId/:token", async (req, res) => {
  const { folderId, token } = req.params;

  try {
    // Verify token
    const shareEntry = await FolderShare.findOne({ folderId, token });
    if (!shareEntry) {
      return res.status(401).json({ message: "Invalid or expired token" });
    }

    res.status(200).json({
      folderId: shareEntry.folderId,
      role: shareEntry.role,
    });
  } catch (error) {
    console.error("Error verifying token:", error);
    res.status(500).json({ message: "Server error" });
  }
});

// Get Folder Details for Collaboration
app.get("/api/folders/:folderId", async (req, res) => {
  const { folderId } = req.params;

  try {
    const folder = await Folder.findById(folderId);
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    res.status(200).json(folder);
  } catch (error) {
    console.error("Error fetching folder:", error);
    res.status(500).json({ message: "Server error" });
  }
});


// ====================================
// Moodboard Collaboration Endpoints
// ====================================

// POST /api/moodboards/:moodboardId/share
app.post("/api/moodboards/:moodboardId/share", async (req, res) => {
  try {
    const { moodboardId } = req.params;
    const { role } = req.body; // <--- read from request body
    const moodboard = await Board.findById(moodboardId);
    if (!moodboard) {
      return res.status(404).json({ message: "Moodboard not found." });
    }

    const token = crypto.randomBytes(16).toString("hex");

    // If no 'role' provided, default to "viewer"
    const finalRole = role === "editor" ? "editor" : "viewer";

    await MoodboardShare.create({
      moodboardId,
      token,
      role: finalRole, // use the finalRole
      invitedBy: moodboard.userId,
      email: "",
    });

    const frontendUrl = process.env.FRONTEND_URL || "https://verbalit.top";
    const shareLink = `${frontendUrl}/moodboards/collaborate/${moodboardId}/${token}`;

    return res.status(200).json({ shareLink });
  } catch (error) {
    console.error("Error generating share link for moodboard:", error);
    return res.status(500).json({ message: "Server error." });
  }
});


// POST /api/moodboards/:moodboardId/invite - Send invitation via email
app.post("/api/moodboards/:moodboardId/invite", async (req, res) => {
  try {
    const { moodboardId } = req.params;
    const { email, role } = req.body;

    if (!["viewer", "editor"].includes(role)) {
      return res.status(400).json({ message: "Invalid role specified." });
    }

    // Verify moodboard
    const moodboard = await Board.findById(moodboardId);
    if (!moodboard) {
      return res.status(404).json({ message: "Moodboard not found." });
    }

    // Generate unique token
    const token = crypto.randomBytes(16).toString("hex");

    // Create a share entry
    await MoodboardShare.create({
      moodboardId,
      token,
      role,
      invitedBy: moodboard.userId,
      email,
    });

    // Send email
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const shareLink = `${
      process.env.FRONTEND_URL || "https://verbalit.top"
    }/moodboards/collaborate/${moodboardId}/${token}`;
    const emailContent = `
      <div>
        <p>You have been invited to collaborate on moodboard "<strong>${moodboard.name}</strong>".</p>
        <p>Role: <strong>${role}</strong></p>
        <p>Click the link below to access the moodboard:</p>
        <p><a href="${shareLink}">${shareLink}</a></p>
      </div>
    `;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Invitation to Collaborate on a Moodboard",
      html: emailContent,
    });

    return res.status(200).json({ message: "Invitation sent successfully!" });
  } catch (error) {
    console.error("Error sending moodboard invitation:", error);
    return res.status(500).json({ message: "Server error." });
  }
});

// GET /api/moodboards/collaborate/:moodboardId/:token - Verify Token and Retrieve Collaboration Details
app.get("/api/moodboards/collaborate/:moodboardId/:token", async (req, res) => {
  try {
    const { moodboardId, token } = req.params;

    // Find the share entry
    const shareEntry = await MoodboardShare.findOne({ moodboardId, token });
    if (!shareEntry) {
      return res.status(401).json({ message: "Invalid or expired token." });
    }

    // Confirm moodboard still exists
    const moodboard = await Board.findById(moodboardId);
    if (!moodboard) {
      return res.status(404).json({ message: "Moodboard not found." });
    }

    const shareLink = `${
      process.env.FRONTEND_URL || "https://verbalit.top"
    }/moodboards/collaborate/${moodboardId}/${token}`;

    return res.status(200).json({
      moodboardId: shareEntry.moodboardId,
      role: shareEntry.role,
      shareLink,
    });
  } catch (error) {
    console.error("Error verifying moodboard share token:", error);
    return res.status(500).json({ message: "Server error." });
  }
});

// GET /api/moodboards/:moodboardId - Retrieve a specific moodboard
app.get("/api/moodboards/:moodboardId", async (req, res) => {
  try {
    const { moodboardId } = req.params;

    const moodboard = await Board.findById(moodboardId);
    if (!moodboard) {
      return res.status(404).json({ message: "Moodboard not found." });
    }

    res.status(200).json(moodboard);
  } catch (error) {
    console.error("Error fetching moodboard:", error);
    res.status(500).json({ message: "Server error." });
  }
});


server.listen(port, () => {
  console.log(`Server running on port ${port}!`);
});