const express = require('express');
const http = require('http');
const https = require('https');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();
const MAX_TEXT_LENGTH = 6000;
const MAX_CONTEXT_FIELD_LENGTH = 300;
const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Too many AI requests. Please wait and try again.' }
});

function sanitizeText(value) {
    return String(value || '').trim();
}

function sanitizeContext(context) {
    const source = context && typeof context === 'object' ? context : {};
    return {
        storyTitle: sanitizeText(source.storyTitle).slice(0, MAX_CONTEXT_FIELD_LENGTH),
        genre: sanitizeText(source.genre).slice(0, MAX_CONTEXT_FIELD_LENGTH),
        tone: sanitizeText(source.tone).slice(0, MAX_CONTEXT_FIELD_LENGTH),
        characters: sanitizeText(source.characters).slice(0, MAX_CONTEXT_FIELD_LENGTH),
        chapterGoal: sanitizeText(source.chapterGoal).slice(0, MAX_CONTEXT_FIELD_LENGTH),
        visualStyle: sanitizeText(source.visualStyle).slice(0, MAX_CONTEXT_FIELD_LENGTH)
    };
}

function extractPrimaryMood(text = '') {
    const source = sanitizeText(text).toLowerCase();
    if (/fight|war|attack|rage|chase|run|danger|panic/.test(source)) return 'high-tension';
    if (/sad|cry|loss|grief|alone|hurt/.test(source)) return 'melancholic';
    if (/love|kiss|care|warm|comfort|hope/.test(source)) return 'warm-intimate';
    if (/mystery|secret|unknown|shadow|dark|fog/.test(source)) return 'mysterious';
    if (/fun|joke|comic|light|happy/.test(source)) return 'light-playful';
    return 'cinematic-balanced';
}

function getLightingByMood(mood) {
    const map = {
        'high-tension': 'Hard rim light with sharp shadows and dynamic contrast.',
        melancholic: 'Soft low-key lighting with cool desaturated tones.',
        'warm-intimate': 'Warm bounce light with gentle gradients and close highlights.',
        mysterious: 'Directional light through haze/fog with strong silhouettes.',
        'light-playful': 'Bright high-key lighting with clear, readable forms.',
        'cinematic-balanced': 'Balanced cinematic lighting with one strong key and subtle fill.'
    };

    return map[mood] || map['cinematic-balanced'];
}

function getShotGuideByMood(mood) {
    const map = {
        'high-tension': 'Start with a wide establishing shot, then fast medium-close cuts for action beats.',
        melancholic: 'Use wider breathing frames and one lingering close-up on the emotional reaction.',
        'warm-intimate': 'Use medium-close frames, over-shoulder exchange, and one detail close-up.',
        mysterious: 'Use foreground occlusion, tilted medium shots, and one silhouette reveal panel.',
        'light-playful': 'Use clean medium shots with expressive character pose focus.',
        'cinematic-balanced': 'Use 1 wide + 2 medium + 1 close-up rhythm for readable flow.'
    };

    return map[mood] || map['cinematic-balanced'];
}

function buildHeuristicCue(message, context = {}) {
    const mood = extractPrimaryMood(`${message} ${context.tone || ''} ${context.chapterGoal || ''}`);
    const genre = sanitizeText(context.genre) || 'story';
    const title = sanitizeText(context.storyTitle) || 'current project';
    const characterFocus = sanitizeText(context.characters) || 'Use current speaker and counterpart as focal pair.';
    const styleHint = sanitizeText(context.visualStyle) || 'Keep silhouettes clean and expressions readable.';

    return {
        title: `${title} | ${genre.toUpperCase()} scene cue`,
        mood,
        shotPlan: getShotGuideByMood(mood),
        lighting: getLightingByMood(mood),
        focus: characterFocus,
        style: styleHint,
        panelFlow: 'Recommended 4 panels: establish -> interaction -> emotional turn -> hook frame.'
    };
}

function safeParseJsonObject(text) {
    if (!text) {
        return null;
    }

    const raw = String(text).trim();
    const fencedMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidate = fencedMatch ? fencedMatch[1].trim() : raw;

    try {
        return JSON.parse(candidate);
    } catch (error) {
        return null;
    }
}

function normalizeCueShape(rawCue, fallbackCue) {
    const cue = rawCue && typeof rawCue === 'object' ? rawCue : {};

    return {
        title: sanitizeText(cue.title) || fallbackCue.title,
        mood: sanitizeText(cue.mood) || fallbackCue.mood,
        shotPlan: sanitizeText(cue.shotPlan) || fallbackCue.shotPlan,
        lighting: sanitizeText(cue.lighting) || fallbackCue.lighting,
        focus: sanitizeText(cue.focus) || fallbackCue.focus,
        style: sanitizeText(cue.style) || fallbackCue.style,
        panelFlow: sanitizeText(cue.panelFlow) || fallbackCue.panelFlow
    };
}

