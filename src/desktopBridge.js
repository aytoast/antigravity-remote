const http = require('http');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');
let targetCache = { expiresAt: 0, targets: [] };
let knownCdpPorts = [];

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
        const command = `$pids=(Get-Process Antigravity -ErrorAction SilentlyContinue).Id; netstat -ano -p TCP | ForEach-Object { if ($_ -match '^\\s*TCP\\s+\\S+:(\\d+)\\s+\\S+\\s+LISTENING\\s+(\\d+)$' -and $pids -contains [int]$Matches[2]) { $Matches[1] } }`;
        const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8' });
        const ports = output.split(/\r?\n/).map(Number).filter(Number.isInteger);
        return [...new Set([...configured, ...ports])];
    } catch {
        return configured;
    }
}

async function scanTargets(ports) {
    const targets = [];
    await Promise.all(ports.map(async port => {
        try {
            const pages = await requestJson(port, '/json/list');
            targets.push(...pages.map(page => ({ ...page, cdpPort: port })));
        } catch {}
    }));
    return targets.filter(target => target.type === 'page' && target.webSocketDebuggerUrl);
}

async function listTargets(forceRefresh = false) {
    if (!forceRefresh && targetCache.expiresAt > Date.now()) return targetCache.targets;
    let targets = knownCdpPorts.length ? await scanTargets(knownCdpPorts) : [];
    if (!targets.length) {
        targets = await scanTargets(candidatePorts());
        knownCdpPorts = [...new Set(targets.map(target => target.cdpPort))];
    }
    targetCache = { expiresAt: Date.now() + 1000, targets };
    return targetCache.targets;
}

async function findTarget(cascadeId) {
    let targets = await listTargets();
    let target = targets.find(item => item.url.includes(`/c/${cascadeId}`));
    if (!target) {
        targets = await listTargets(true);
        target = targets.find(item => item.url.includes(`/c/${cascadeId}`));
    }
    if (!target) throw new Error('Antigravity conversation is not open on desktop');
    return target;
}

async function findSidebarTarget() {
    const targets = await listTargets();
    for (const target of targets) {
        const hasSidebar = await evaluate(target, `Boolean(document.querySelector('[aria-label="Display Options"]'))`);
        if (hasSidebar) return target;
    }
    throw new Error('Antigravity sidebar is not open on desktop');
}

async function listSidebarThreads() {
    const target = await findSidebarTarget();
    const threads = await evaluate(target, `(()=>[...document.querySelectorAll('[data-testid^="convo-pill-"]')].map((pill,index)=>({id:pill.getAttribute('data-testid').replace(/^convo-pill-/,''),title:(pill.innerText||'').trim().split('\\n')[0],order:index})))()`);
    return Array.isArray(threads) ? threads : [];
}

async function findScheduledTasksTarget() {
    const targets = await listTargets(true);
    for (const target of targets) {
        const hasControl = await evaluate(target, `Boolean([...document.querySelectorAll('button,[role="button"]')].find(item=>item.innerText.trim()==='Scheduled Tasks'))`);
        if (hasControl) return target;
    }
    throw new Error('Scheduled Tasks is unavailable on desktop');
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

function openSession(target) {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(target.webSocketDebuggerUrl);
        const fail = error => { try { socket.close(); } catch {} reject(error); };
        socket.once('open', () => resolve(socket));
        socket.once('error', fail);
    });
}

function sendCommand(socket, id, method, params = {}) {
    return new Promise((resolve, reject) => {
        const onMessage = payload => {
            let message;
            try { message = JSON.parse(payload.toString()); } catch { return; }
            if (message.id !== id) return;
            socket.off('message', onMessage);
            if (message.error) reject(new Error(message.error.message));
            else resolve(message.result);
        };
        socket.on('message', onMessage);
        socket.send(JSON.stringify({ id, method, params }));
    });
}

