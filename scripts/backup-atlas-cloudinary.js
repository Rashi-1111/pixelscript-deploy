require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { v2: cloudinary } = require('cloudinary');

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const backupRoot = path.resolve(process.env.BACKUP_OUTPUT_DIR || path.join(process.cwd(), 'backups'));
const createdAt = new Date();
const stamp = createdAt.toISOString().replace(/[:]/g, '-');
const backupDir = path.join(backupRoot, stamp);
const mongoArchivePath = path.join(backupDir, 'atlas.archive.gz');
const cloudinaryManifestPath = path.join(backupDir, 'cloudinary-manifest.json');
const metaPath = path.join(backupDir, 'metadata.json');

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function runMongoDump() {
    if (!mongoUri) {
        throw new Error('Missing MONGO_URI (or MONGODB_URI).');
    }

    return new Promise((resolve, reject) => {
        const args = [`--uri=${mongoUri}`, `--archive=${mongoArchivePath}`, '--gzip'];
        const child = spawn('mongodump', args, { shell: true, stdio: 'inherit' });

        child.on('error', (error) => {
            reject(new Error(`Failed to start mongodump: ${error.message}`));
        });

        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`mongodump failed with exit code ${code}`));
                return;
            }
            resolve();
        });
    });
}

function setupCloudinary() {
    if (!cloudName || !apiKey || !apiSecret) {
        throw new Error('Missing Cloudinary credentials. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    }

    cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true
    });
}

async function exportCloudinaryManifest() {
    setupCloudinary();

    const allResources = [];
    let nextCursor = undefined;

    do {
        const page = await cloudinary.api.resources({
            type: 'upload',
            max_results: 500,
            next_cursor: nextCursor
        });

        for (const resource of page.resources || []) {
            allResources.push({
                asset_id: resource.asset_id,
                public_id: resource.public_id,
                version: resource.version,
                resource_type: resource.resource_type,
                type: resource.type,
                format: resource.format,
                bytes: resource.bytes,
                folder: resource.folder || '',
                created_at: resource.created_at,
                secure_url: resource.secure_url
            });
        }

        nextCursor = page.next_cursor;
    } while (nextCursor);

    fs.writeFileSync(
        cloudinaryManifestPath,
        JSON.stringify({
            exportedAt: new Date().toISOString(),
            resourceCount: allResources.length,
            resources: allResources
        }, null, 2),
        'utf8'
    );

    return allResources.length;
}

function writeMetadata(cloudinaryCount) {
    const metadata = {
        createdAt: createdAt.toISOString(),
        backupDir,
        mongoArchivePath,
        cloudinaryManifestPath,
        cloudinaryCount,
        retentionDays: Number(process.env.BACKUP_RETENTION_DAYS || 30)
    };

    fs.writeFileSync(metaPath, JSON.stringify(metadata, null, 2), 'utf8');
}

async function main() {
    ensureDir(backupDir);

    console.log(`[backup] writing artifacts to ${backupDir}`);
    await runMongoDump();
    const cloudinaryCount = await exportCloudinaryManifest();
    writeMetadata(cloudinaryCount);

    console.log(`[backup] done. cloudinary resources exported: ${cloudinaryCount}`);
}

main().catch((error) => {
    console.error(`[backup] failed: ${error.message}`);
    process.exitCode = 1;
});
