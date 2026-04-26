# Backup and Retention Policy

## Scope
- MongoDB Atlas application data
- Cloudinary media metadata inventory (assets, IDs, URLs, versions)

## Recovery Objectives
- RPO target: <= 24 hours
- RTO target: <= 4 hours for app-level restore

## Atlas Policy (deployment-level)
1. Enable Atlas Cloud Backups (continuous snapshots where plan supports it).
2. Configure retention in Atlas backup policy:
   - Daily snapshots: 35 days
   - Weekly snapshots: 12 weeks
   - Monthly snapshots: 12 months
3. Enable alerts for backup failures and snapshot policy drift.
4. Validate restore quarterly to non-production cluster.

## Cloudinary Media Policy
1. Enable account-level backups/versioning in Cloudinary console.
2. Keep asset inventory exports daily (from `backup:run` script).
3. Keep media inventory for 90 days minimum.
4. Validate random restore sample monthly.

## App-level Backup Jobs
Use scripts from this repo:

- Full backup artifact:
  - `npm run backup:run`
  - Creates:
    - compressed Atlas dump (`atlas.archive.gz`)
    - Cloudinary resource manifest (`cloudinary-manifest.json`)
    - metadata (`metadata.json`)

- Retention prune:
  - `npm run backup:prune`
  - Removes local backup folders older than `BACKUP_RETENTION_DAYS`

- Dry run prune:
  - `npm run backup:prune:dry`

## Scheduling
Recommended schedule (server cron/Task Scheduler):
- Daily 02:00: `npm run backup:run`
- Daily 02:30: copy backup folder to external object storage (S3/GCS/Azure Blob)
- Daily 03:00: `npm run backup:prune`

## Required Environment Variables
- `MONGO_URI` or `MONGODB_URI`
- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `BACKUP_OUTPUT_DIR` (default `./backups`)
- `BACKUP_RETENTION_DAYS` (default `30`)

## Verification Checklist
1. Confirm latest backup folder exists.
2. Confirm `atlas.archive.gz` file size > 0.
3. Confirm `cloudinary-manifest.json` contains resources.
4. Confirm offsite copy completed.
5. Confirm prune logs match retention policy.
