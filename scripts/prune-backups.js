require('dotenv').config();

const fs = require('fs');
const path = require('path');

const backupRoot = path.resolve(process.env.BACKUP_OUTPUT_DIR || path.join(process.cwd(), 'backups'));
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 30);
const dryRun = process.argv.includes('--dry-run');

function listBackupDirs(root) {
    if (!fs.existsSync(root)) {
        return [];
    }

    return fs.readdirSync(root)
        .map((name) => path.join(root, name))
        .filter((fullPath) => {
            try {
                return fs.statSync(fullPath).isDirectory();
            } catch (_error) {
                return false;
            }
        });
}

function olderThanRetention(fullPath, cutoffMs) {
    const stats = fs.statSync(fullPath);
    return stats.mtimeMs < cutoffMs;
}

function removeDir(fullPath) {
    fs.rmSync(fullPath, { recursive: true, force: true });
}

function main() {
    const now = Date.now();
    const cutoffMs = now - retentionDays * 24 * 60 * 60 * 1000;
    const dirs = listBackupDirs(backupRoot);

    let removed = 0;
    for (const dir of dirs) {
        if (!olderThanRetention(dir, cutoffMs)) {
            continue;
        }

        if (dryRun) {
            console.log(`[prune] would remove ${dir}`);
        } else {
            removeDir(dir);
            console.log(`[prune] removed ${dir}`);
        }
        removed += 1;
    }

    console.log(`[prune] complete. ${dryRun ? 'candidates' : 'removed'}: ${removed}`);
}

main();
