const http = require('http');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const requestJson = (port, pathname) => new Promise((resolve, reject) => {
    const request = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 500 }, response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { body += chunk; });
        response.on('end', () => {
            if (response.statusCode !== 200) return reject(new Error(`CDP HTTP ${response.statusCode}`));
            try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid CDP response')); }
        });
    });
    request.on('timeout', () => request.destroy(new Error('CDP timeout')));
    request.on('error', reject);
});

function candidatePorts() {
    const configured = process.env.ANTIGRAVITY_CDP_PORT ? [Number(process.env.ANTIGRAVITY_CDP_PORT)] : [];
    try {
        const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-NetTCPConnection -State Listen | Select-Object -ExpandProperty LocalPort'], { encoding: 'utf8' });
        const ports = output.split(/\r?\n/).map(Number).filter(Number.isInteger);
        return [...new Set([...configured, ...ports])];
    } catch {
        return configured;
    }
}

async function listTargets() {
    const targets = [];
    for (const port of candidatePorts()) {
        try {
            const pages = await requestJson(port, '/json/list');
            targets.push(...pages.map(page => ({ ...page, cdpPort: port })));
        } catch {}
    }
    return targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl);
}

async function findTarget(cascadeId) {
    const targets = await listTargets();
    const target = targets.find(item => item.url.includes(`/c/${cascadeId}`));
    if (!target) throw new Error('Antigravity conversation is not open on desktop');
    return target;
}

function evaluate(target, expression) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        const id = 1;
        const close = () => { try { socket.close(); } catch {} };
        socket.on('open', () => socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })));
        socket.on('message', payload => {
            const message = JSON.parse(payload.toString());
            if (message.id !== id) return;
            close();
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result?.result?.value);
        });
        socket.on('error', error => { close(); reject(error); });
    });
}

async function sendPrompt(cascadeId, prompt) {
    const target = await findTarget(cascadeId);
    const result = await evaluate(target, `(()=>{const editor=document.querySelector('[aria-label="Message input"]'); if(!editor) return false; editor.focus(); return true})()`);
    if (!result) throw new Error('Antigravity message input is unavailable');
    await evaluate(target, `(()=>{document.activeElement?.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:${JSON.stringify(prompt)}})); return true})()`);
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.on('open', () => socket.send(JSON.stringify({ id: 1, method: 'Input.insertText', params: { text: prompt } })));
        socket.on('message', () => { socket.send(JSON.stringify({ id: 2, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 } })); socket.send(JSON.stringify({ id: 3, method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 } })); resolve(); });
        socket.on('error', reject);
    });
    socket.close();
    return { accepted: true };
}

async function listModels(cascadeId) {
    const target = await findTarget(cascadeId);
    const models = await evaluate(target, `(()=>{const button=document.querySelector('[aria-label^="Select model"]'); if(!button) return []; button.click(); return new Promise(resolve=>setTimeout(()=>resolve([...document.querySelectorAll('[role="menuitem"],button')].map(item=>item.innerText.trim()).filter(Boolean)),150))})()`);
    return [...new Set((models || []).filter(model => /\b(?:Gemini|Claude|GPT|Grok|DeepSeek|Llama|Mistral|Qwen)\b/i.test(model)))];
}

async function selectModel(cascadeId, model) {
    const target = await findTarget(cascadeId);
    const selected = await evaluate(target, `(()=>{const button=document.querySelector('[aria-label^="Select model"]'); if(!button) return false; button.click(); return new Promise(resolve=>setTimeout(()=>{const option=[...document.querySelectorAll('[role="menuitem"],button')].find(item=>item.innerText.trim()===${JSON.stringify(model)}); if(!option) return resolve(false); option.click(); resolve(true)},150))})()`);
    if (!selected) throw new Error('Requested model is unavailable');
    return { selected: model };
}

module.exports = { listTargets, sendPrompt, listModels, selectModel };
