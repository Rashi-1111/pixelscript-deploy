require("dotenv").config();
const mongoose = require("mongoose");

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
if (!mongoUri) {
    throw new Error('Missing MONGO_URI (or MONGODB_URI) environment variable');
}

const connectDB = () => {
    mongoose.connect(mongoUri)
        .then(() => console.log("Connected to Atlas 🚀"))
        .catch(err => console.log(err));
};

module.exports = connectDB;