async function sendPrompt(cascadeId, prompt) {
    const target = await findTarget(cascadeId);
    const socket = await openSession(target);
    let nextId = 1;
    try {
        const focused = await sendCommand(socket, nextId++, 'Runtime.evaluate', { expression: `(()=>{const editor=document.querySelector('[aria-label="Message input"]'); if(!editor) return false; editor.focus(); return true})()`, awaitPromise: true, returnByValue: true });
        if (!focused?.result?.value) throw new Error('Antigravity message input is unavailable');
        await sendCommand(socket, nextId++, 'Input.insertText', { text: prompt });
        await sendCommand(socket, nextId++, 'Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '', unmodifiedText: '', windowsVirtualKeyCode: 13 });
        await sendCommand(socket, nextId++, 'Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', text: '', unmodifiedText: '', windowsVirtualKeyCode: 13 });
        const submitted = await sendCommand(socket, nextId++, 'Runtime.evaluate', { expression: `new Promise(resolve=>{const started=performance.now(); const check=()=>{const editor=document.querySelector('[aria-label="Message input"]'); if(!editor || editor.innerText.trim()==='') return resolve(true); if(performance.now()-started>=250) return resolve(false); requestAnimationFrame(check)}; check()})`, awaitPromise: true, returnByValue: true });
        if (!submitted?.result?.value) throw new Error('Desktop did not submit prompt');
        return { accepted: true };
    } finally {
        try { socket.close(); } catch {}
    }
}

async function listModels(cascadeId) {
    let target;
    try {
        target = await findTarget(cascadeId);
    } catch {
        const targets = await listTargets(true);
        for (const candidate of targets) {
            if (await evaluate(candidate, `Boolean(document.querySelector('[aria-label^="Select model"]'))`)) {
                target = candidate;
                break;
            }
        }
        if (!target) throw new Error('Antigravity model selector is unavailable');
    }
    const result = await evaluate(target, `(()=>{const button=document.querySelector('[aria-label^="Select model"]'); if(!button) return {models:[],selected:''}; const visible=element=>element && element.getBoundingClientRect().width>0 && element.getBoundingClientRect().height>0; const collect=()=>[...document.querySelectorAll('button,[role="menuitem"],[role="option"]')].filter(visible).map(item=>item.innerText.trim()).filter(Boolean); const modelText=/\\b(?:Gemini|Claude|GPT|Grok|DeepSeek|Llama|Mistral|Qwen)\\b/i; const isModel=model=>modelText.test(model)&&!/(?:python|node|powershell|\\.exe)\\b/i.test(model); const selected=button.innerText.trim(); let models=collect().filter(isModel); if(models.length<2) button.click(); return new Promise(resolve=>{const started=performance.now(); const check=()=>{models=collect().filter(isModel); if(models.length>1||performance.now()-started>500) return resolve({selected,models}); setTimeout(check,16)}; check()})})()`);
    const models = [...new Set((result?.models || [])
        .map(model => model.replace(/\s+/g, ' ').trim())
        .filter(model => /\b(?:Gemini|Claude|GPT|Grok|DeepSeek|Llama|Mistral|Qwen)\b/i.test(model) && !/(?:python|node|powershell|\.exe)\b/i.test(model)))];
    const selected = result?.selected?.replace(/\s+/g, ' ').trim();
    return { models, selected: models.includes(selected) ? selected : (models[0] || '') };
}

async function selectModel(cascadeId, model) {
    const target = await findTarget(cascadeId);
    const selected = await evaluate(target, `(()=>{const button=document.querySelector('[aria-label^="Select model"]'); if(!button) return false; const visible=element=>element && element.getBoundingClientRect().width>0 && element.getBoundingClientRect().height>0; const findOption=()=>[...document.querySelectorAll('button,[role="menuitem"],[role="option"]')].filter(visible).find(item=>item.innerText.trim()===${JSON.stringify(model)}); if(!findOption()) button.click(); return new Promise(resolve=>{const started=performance.now(); const check=()=>{const option=findOption(); if(option){option.click(); return resolve(true)} if(performance.now()-started>500) return resolve(false); setTimeout(check,16)}; check()})})()`);
    if (!selected) throw new Error('Requested model is unavailable');
    return { selected: model };
}

