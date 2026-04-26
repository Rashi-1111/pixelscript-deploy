const fs = require('fs');
const path = require('path');
const multer = require('multer');

function ensureDirectory(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
        fs.mkdirSync(directoryPath, { recursive: true });
    }
}

function createDiskStorage(subfolder) {
    return multer.diskStorage({
        destination(req, file, cb) {
            const uploadDir = path.join(__dirname, '..', 'public', 'uploads', subfolder);
            ensureDirectory(uploadDir);
            cb(null, uploadDir);
        },
        filename(req, file, cb) {
            const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
            cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
        }
    });
}

function buildPublicFileUrl(subfolder, filename) {
    return `/uploads/${subfolder}/${filename}`;
}

module.exports = {
    ensureDirectory,
    createDiskStorage,
    buildPublicFileUrl
};
