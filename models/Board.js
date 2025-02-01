// models/Board.js
const mongoose = require('mongoose');

// Define the Element Schema with Conditional Requirements
const ElementSchema = new mongoose.Schema({
  id: { 
    type: Number, 
    required: function() { 
      // 'id' is required only for 'text' and 'image' types
      return ['text', 'image'].includes(this.type); 
    } 
  },
  type: { 
    type: String, 
    enum: ['text', 'image', 'pen', 'eraser', 'highlighter', 'rectangle', 'line', 'circle'], 
    required: true 
  },
  // Fields for 'text' and 'image' types
  x: { 
    type: Number, 
    required: function() { 
      return ['text', 'image'].includes(this.type); 
    } 
  },
  y: { 
    type: Number, 
    required: function() { 
      return ['text', 'image'].includes(this.type); 
    } 
  },
  width: { type: Number },
  height: { type: Number },
  rotation: { type: Number, default: 0 },
  content: { type: String }, // For text elements
  src: { type: String }, // For image elements
  aspectRatio: { type: Number }, // For image elements
  // Additional fields for text styling
  bgColor: { type: String, default: '#ffffff' },
  fontColor: { type: String, default: '#000000' },
  isBold: { type: Boolean, default: false },
  isItalic: { type: Boolean, default: false },
  fontSize: { type: Number, default: 16 },
  // Fields for drawings
  points: [{ x: Number, y: Number }], // For pen, highlighter, eraser
  color: { type: String },
  lineWidth: { type: Number },
  opacity: { type: Number, default: 1 },
  // Fields specific to line, rectangle, circle
  x1: { 
    type: Number, 
    required: function() { 
      return ['line', 'rectangle', 'circle'].includes(this.type); 
    } 
  },
  y1: { 
    type: Number, 
    required: function() { 
      return ['line', 'rectangle', 'circle'].includes(this.type); 
    } 
  },
  x2: { 
    type: Number, 
    required: function() { 
      return ['line', 'rectangle', 'circle'].includes(this.type); 
    } 
  },
  y2: { 
    type: Number, 
    required: function() { 
      return ['line', 'rectangle', 'circle'].includes(this.type); 
    } 
  },
});

// Define the Board Schema
const BoardSchema = new mongoose.Schema({
  name: { type: String, required: true },
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'users', // Reference to the User model
    required: true 
  }, // Associate board with a user
  folderId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'folders', // Reference to the Folder model
    default: null 
  }, // Link board to a folder
  elements: [ElementSchema], // Array of elements on the board
  shareToken: { type: String, default: null }, // Field to store share token
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

// Middleware to update `updatedAt` before saving
BoardSchema.pre('save', function (next) {
  this.updatedAt = Date.now();
  next();
});

// Create and export the Board model
const Board = mongoose.model('Board', BoardSchema);

module.exports = Board;
