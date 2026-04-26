require('dotenv').config();
const mongoose = require('mongoose');
const Purchase = require('../models/Purchase');

const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;

async function main() {
    if (!mongoUri) {
        throw new Error('Missing MONGO_URI (or MONGODB_URI).');
    }

    await mongoose.connect(mongoUri);

    try {
        const collection = Purchase.collection;

        const indexes = await collection.indexes();
        const hasOldStoryIdIndex = indexes.some(index => index.name === 'consumer_1_storyId_1');

        if (hasOldStoryIdIndex) {
            await collection.dropIndex('consumer_1_storyId_1');
            console.log('[purchase-index] Dropped old index consumer_1_storyId_1');
        } else {
            console.log('[purchase-index] Old index consumer_1_storyId_1 not found, skipping drop');
        }

        await Purchase.syncIndexes();
        console.log('[purchase-index] Purchase indexes synced successfully');
    } finally {
        await mongoose.disconnect();
    }
}

main().catch((error) => {
    console.error(`[purchase-index] Migration failed: ${error.message}`);
    process.exitCode = 1;
});
