const http = require('http');
const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Configuration
const PORT = process.env.PORT || 3000;
// GitHub token: env var first, otherwise the token sent by the app via 'auth'
let activeToken = process.env.GITHUB_TOKEN || null;
const GITHUB_REPO = process.env.GITHUB_REPO || '';
const GITHUB_OWNER = process.env.GITHUB_OWNER || '';

// Cline CLI integration (headless agent runs)
const CLINE_BIN = process.env.CLINE_BIN || 'cline';
// Default to the repo root (parent of bridge/) so the agent operates on the project
const CLINE_CWD = process.env.CLINE_CWD || path.resolve(__dirname, '..');
const CLINE_PROVIDER = process.env.CLINE_PROVIDER || '';
const CLINE_MODEL = process.env.CLINE_MODEL || '';
const CLINE_API_KEY = process.env.CLINE_API_KEY || '';
const CLINE_THINKING = process.env.CLINE_THINKING || '';
// Keep only recent turns when replaying conversation context (costs input tokens)
const MAX_HISTORY_MESSAGES = parseInt(process.env.CLINE_MAX_HISTORY || '20', 10);

// Per-client auth state and Cline task tracking
const authedClients = new Set();
const conversations = new Map();   // clientId -> [{ role, content }]
const runningTasks = new Map();    // clientId -> ChildProcess
const partials = new Map();        // clientId -> streamed-so-far text
const stoppedClients = new Set();  // clientId with an intentional stop

// In-memory storage for connected clients and state
const clients = new Map();
const codespaces = new Map();
const messageQueue = [];
let serverState = {
    connected: false,
    authenticated: false,
    version: '1.0.0',
    bridgeUrl: `http://localhost:${PORT}`,
    status: 'disconnected'
};

// GitHub REST API helper
async function githubRequest(path, options = {}) {
    if (!activeToken) {
        throw new Error('No GitHub token: set GITHUB_TOKEN env var or authenticate from the app');
    }
    const url = new URL(path, 'https://api.github.com');
    const headers = {
        'Authorization': `Bearer ${activeToken}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
    };

    const response = await fetch(url.toString(), {
        method: options.method || 'GET',
        headers: headers,
        body: options.body
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`GitHub API error ${response.status}: ${error}`);
    }

    // Some endpoints (e.g. DELETE) answer with an empty or non-JSON body
    const text = await response.text();
    return text ? JSON.parse(text) : null;
}

// Get list of codespaces for the authenticated user
async function listMyCodespaces() {
    const data = await githubRequest('/user/codespaces');
    // GET /user/codespaces returns { total_count, codespaces } (defensively also accept a bare array)
    const items = Array.isArray(data) ? data : (data && data.codespaces) || [];
    return items.map((cs) => ({
        id: cs.id,
        name: cs.name,
        repository: cs.repository,
        container_opened_at: cs.container_opened_at,
        status: cs.status,
        state: cs.state,
        url: cs.url,
        web_url: cs.web_url,
        ssh_url: cs.ssh_url,
        model: cs.model,
        region: cs.region
    }));
}

// Get a specific codespace
async function getCodespace(name) {
    const data = await githubRequest(`/user/codespaces/${encodeURIComponent(name)}`);
    return {
        id: data.id,
        name: data.name,
        repository: data.repository,
        container_opened_at: data.container_opened_at,
        status: data.status,
        state: data.state,
        url: data.url,
        web_url: data.web_url,
        ssh_url: data.ssh_url,
        model: data.model,
        region: data.region
    };
}

// Create a new codespace in a repository (the repository comes from the path)
async function createCodespace(repo, options = {}) {
    const [owner, repoName] = String(repo).split('/');
    if (!owner || !repoName) {
        throw new Error(`Invalid repository "${repo}": expected owner/repo`);
    }
    const data = await githubRequest(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}/codespaces`,
        {
            method: 'POST',
            body: JSON.stringify({
                display_name: options.displayName,
                ref: options.ref,
                machine: options.machine,
                location: options.location
            })
        }
    );
    return {
        id: data.id,
        name: data.name,
        repository: data.repository,
        container_opened_at: data.container_opened_at,
        status: data.status,
        state: data.state,
        url: data.url,
        web_url: data.web_url,
        ssh_url: data.ssh_url,
        model: data.model,
        region: data.region
    };
}