async function setThreadPinned(cascadeId) {
    const target = await findSidebarTarget();
    const clicked = await evaluate(target, `(()=>{
        const pill=document.querySelector('[data-testid="convo-pill-${cascadeId}"]');
        const row=pill?.closest('[role="button"]');
        const buttons=row?[...row.querySelectorAll('button')]:[];
        const pinButton=buttons[1];
        if(!pinButton) return false;
        pinButton.click();
        return true;
    })()`);
    if (!clicked) throw new Error('Conversation pin control is not rendered on desktop');
    return { accepted: true };
}

const sidebarMenuExpression = (action) => `(()=>{
    const display=document.querySelector('[aria-label="Display Options"]');
    if(!display) return Promise.resolve({error:'Display options are unavailable'});
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const buttons=()=>[...document.querySelectorAll('button')];
    const find=name=>buttons().find(button=>button.innerText.trim()===name);
    const state=()=>buttons().filter(button=>button.className.includes('bg-secondary')&&button.className.includes('font-medium')).map(button=>button.innerText.trim());
    return (async()=>{
        let opened=false;
        if(!find('Project')) { display.click(); opened=true; await wait(80); }
        if(${JSON.stringify(action)}) {
            const option=find(${JSON.stringify(action)});
            if(!option) return {error:'Requested display option is unavailable'};
            option.click();
            await wait(80);
            if(!find('Project')) { display.click(); await wait(80); }
            const selected=state();
            if(find('Project')) display.click();
            return {selected};
        }
        const selected=state();
        if(opened) display.click();
        return {selected};
    })();
})()`;

async function getSidebarOptions() {
    const target = await findSidebarTarget();
    const result = await evaluate(target, sidebarMenuExpression(null));
    if (result?.error) throw new Error(result.error);
    return { selected: result?.selected || [] };
}

async function setSidebarOption(option) {
    const allowed = new Set(['Project', 'None', 'Last Updated', 'Alphabetical (A-Z)', 'Scheduled']);
    if (!allowed.has(option)) throw new Error('Requested display option is unsupported on mobile');
    const target = await findSidebarTarget();
    const result = await evaluate(target, sidebarMenuExpression(option));
    if (result?.error) throw new Error(result.error);
    if (option !== 'Scheduled' && !result?.selected?.includes(option)) throw new Error('Desktop did not apply display option');
    return { selected: result.selected };
}

async function openScheduledTasks() {
    const target = await findScheduledTasksTarget();
    const opened = await evaluate(target, `(()=>{const control=[...document.querySelectorAll('button,[role="button"]')].find(item=>item.innerText.trim()==='Scheduled Tasks'); if(!control) return false; const onTasksPage=[...document.querySelectorAll('h1')].some(item=>item.innerText.trim()==='Scheduled Tasks'); if(!onTasksPage) control.click(); return true})()`);
    if (!opened) throw new Error('Scheduled Tasks is unavailable on desktop');
    return { opened: true };
}

const scheduledTasksExpression = (name, enabled) => `(()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    const openTasks=()=>{
        const control=[...document.querySelectorAll('button,[role="button"]')].find(item=>item.innerText.trim()==='Scheduled Tasks');
        if(!control) return false;
        const onTasksPage=[...document.querySelectorAll('h1')].some(item=>item.innerText.trim()==='Scheduled Tasks');
        if(!onTasksPage) control.click();
        return true;
    };
    const tasks=()=>[...document.querySelectorAll('[role="switch"]')].map(toggle=>{
        const card=toggle.parentElement?.parentElement;
        const lines=(card?.innerText||'').split('\\n').map(line=>line.trim()).filter(Boolean);
        return {name:lines[0]||'', schedule:lines[1]||'', enabled:toggle.getAttribute('aria-checked')==='true'};
    }).filter(task=>task.name);
    return (async()=>{
        if(!openTasks()) return {error:'Scheduled Tasks is unavailable'};
        await wait(100);
        if(${JSON.stringify(name)}) {
            const toggles=[...document.querySelectorAll('[role="switch"]')];
            const toggle=toggles.find(item=>{
                const card=item.parentElement?.parentElement;
                return card?.innerText.split('\\n').map(line=>line.trim()).filter(Boolean)[0]===${JSON.stringify(name)};
            });
            if(!toggle) return {error:'Scheduled task is unavailable'};
            const current=toggle.getAttribute('aria-checked')==='true';
            if(current!==${JSON.stringify(enabled)}) toggle.click();
            await wait(100);
        }
        return {tasks:tasks()};
    })();
})()`;

