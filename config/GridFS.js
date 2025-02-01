const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');

// Access the existing connection
const bucket = new GridFSBucket(mongoose.connection.db, {
  bucketName: 'resources',
});
