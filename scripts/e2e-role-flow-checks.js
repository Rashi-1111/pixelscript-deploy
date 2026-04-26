require('dotenv').config();

const crypto = require('crypto');

const BASE_URL = (process.env.E2E_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const EXIT_CODES = {
    auth: 20,
    'artist-upload': 21,
    'writer-publish': 22,
    'reader-view': 23,
    'purchase-unlock': 24,
    all: 25
};

const roleUsers = {
    artist: {
        name: process.env.E2E_ARTIST_NAME || 'E2E Artist',
        username: process.env.E2E_ARTIST_USERNAME || 'e2e_artist',
        email: process.env.E2E_ARTIST_EMAIL || 'e2e.artist@example.com',
        password: process.env.E2E_ARTIST_PASSWORD || 'E2Epass123!',
        role: 'artist'
    },
    writer: {
        name: process.env.E2E_WRITER_NAME || 'E2E Writer',
        username: process.env.E2E_WRITER_USERNAME || 'e2e_writer',
        email: process.env.E2E_WRITER_EMAIL || 'e2e.writer@example.com',
        password: process.env.E2E_WRITER_PASSWORD || 'E2Epass123!',
        role: 'writer'
    },
    reader: {
        name: process.env.E2E_READER_NAME || 'E2E Reader',
        username: process.env.E2E_READER_USERNAME || 'e2e_reader',
        email: process.env.E2E_READER_EMAIL || 'e2e.reader@example.com',
        password: process.env.E2E_READER_PASSWORD || 'E2Epass123!',
        role: 'consumer'
    }
};

class CookieSession {
    constructor(name) {
        this.name = name;
        this.cookies = new Map();
    }

    cookieHeader() {
        return [...this.cookies.entries()]
            .map(([key, value]) => `${key}=${value}`)
            .join('; ');
    }

    absorbCookies(response) {
        const setCookie = response.headers.get('set-cookie');
        if (!setCookie) return;

        const firstCookie = setCookie.split(',').map(part => part.trim());
        for (const chunk of firstCookie) {
            const pair = chunk.split(';')[0];
            const idx = pair.indexOf('=');
            if (idx > 0) {
                const key = pair.slice(0, idx).trim();
                const value = pair.slice(idx + 1).trim();
                this.cookies.set(key, value);
            }
        }
    }

    async request(path, options = {}) {
        const headers = { ...(options.headers || {}) };
        const cookie = this.cookieHeader();
        if (cookie) {
            headers.Cookie = cookie;
        }

        const response = await fetch(`${BASE_URL}${path}`, {
            ...options,
            headers
        });

        this.absorbCookies(response);
        return response;
    }
}

function assertCondition(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

async function readJson(response, context) {
    const text = await response.text();
    try {
        return text ? JSON.parse(text) : {};
    } catch (_error) {
        throw new Error(`${context}: expected JSON response, got: ${text.slice(0, 200)}`);
    }
}

async function ensureRoleUser(session, user) {
    const loginRes = await session.request('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: user.password })
    });

    if (loginRes.ok) {
        return;
    }

    const registerRes = await session.request('/api/users/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
    });

    if (!registerRes.ok && registerRes.status !== 400) {
        const payload = await readJson(registerRes, `register ${user.role}`);
        throw new Error(`Failed to register ${user.role}: ${JSON.stringify(payload)}`);
    }

    const secondLogin = await session.request('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: user.password })
    });

    if (!secondLogin.ok) {
        const payload = await readJson(secondLogin, `login ${user.role}`);
        throw new Error(`Failed to login ${user.role}: ${JSON.stringify(payload)}`);
    }
}

function buildTinyPngBlob() {
    const tinyPngBase64 =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sLhM7wAAAAASUVORK5CYII=';
    const buffer = Buffer.from(tinyPngBase64, 'base64');
    return new Blob([buffer], { type: 'image/png' });
}