function normalizeTaskType(taskType) {
    const value = sanitizeText(taskType).toLowerCase();
    const allowed = new Set([
        'beat-generator',
        'continuity-checker',
        'plot-hole-scanner',
        'cliffhanger-lab',
        'dialogue-variants',
        'scene-to-panel-brief'
    ]);

    return allowed.has(value) ? value : 'beat-generator';
}

function splitLines(text) {
    return sanitizeText(text)
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function buildFallbackWriterAssist({ taskType, text, context = {} }) {
    const genre = sanitizeText(context.genre) || 'story';
    const tone = sanitizeText(context.tone) || 'balanced';
    const title = sanitizeText(context.storyTitle) || 'Untitled Story';
    const chapterGoal = sanitizeText(context.chapterGoal) || 'Move character and conflict forward.';
    const lines = splitLines(text);

    switch (taskType) {
        case 'continuity-checker': {
            const checks = [
                `Timeline check: verify event order matches chapter goal (${chapterGoal}).`,
                'Character check: ensure motivation and voice remain consistent across scenes.',
                'World-rule check: confirm powers, limits, and setting constraints are not broken.'
            ];
            return { title: `${title} continuity report`, output: checks.join('\n- '), source: 'fallback' };
        }
        case 'plot-hole-scanner': {
            const hints = [
                'Missing setup risk: add one early clue for each big reveal.',
                'Causality risk: each major action should have a visible trigger.',
                'Resolution risk: pay off promises made in the opening beats.'
            ];
            return { title: `${title} plot hole scan`, output: hints.join('\n- '), source: 'fallback' };
        }
        case 'cliffhanger-lab': {
            const hooks = [
                'Soft hook: end with a private confession that reframes the chapter.',
                'Medium hook: reveal a hidden ally is the true leak in the group.',
                'Hard hook: close on immediate danger that forces an impossible choice.'
            ];
            return { title: `${title} cliffhanger options`, output: hooks.join('\n- '), source: 'fallback' };
        }
        case 'dialogue-variants': {
            const seed = lines[0] || 'We are out of time.';
            const variants = [
                `Calm strategist: "${seed} We commit to one clean move, no panic."`,
                `Impulsive voice: "${seed} We jump now or we lose everything."`,
                `Wry voice: "${seed} Great, another perfect day for chaos."`
            ];
            return { title: `${title} dialogue variants`, output: variants.join('\n- '), source: 'fallback' };
        }
        case 'scene-to-panel-brief': {
            const cue = buildHeuristicCue(text, context);
            const panelBrief = [
                `Panel 1 (establish): ${cue.shotPlan}`,
                `Panel 2 (emotion): Focus on ${cue.focus}.`,
                `Panel 3 (turn): Use lighting - ${cue.lighting}`,
                `Panel 4 (hook): ${cue.panelFlow}`
            ];
            return { title: cue.title, output: panelBrief.join('\n- '), source: 'fallback' };
        }
        case 'beat-generator':
        default: {
            const beats = [
                `Beat 1 - Setup (${genre}/${tone}): Establish pressure and immediate objective.`,
                `Beat 2 - Friction: A character decision complicates the path to ${chapterGoal}.`,
                'Beat 3 - Turn: New information changes stakes and direction.',
                'Beat 4 - Payoff: Close with momentum into next chapter.'
            ];
            return { title: `${title} chapter beats`, output: beats.join('\n- '), source: 'fallback' };
        }
    }
}

function postJson(baseUrl, urlPath, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify(body);
        const parsedBase = new URL(baseUrl);
        const requestModule = parsedBase.protocol === 'http:' ? http : https;
        const req = requestModule.request(
            {
                protocol: parsedBase.protocol,
                hostname: parsedBase.hostname,
                port: parsedBase.port || undefined,
                path: `${parsedBase.pathname.replace(/\/$/, '')}${urlPath}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    ...headers
                }
            },
            res => {
                let data = '';
                res.on('data', chunk => {
                    data += chunk;
                });
                res.on('end', () => {
                    const status = res.statusCode || 500;
                    if (status < 200 || status >= 300) {
                        return reject(new Error(`OpenAI request failed (${status}): ${data.slice(0, 400)}`));
                    }

                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(new Error('Failed to parse OpenAI response JSON'));
                    }
                });
            }
        );

        req.setTimeout(15000, () => {
            req.destroy(new Error('OpenAI request timed out'));
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

async function generateCueWithOpenAI({ message, context, fallbackCue }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set');
    }

    const apiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
    const apiReferrer = process.env.AI_HTTP_REFERER || '';
    const apiAppTitle = process.env.AI_APP_TITLE || '';
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const prompt = [
        'You are a comic storyboard assistant helping a writer give visual direction to an artist.',
        'Return ONLY JSON with keys: title, mood, shotPlan, lighting, focus, style, panelFlow.',
        'Keep output concise, practical, and specific to the writer message + context.',
        `Writer message: ${sanitizeText(message)}`,
        `Story title: ${sanitizeText(context.storyTitle)}`,
        `Genre: ${sanitizeText(context.genre)}`,
        `Tone: ${sanitizeText(context.tone)}`,
        `Characters: ${sanitizeText(context.characters)}`,
        `Chapter goal: ${sanitizeText(context.chapterGoal)}`,
        `Visual style preference: ${sanitizeText(context.visualStyle)}`
    ].join('\n');

    const completion = await postJson(
        apiBaseUrl,
        '/v1/chat/completions',
        {
            model,
            temperature: 0.55,
            messages: [
                {
                    role: 'system',
                    content: 'You provide compact, production-ready comic scene cues.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            response_format: { type: 'json_object' }
        },
        {
            Authorization: `Bearer ${apiKey}`,
            ...(apiReferrer ? { 'HTTP-Referer': apiReferrer } : {}),
            ...(apiAppTitle ? { 'X-Title': apiAppTitle } : {})
        }
    );

    const content = completion?.choices?.[0]?.message?.content;
    const parsed = safeParseJsonObject(content);

    return normalizeCueShape(parsed, fallbackCue);
}

async function generateWriterAssistWithOpenAI({ taskType, text, context, fallbackOutput }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is not set');
    }

    const apiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
    const apiReferrer = process.env.AI_HTTP_REFERER || '';
    const apiAppTitle = process.env.AI_APP_TITLE || '';
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
    const prompt = [
        'You are a writer assistant for comic production.',
        `Task type: ${taskType}`,
        'Return only valid JSON with keys: title, output.',
        'Output should be concise and use bullet-style lines separated by new lines.',
        `Story title: ${sanitizeText(context.storyTitle)}`,
        `Genre: ${sanitizeText(context.genre)}`,
        `Tone: ${sanitizeText(context.tone)}`,
        `Characters: ${sanitizeText(context.characters)}`,
        `Chapter goal: ${sanitizeText(context.chapterGoal)}`,
        `Visual style: ${sanitizeText(context.visualStyle)}`,
        `User draft: ${sanitizeText(text)}`
    ].join('\n');

    const completion = await postJson(
        apiBaseUrl,
        '/v1/chat/completions',
        {
            model,
            temperature: 0.6,
            messages: [
                {
                    role: 'system',
                    content: 'You produce practical writer outputs for fast drafting.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            response_format: { type: 'json_object' }
        },
        {
            Authorization: `Bearer ${apiKey}`,
            ...(apiReferrer ? { 'HTTP-Referer': apiReferrer } : {}),
            ...(apiAppTitle ? { 'X-Title': apiAppTitle } : {})
        }
    );

    const content = completion?.choices?.[0]?.message?.content;
    const parsed = safeParseJsonObject(content);

    return {
        title: sanitizeText(parsed?.title) || fallbackOutput.title,
        output: sanitizeText(parsed?.output) || fallbackOutput.output
    };
}

router.post('/writer-scene-cue', auth, aiLimiter, async (req, res) => {
    try {
        const message = sanitizeText(req.body?.message).slice(0, MAX_TEXT_LENGTH);
        const context = sanitizeContext(req.body?.context);

        if (!message) {
            return res.status(400).json({ message: 'message is required' });
        }

        const fallbackCue = buildHeuristicCue(message, context);

        try {
            const cue = await generateCueWithOpenAI({ message, context, fallbackCue });
            return res.json({ cue, source: 'openai' });
        } catch (openAiError) {
            console.warn('AI cue fallback:', openAiError.message);
            return res.json({ cue: fallbackCue, source: 'fallback', warning: openAiError.message });
        }
    } catch (error) {
        console.error('Writer scene cue error:', error);
        res.status(500).json({ message: 'Failed to generate writer scene cue' });
    }
});

router.post('/writer-assist', auth, aiLimiter, async (req, res) => {
    try {
        const taskType = normalizeTaskType(req.body?.taskType);
        const text = sanitizeText(req.body?.text).slice(0, MAX_TEXT_LENGTH);
        const context = sanitizeContext(req.body?.context);

        if (!text) {
            return res.status(400).json({ message: 'text is required' });
        }

        const fallback = buildFallbackWriterAssist({ taskType, text, context });

        try {
            const result = await generateWriterAssistWithOpenAI({
                taskType,
                text,
                context,
                fallbackOutput: fallback
            });
            return res.json({ ...result, source: 'openai' });
        } catch (error) {
            console.warn('Writer assist fallback:', error.message);
            return res.json({ ...fallback, warning: error.message });
        }
    } catch (error) {
        console.error('Writer assist error:', error);
        res.status(500).json({ message: 'Failed to run writer assist task' });
    }
});

module.exports = router;