// Start a codespace
async function startCodespace(name) {
    const data = await githubRequest(`/user/codespaces/${encodeURIComponent(name)}/start`, {
        method: 'POST'
    });
    return {
        id: data.id,
        name: data.name,
        state: data.state,
        status: data.status
    };
}

// Stop a codespace
async function stopCodespace(name) {
    const data = await githubRequest(`/user/codespaces/${encodeURIComponent(name)}/stop`, {
        method: 'POST'
    });
    return {
        id: data.id,
        name: data.name,
        state: data.state,
        status: data.status
    };
}

// Restart a codespace
async function restartCodespace(name) {
    const data = await githubRequest(`/user/codespaces/${encodeURIComponent(name)}/restart`, {
        method: 'POST'
    });
    return {
        id: data.id,
        name: data.name,
        state: data.state,
        status: data.status
    };
}

// Delete a codespace (DELETE /user/codespaces/{name} → 202 Accepted, empty JSON body)
async function deleteCodespace(name) {
    await githubRequest(`/user/codespaces/${encodeURIComponent(name)}`, {
        method: 'DELETE'
    });
    return {
        id: null,
        name: name,
        state: 'deleted',
        status: 'ended'
    };
}

// Broadcast state to all connected clients
function broadcastState() {
    const state = {
        type: 'status',
        payload: serverState
    };
    const json = JSON.stringify(state);
    for (const [id, client] of clients.entries()) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(json);
        }
    }
}
// Handle WebSocket connection
function handleWebSocketConnection(ws, request) {
    const clientId = Math.random().toString(36).substring(2);
    clients.set(clientId, ws);

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            Promise.resolve(handleMessage(clientId, message)).catch((e) => {
                console.error('Message handling error:', e);
                sendTo(clientId, { type: 'error', payload: { error: `Internal error: ${e.message}` } });
            });
        } catch (e) {
            ws.send(JSON.stringify({
                type: 'error',
                payload: { error: 'Invalid message format' }
            }));
        }
    });

    ws.on('close', () => {
        clients.delete(clientId);
        authedClients.delete(clientId);
        conversations.delete(clientId);
        partials.delete(clientId);
        stoppedClients.delete(clientId);
        stopCline(clientId);
        console.log(`Client ${clientId} disconnected`);
        broadcastState();
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(clientId);
    });

    // Send connection confirmation
    ws.send(JSON.stringify({
        type: 'status',
        payload: {
            ...serverState,
            status: 'connecting'
        }
    }));

    console.log(`Client ${clientId} connected`);
}

function requireAuth(clientId) {
    if (authedClients.has(clientId)) return true;
    sendTo(clientId, {
        type: 'error',
        payload: { error: 'Not authenticated: send an auth message with a valid GitHub token first' }
    });
    return false;
}

// Validate the client token against GitHub before trusting it. Only then is the
// client considered authenticated (and allowed to run commands / the agent).
async function handleAuth(clientId, message) {
    const clientToken = message.payload && message.payload.token;
    try {
        if (clientToken) {
            const user = await fetchUser(clientToken);
            activeToken = clientToken;
            authedClients.add(clientId);
            serverState.authenticated = true;
            serverState.connected = true;
            serverState.status = 'authenticated';
            broadcastState();
            sendTo(clientId, {
                type: 'auth_success',
                payload: { bridgeState: serverState, login: user.login }
            });
        } else if (activeToken) {
            // Bridge already has a token (env var): accept the client without one
            authedClients.add(clientId);
            serverState.authenticated = true;
            serverState.connected = true;
            serverState.status = 'authenticated';
            broadcastState();
            sendTo(clientId, {
                type: 'auth_success',
                payload: { bridgeState: serverState }
            });
        } else {
            sendTo(clientId, {
                type: 'auth_error',
                payload: { error: 'No GitHub token: configure GITHUB_TOKEN or authenticate from the app' }
            });
        }
    } catch (e) {
        sendTo(clientId, {
            type: 'auth_error',
            payload: { error: `Token non valido: ${e.message}` }
        });
    }
}