async function artistUploadCheck(session) {
    const form = new FormData();
    form.append('title', `E2E Work ${Date.now()}`);
    form.append('description', 'Artist upload flow smoke test');
    form.append('file', buildTinyPngBlob(), 'e2e-work.png');

    const uploadRes = await session.request('/api/users/works', {
        method: 'POST',
        body: form
    });
    assertCondition(uploadRes.ok, `Artist upload failed with status ${uploadRes.status}`);

    const uploadedWork = await readJson(uploadRes, 'artist upload');
    assertCondition(Boolean(uploadedWork._id), 'Artist upload did not return work id');
    assertCondition(Boolean(uploadedWork.fileUrl), 'Artist upload did not return fileUrl');

    return uploadedWork;
}

async function writerPublishCheck(session) {
    const chapters = [
        { title: 'E2E Chapter 1', content: 'Free chapter one' },
        { title: 'E2E Chapter 2', content: 'Free chapter two' },
        { title: 'E2E Chapter 3', content: 'Paid chapter three' }
    ];

    const createRes = await session.request('/api/stories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            title: `E2E Story ${Date.now()}`,
            description: 'Writer publish flow smoke test',
            genre: 'fantasy',
            price: 3,
            chapters
        })
    });
    assertCondition(createRes.ok, `Writer create story failed with status ${createRes.status}`);
    const createdStory = await readJson(createRes, 'writer create story');

    const publishRes = await session.request(`/api/stories/${createdStory._id}/publish`, {
        method: 'PUT'
    });
    assertCondition(publishRes.ok, `Writer publish failed with status ${publishRes.status}`);

    const publishPayload = await readJson(publishRes, 'writer publish');
    assertCondition(publishPayload?.story?.isPublished === true, 'Writer publish did not mark story as published');

    return publishPayload.story;
}

async function readerViewCheck(session, storyId) {
    const publishedRes = await session.request('/api/stories/published?page=1&limit=10');
    assertCondition(publishedRes.ok, `Reader published feed failed with status ${publishedRes.status}`);
    const publishedStories = await readJson(publishedRes, 'reader published feed');
    assertCondition(Array.isArray(publishedStories), 'Reader published feed did not return an array');
    assertCondition(
        publishedStories.some(story => String(story._id) === String(storyId)),
        'Reader published feed does not include the writer story'
    );

    const publicRes = await session.request(`/api/stories/public/${storyId}`);
    assertCondition(publicRes.ok, `Reader public story failed with status ${publicRes.status}`);
    const publicStory = await readJson(publicRes, 'reader public story');
    assertCondition(publicStory?.isPublished === true, 'Reader public story is not marked published');

    return publicStory;
}

async function purchaseUnlockCheck(session, storyId) {
    if (!RAZORPAY_KEY_SECRET) {
        throw new Error('Missing RAZORPAY_KEY_SECRET. Purchase unlock E2E check requires this env variable.');
    }

    const beforeRes = await session.request(`/api/stories/${storyId}`);
    assertCondition(beforeRes.ok, `Reader story before purchase failed with status ${beforeRes.status}`);
    const beforeStory = await readJson(beforeRes, 'reader story before purchase');

    const paidChapter = (beforeStory.chapters || []).find(chapter => chapter.order >= 3);
    assertCondition(Boolean(paidChapter), 'No paid chapter found for purchase unlock check');
    assertCondition(paidChapter.hasAccess === false, 'Paid chapter already has access before purchase');

    const createOrderRes = await session.request('/api/purchases/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            storyId,
            chapterId: paidChapter._id,
            purchaseType: 'chapter'
        })
    });
    assertCondition(createOrderRes.ok, `Create order failed with status ${createOrderRes.status}`);
    const order = await readJson(createOrderRes, 'create order');

    const fakePaymentId = `pay_${Date.now()}`;
    const signature = crypto
        .createHmac('sha256', RAZORPAY_KEY_SECRET)
        .update(`${order.orderId}|${fakePaymentId}`)
        .digest('hex');

    const verifyRes = await session.request('/api/purchases/verify-payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            razorpay_order_id: order.orderId,
            razorpay_payment_id: fakePaymentId,
            razorpay_signature: signature,
            storyId,
            chapterId: paidChapter._id,
            purchaseType: 'chapter'
        })
    });
    assertCondition(verifyRes.ok, `Verify payment failed with status ${verifyRes.status}`);

    const accessRes = await session.request(`/api/purchases/access/${storyId}/${paidChapter._id}`);
    assertCondition(accessRes.ok, `Purchase access check failed with status ${accessRes.status}`);
    const access = await readJson(accessRes, 'purchase access check');
    assertCondition(access.hasAccess === true, 'Purchase unlock check failed: chapter is still locked');
}