async function listScheduledTasks() {
    const target = await findScheduledTasksTarget();
    const result = await evaluate(target, scheduledTasksExpression(null, null));
    if (result?.error) throw new Error(result.error);
    return result?.tasks || [];
}

async function setScheduledTaskEnabled(name, enabled) {
    const target = await findScheduledTasksTarget();
    const result = await evaluate(target, scheduledTasksExpression(name, enabled));
    if (result?.error) throw new Error(result.error);
    const task = result?.tasks?.find(item => item.name === name);
    if (!task || task.enabled !== enabled) throw new Error('Desktop did not update scheduled task');
    return result.tasks;
}

async function getScheduledTaskDetail(name) {
    const target = await findScheduledTasksTarget();
    const detail = await evaluate(target, `(()=>{
        const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        const taskName=${JSON.stringify(name)};
        const openTasks=()=>{
            const control=[...document.querySelectorAll('button,[role="button"]')].find(item=>item.innerText.trim()==='Scheduled Tasks');
            if(!control) return false;
            const onTasksPage=[...document.querySelectorAll('h1')].some(item=>item.innerText.trim()==='Scheduled Tasks');
            if(!onTasksPage) control.click();
            return true;
        };
        return (async()=>{
            if(!openTasks()) return {error:'Scheduled Tasks is unavailable'};
            await wait(100);
            const toggle=[...document.querySelectorAll('[role="switch"]')].find(item=>item.parentElement?.parentElement?.innerText.split('\\n').map(line=>line.trim()).filter(Boolean)[0]===taskName);
            const card=toggle?.parentElement?.parentElement;
            if(!card) return {error:'Scheduled task is unavailable'};
            card.click();
            await wait(100);
            const prompt=document.querySelector('textarea');
            const title=prompt ? document.body.innerText.split('\\n').map(line=>line.trim()).filter(Boolean).find(line=>line===taskName) : taskName;
            const workspace=[...document.querySelectorAll('button')].find(item=>item.title==='Open project settings')?.innerText.trim()||'';
            const taskToggle=document.querySelector('[role="switch"]');
            const events=[...document.querySelectorAll('button')].map(item=>item.innerText.trim()).filter(text=>text.includes('Triggered ')).map(text=>{
                const lines=text.split('\\n').filter(Boolean);
                return {title:lines[0], triggeredAt:lines[1]?.replace(/^Triggered\s*/, '').trim()||''};
            });
            const scheduleLines=document.body.innerText.split('\\n').map(line=>line.trim()).filter(Boolean);
            const scheduleIndex=scheduleLines.indexOf('Schedule');
            const schedule=scheduleIndex>=0?scheduleLines.slice(scheduleIndex+1,scheduleIndex+4).filter(value=>!['Save','Events'].includes(value)).join(' '):'';
            return {name:title||taskName, workspace, prompt:prompt?.value||'', schedule, enabled:taskToggle?.getAttribute('aria-checked')==='true', events};
        })();
    })()`);
    if (detail?.error) throw new Error(detail.error);
    return detail;
}

module.exports = { listTargets, sendPrompt, listModels, selectModel, setThreadPinned, getSidebarOptions, setSidebarOption, listSidebarThreads, openScheduledTasks, listScheduledTasks, setScheduledTaskEnabled, getScheduledTaskDetail };