function handleChatMessage(clientId, message) {
    const payload = message.payload || {};
    const msgObj = payload.message || {};
    const text = (typeof msgObj.content === 'string' && msgObj.content) || payload.text || '';
    if (!text.trim()) {
        sendTo(clientId, { type: 'error', payload: { error: 'Messaggio vuoto' } });
        return;
    }
    const provider = payload.provider;
    const model = payload.model;
    const apiKey = payload.apiKey;
    const conversationId = typeof payload.conversationId === 'string' && payload.conversationId.trim()
        ? payload.conversationId.trim()
        : 'default';
    if (provider !== 'openrouter') {
        sendTo(clientId, { type: 'error', payload: { error: 'Unsupported provider: select OpenRouter in the app.' } });
        return;
    }
    if (typeof model !== 'string' || !model.endsWith(':free')) {
        sendTo(clientId, { type: 'error', payload: { error: 'Select a free OpenRouter model that is compatible with Cline.' } });
        return;
    }
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
        sendTo(clientId, { type: 'error', payload: { error: 'OpenRouter key missing: configure it in the app Settings.' } });
        return;
    }
    runCline(clientId, conversationId, text.trim(), { provider, model, apiKey: apiKey.trim() });
}

async function handleMessage(clientId, message) {
    switch (message.type) {
        case 'connect':
            // Connection already handled via WebSocket
            break;

        case 'auth':
            await handleAuth(clientId, message);
            break;

        case 'ping':
            sendTo(clientId, { type: 'pong' });
            break;

        case 'chat_message':
            if (!requireAuth(clientId)) break;
            handleChatMessage(clientId, message);
            break;

        case 'chat_stop':
            stoppedClients.add(clientId);
            stopCline(clientId);
            break;

        case 'command':
            if (!requireAuth(clientId)) break;
            handleCommand(clientId, message.payload && message.payload.command);
            break;

        case 'action_approve':
            if (!requireAuth(clientId)) break;
            handleActionApprove(clientId, message.payload && message.payload.actionId);
            break;

        case 'action_deny':
            if (!requireAuth(clientId)) break;
            handleActionDeny(clientId, message.payload && message.payload.actionId);
            break;

        default:
            console.log(`Unhandled message type: ${message.type}`);
    }
}

function handleCommand(clientId, command) {
    console.log(`Executing command: ${command}`);

    // Send command to output channel
    // In a real app, this would use child_process or a terminal API
    const output = `Command executed: ${command}\n`;
    sendTo(clientId, {
        type: 'chat_stream',
        payload: { text: output }
    });

    sendTo(clientId, {
        type: 'chat_message',
        payload: {
            role: 'user',
            text: command,
            timestamp: Date.now()
        }
    });

    // Add simulated response
    setTimeout(() => {
        const response = `Output for: ${command}\n[This would be the actual command output]`;
        sendTo(clientId, {
            type: 'chat_stream',
            payload: { text: response }
        });

        sendTo(clientId, {
            type: 'chat_message',
            payload: {
                role: 'assistant',
                text: response,
                timestamp: Date.now()
            }
        });
    }, 1000);
}

function handleActionApprove(clientId, actionId) {
    console.log(`Action approved: ${actionId}`);
    sendTo(clientId, {
        type: 'action_approved',
        payload: { actionId }
    });
}

function handleActionDeny(clientId, actionId) {
    console.log(`Action denied: ${actionId}`);
    sendTo(clientId, {
        type: 'action_denied',
        payload: { actionId }
    });
}

function wsFor(clientId) {
    const client = clients.get(clientId);
    if (!client) {
        throw new Error(`Client ${clientId} not found`);
    }
    return client;
}

function sendTo(clientId, obj) {
    const client = clients.get(clientId);
    if (client && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(obj));
    }
}

function msgId() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function conversationKey(clientId, conversationId) {
    return JSON.stringify([clientId, conversationId]);
}

