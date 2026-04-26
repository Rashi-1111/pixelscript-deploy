const { v2: cloudinary } = require('cloudinary');
const { Readable } = require('stream');

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

function isCloudinaryConfigured() {
    return Boolean(cloudName && apiKey && apiSecret);
}

if (isCloudinaryConfigured()) {
    cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true
    });
}

function ensureConfigured() {
    if (!isCloudinaryConfigured()) {
        throw new Error('Cloudinary is not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    }
}

function buildFolderPath(folder = '') {
    const base = String(process.env.CLOUDINARY_FOLDER || 'pixelscript').trim();
    const child = String(folder || '').trim().replace(/^\/+|\/+$/g, '');
    return child ? `${base}/${child}` : base;
}

async function uploadBuffer(buffer, { folder = '', resourceType = 'auto', publicId } = {}) {
    ensureConfigured();

    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
        throw new Error('Invalid upload buffer');
    }

    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder: buildFolderPath(folder),
                resource_type: resourceType,
                public_id: publicId,
                overwrite: false
            },
            (error, result) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(result);
            }
        );

        Readable.from(buffer).pipe(uploadStream);
    });
}

async function uploadDataUri(dataUri, { folder = '', resourceType = 'image', publicId } = {}) {
    ensureConfigured();

    if (!dataUri || !String(dataUri).startsWith('data:')) {
        throw new Error('Invalid data URI');
    }

    return cloudinary.uploader.upload(dataUri, {
        folder: buildFolderPath(folder),
        resource_type: resourceType,
        public_id: publicId,
        overwrite: false
    });
}

module.exports = {
    isCloudinaryConfigured,
    uploadBuffer,
    uploadDataUri
};
