const mongoose = require("mongoose");

const PdfDetailsSchema = new mongoose.Schema(
  {
    pdf: String, // PDF file name
    text: String, // Extracted text
    type: { type: String, enum: ["upload", "paste"], default: "upload" }, // To differentiate uploads from paste
    userId: String, // Optional: associate with a user
  },
  { collection: "PdfDetails" }
);

mongoose.model("PdfDetails", PdfDetailsSchema);