function sanitizeErrorText(value) {
    return String(value)
        .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/\bsk-or-v1-[a-zA-Z0-9_-]+\b/g, '[REDACTED]')
        .replace(/(api[_-]?key["'\s:=]+)[^\s,"'}]+/gi, '$1[REDACTED]')
        .trim()
        .slice(0, 1200);
}

function formatClineError(errorEvent) {
    const details = [];
    const addDetail = (label, value) => {
        if (typeof value === 'string' && value.trim()) {
            details.push(`${label}: ${sanitizeErrorText(value)}`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            details.push(`${label}: ${value}`);
        } else if (value && typeof value === 'object') {
            for (const key of ['message', 'text', 'code', 'status', 'statusCode', 'details', 'reason']) {
                addDetail(key, value[key]);
            }
        }
    };

    for (const key of ['text', 'message', 'error', 'details', 'reason', 'code', 'status', 'statusCode']) {
        addDetail(key, errorEvent[key]);
    }
    if (details.length) return [...new Set(details)].join(' — ').slice(0, 1600);

    const fields = Object.keys(errorEvent).filter((key) => key !== 'type');
    return fields.length
        ? `Cline reported an error without a readable message (fields: ${fields.join(', ')}). Check bridge logs.`
        : 'Cline reported an error without details. Check bridge logs.';
}

// Validate a GitHub token by calling the API; returns the user on success
async function fetchUser(token) {
    const response = await fetch('https://api.github.com/user', {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28'
        }
    });
    if (!response.ok) {
        throw new Error(`GitHub API ${response.status}`);
    }
    return response.json();
}

function buildClineArgs(config = {}) {
    const args = ['--json', '--auto-approve', 'true'];
    const provider = config.provider || CLINE_PROVIDER;
    const model = config.model || CLINE_MODEL;
    const apiKey = config.apiKey || CLINE_API_KEY;
    if (config.configDir) args.push('--config', config.configDir);
    if (provider) args.push('-P', provider);
    if (model) args.push('-m', model);
    if (apiKey) args.push('-k', apiKey);
    if (CLINE_THINKING) args.push('--thinking', CLINE_THINKING);
    return args;
}

// Run a single Cline task for a client. Each turn is a fresh session that
// replays recent conversation context in the prompt, working around the broken
// `--id` resume in --json mode (cline/cline#10856). Streams NDJSON events back
// to the app as chat_stream / chat_message / error bridge messages.
function runCline(clientId, conversationId, userText, config) {
    stopCline(clientId);

    const contextKey = conversationKey(clientId, conversationId);
    const history = conversations.get(contextKey) || [];
    const recent = history.slice(-MAX_HISTORY_MESSAGES);
    const transcript = recent
        .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
        .join('\n\n');
    const prompt = transcript
        ? `${transcript}\n\nUser: ${userText}\n\nAssistant:`
        : userText;

    let configDir;
    try {
        configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-mobile-'));
    } catch (e) {
        sendTo(clientId, { type: 'error', payload: { error: `Unable to prepare Cline configuration: ${e.message}` } });
        return;
    }
    const args = buildClineArgs({ ...config, configDir });
    args.push(prompt); // positional prompt

    let child;
    try {
        child = spawn(CLINE_BIN, args, { cwd: CLINE_CWD, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
        fs.rm(configDir, { recursive: true, force: true }, (cleanupError) => {
            if (cleanupError) console.error('Cline config cleanup failed:', cleanupError.message);
        });
        sendTo(clientId, { type: 'error', payload: { error: `Unable to start Cline: ${e.message}` } });
        return;
    }
    runningTasks.set(clientId, child);
    partials.set(clientId, '');
    // Close stdin so --json doesn't wait for piped input; the prompt is positional
    try { child.stdin.end(); } catch (e) { /* ignore */ }

    let stdoutBuf = '';
    let stderrBuf = '';
    let finalText = null;
    let spawnError = false;

    child.stdout.on('data', (d) => {
        stdoutBuf += d.toString();
        let nl;
        while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
            const line = stdoutBuf.slice(0, nl).trim();
            stdoutBuf = stdoutBuf.slice(nl + 1);
            if (!line) continue;
            let evt;
            try { evt = JSON.parse(line); } catch (e) { continue; }
            handleClineEvent(clientId, evt);
            if (evt.type === 'run_result' && typeof evt.text === 'string') {
                finalText = evt.text;
            } else if (
                evt.type === 'agent_event' && evt.event &&
                evt.event.type === 'done' && finalText == null &&
                typeof evt.event.text === 'string'
            ) {
                finalText = evt.event.text;
            }
        }
    });

    child.stderr.on('data', (d) => { stderrBuf += d.toString(); });

    child.on('error', (err) => {
        spawnError = true;
        runningTasks.delete(clientId);
        sendTo(clientId, { type: 'error', payload: { error: `Cline: ${err.message}` } });
    });

    child.on('close', (code) => {
        runningTasks.delete(clientId);
        fs.rm(configDir, { recursive: true, force: true }, (cleanupError) => {
            if (cleanupError) console.error('Cline config cleanup failed:', cleanupError.message);
        });
        const wasStopped = stoppedClients.delete(clientId);
        const partial = partials.get(clientId) || '';
        partials.delete(clientId);

        // Flush any trailing stdout without a newline
        if (stdoutBuf.trim()) {
            try { handleClineEvent(clientId, JSON.parse(stdoutBuf.trim())); } catch (e) { /* ignore */ }
        }
        if (spawnError) return;

        let errMessage = null;
        if (finalText == null && stderrBuf.trim()) {
            const lastLine = stderrBuf.trim().split('\n').pop();
            try {
                const parsed = JSON.parse(lastLine);
                if (parsed.type === 'error') errMessage = parsed.message;
            } catch (e) { /* not JSON */ }
            if (!errMessage) errMessage = stderrBuf.trim().slice(0, 500);
        }

        if (finalText != null) {
            conversations.set(contextKey, [
                ...history,
                { role: 'user', content: userText },
                { role: 'assistant', content: finalText }
            ]);
            sendTo(clientId, {
                type: 'chat_message',
                payload: { message: { id: msgId(), role: 'assistant', content: finalText, timestamp: Date.now() } }
            });
        } else if (wasStopped) {
            conversations.set(contextKey, [
                ...history,
                { role: 'user', content: userText },
                { role: 'assistant', content: partial || '(interrotto)' }
            ]);
            sendTo(clientId, {
                type: 'chat_message',
                payload: { message: { id: msgId(), role: 'assistant', content: partial || '(interrotto)', timestamp: Date.now() } }
            });
        } else if (errMessage) {
            sendTo(clientId, { type: 'error', payload: { error: errMessage } });
        } else {
            sendTo(clientId, { type: 'error', payload: { error: `Cline exited without output (code ${code})` } });
        }
    });
}

function handleClineEvent(clientId, evt) {
    if (evt.type !== 'agent_event' || !evt.event) return;
    const e = evt.event;
    if (e.type === 'content_start' || e.type === 'content_update') {
        const delta = extractDelta(e);
        if (delta) {
            partials.set(clientId, (partials.get(clientId) || '') + delta);
            sendTo(clientId, { type: 'chat_stream', payload: { text: delta } });
        }
    } else if (e.type === 'error') {
        const error = formatClineError(e);
        console.error('Cline agent error:', error);
        sendTo(clientId, { type: 'error', payload: { error } });
    }
    // other event types (iteration_*, usage, notice, done) are ignored for now
}

function extractDelta(e) {
    if (typeof e.text === 'string') return e.text;
    if (typeof e.content === 'string') return e.content;
    if (typeof e.delta === 'string') return e.delta;
    if (typeof e.value === 'string') return e.value;
    if (typeof e.chunk === 'string') return e.chunk;
    return '';
}

function stopCline(clientId) {
    const child = runningTasks.get(clientId);
    if (child) {
        try { child.kill('SIGTERM'); } catch (e) { /* ignore */ }
        runningTasks.delete(clientId);
    }
}

// Create HTTP server
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Cline Agent Mobile Bridge Server');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, request) => {
    handleWebSocketConnection(ws, request);
});

// Start server
server.listen(PORT, () => {
    console.log(`Bridge server listening on port ${PORT}`);
    console.log(`GITHUB_TOKEN: ${activeToken ? 'Configured' : 'Not configured (set env var or authenticate from the app)'}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down');
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down');
    wss.close(() => {
        server.close(() => {
            process.exit(0);
        });
    });
});

module.exports = {
    server,
    wss,
    listMyCodespaces,
    getCodespace,
    createCodespace,
    startCodespace,
    stopCodespace,
    restartCodespace,
    deleteCodespace,
    broadcastState,
    serverState,
    // Cline integration + auth helpers (exposed for tests)
    buildClineArgs,
    conversationKey,
    extractDelta,
    formatClineError,
    fetchUser,
    handleMessage
};