async function run() {
    const flowArgIndex = process.argv.findIndex(arg => arg === '--flow');
    const requestedFlow = flowArgIndex >= 0 ? String(process.argv[flowArgIndex + 1] || 'all') : 'all';
    const validFlows = new Set(['all', 'artist-upload', 'writer-publish', 'reader-view', 'purchase-unlock']);

    if (!validFlows.has(requestedFlow)) {
        throw new Error(`Invalid flow: ${requestedFlow}`);
    }

    console.log(`[e2e] base url: ${BASE_URL}`);
    console.log(`[e2e] flow: ${requestedFlow}`);

    const artistSession = new CookieSession('artist');
    const writerSession = new CookieSession('writer');
    const readerSession = new CookieSession('reader');

    const ensureArtist = async () => {
        await ensureRoleUser(artistSession, roleUsers.artist);
        console.log('[e2e] artist auth ok');
    };

    const ensureWriter = async () => {
        await ensureRoleUser(writerSession, roleUsers.writer);
        console.log('[e2e] writer auth ok');
    };

    const ensureReader = async () => {
        await ensureRoleUser(readerSession, roleUsers.reader);
        console.log('[e2e] reader auth ok');
    };

    if (requestedFlow === 'artist-upload') {
        await ensureArtist();
        const work = await artistUploadCheck(artistSession);
        console.log(`[e2e] artist upload ok (${work._id})`);
        return;
    }

    if (requestedFlow === 'writer-publish') {
        await ensureWriter();
        const story = await writerPublishCheck(writerSession);
        console.log(`[e2e] writer publish ok (${story._id})`);
        return;
    }

    if (requestedFlow === 'reader-view') {
        await ensureWriter();
        await ensureReader();
        const story = await writerPublishCheck(writerSession);
        console.log(`[e2e] writer publish seed ok (${story._id})`);
        await readerViewCheck(readerSession, story._id);
        console.log('[e2e] reader view ok');
        return;
    }

    if (requestedFlow === 'purchase-unlock') {
        await ensureWriter();
        await ensureReader();
        const story = await writerPublishCheck(writerSession);
        console.log(`[e2e] writer publish seed ok (${story._id})`);
        await purchaseUnlockCheck(readerSession, story._id);
        console.log('[e2e] purchase unlock ok');
        return;
    }

    await ensureArtist();
    await ensureWriter();
    await ensureReader();

    const work = await artistUploadCheck(artistSession);
    console.log(`[e2e] artist upload ok (${work._id})`);

    const story = await writerPublishCheck(writerSession);
    console.log(`[e2e] writer publish ok (${story._id})`);

    await readerViewCheck(readerSession, story._id);
    console.log('[e2e] reader view ok');

    await purchaseUnlockCheck(readerSession, story._id);
    console.log('[e2e] purchase unlock ok');

    console.log('[e2e] all role flow checks passed');
}

run().catch((error) => {
    console.error(`[e2e] failed: ${error.message}`);
    const flowArgIndex = process.argv.findIndex(arg => arg === '--flow');
    const requestedFlow = flowArgIndex >= 0 ? String(process.argv[flowArgIndex + 1] || 'all') : 'all';
    process.exitCode = EXIT_CODES[requestedFlow] || 1;
});
