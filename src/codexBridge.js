const { execFileSync, spawn } = require('child_process');
const { EventEmitter } = require('events');
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const command = process.env.CODEX_COMMAND || require.resolve('@openai/codex/bin/codex.js');
const codexHome = process.env.CODEX_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
const desktopStatePath = path.join(codexHome, '.codex-global-state.json');
const automationsPath = path.join(codexHome, 'automations');
const stateDatabasePath = path.join(codexHome, 'state_5.sqlite');
const desktopUiLogPath = path.join(codexHome, 'logs', 'antigravity-remote-uia.log');
let child;
let nextId = 1;
let buffer = '';
let started;
const pending = new Map();
const events = new EventEmitter();
const activeTurns = new Map();
let desktopStateCache = { mtimeMs: -1, data: null };
const desktopModelCache = new Map();
let visibleDesktopModelCache = { expiresAt: 0, model: null };

function normalizeDesktopState(raw = {}) {
    const state = { ...(raw['electron-persisted-atom-state'] || {}), ...raw };
    const roots = state['electron-saved-workspace-roots'] || [];
    const projectOrder = state['project-order'] || [];
    const pinnedProjects = new Set(state['pinned-project-ids'] || []);
    const threadWorkspacePaths = new Map(Object.entries(state['thread-project-assignments'] || {}).map(([threadId, assignment]) => [
        threadId,
        assignment?.path || assignment?.cwd || assignment?.projectId
    ]).filter(([, workspacePath]) => workspacePath));
    return {
        projectlessThreadIds: new Set(state['projectless-thread-ids'] || []),
        pinnedThreadIds: new Set(state['pinned-thread-ids'] || []),
        threadWorkspacePaths,
        workspaces: roots.map((workspacePath, index) => {
            const orderedIndex = projectOrder.indexOf(workspacePath);
            return {
                id: `codex-workspace-${Buffer.from(workspacePath.toLowerCase()).toString('base64url')}`,
                name: path.basename(workspacePath),
                path: workspacePath,
                desktopOrder: orderedIndex >= 0 ? orderedIndex : projectOrder.length + index,
                isPinned: pinnedProjects.has(workspacePath)
            };
        })
    };
}

function getDesktopState() {
    try {
        const mtimeMs = fs.statSync(desktopStatePath).mtimeMs;
        if (desktopStateCache.data && desktopStateCache.mtimeMs === mtimeMs) return desktopStateCache.data;
        const data = normalizeDesktopState(JSON.parse(fs.readFileSync(desktopStatePath, 'utf8')));
        desktopStateCache = { mtimeMs, data };
        return data;
    } catch {
        return normalizeDesktopState();
    }
}

function modelFromRolloutText(text) {
    let desktopModel = '';
    let fallbackModel = '';
    for (const line of text.split(/\r?\n/)) {
        if (!line.includes('"type":"turn_context"')) continue;
        try {
            const entry = JSON.parse(line);
            const context = entry.type === 'turn_context' ? entry.payload : entry.payload?.type === 'turn_context' ? entry.payload : null;
            if (!context?.model) continue;
            fallbackModel = context.model;
            const developerInstructions = context.collaboration_mode?.settings?.developer_instructions;
            if (developerInstructions || context.approval_policy !== 'on-request') desktopModel = context.model;
        } catch {}
    }
    return desktopModel || fallbackModel || null;
}

function modelIdFromDesktopLabel(label) {
    const match = String(label || '').trim().match(/^(?:GPT[- ]?)?(5\.\d+(?:\.\d+)?)\s*(Sol|Terra|Luna|Mini)?\b/i);
    if (!match) return null;
    return `gpt-${match[1]}${match[2] ? `-${match[2].toLowerCase()}` : ''}`;
}

function desktopModelLabelFromId(modelId) {
    const match = String(modelId || '').match(/^gpt-(5\.\d+(?:\.\d+)?)(?:-(sol|terra|luna|mini))?$/i);
    if (!match) return null;
    return `${match[1]}${match[2] ? ` ${match[2][0].toUpperCase()}${match[2].slice(1).toLowerCase()}` : ''}`;
}

function getVisibleDesktopModel() {
    if (visibleDesktopModelCache.expiresAt > Date.now()) return visibleDesktopModelCache.model;
    if (process.platform !== 'win32') return null;
    const script = [
        'Add-Type -AssemblyName UIAutomationClient',
        "$process = Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
        'if (-not $process) { exit 0 }',
        '$root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)',
        '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
        'for ($i = 0; $i -lt $all.Count; $i++) {',
        '  $element = $all.Item($i)',
        "  if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $element.Current.Name -match '^(?:GPT[- ]?)?5\\.\\d+') { Write-Output $element.Current.Name; break }",
        '}'
    ].join('; ');
    try {
        const label = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim();
        const model = modelIdFromDesktopLabel(label);
        visibleDesktopModelCache = { expiresAt: Date.now() + 1000, model };
        return model;
    } catch {
        visibleDesktopModelCache = { expiresAt: Date.now() + 250, model: null };
        return null;
    }
}

function setVisibleDesktopModel(modelId) {
    const label = desktopModelLabelFromId(modelId);
    if (!label || process.platform !== 'win32') throw new Error('Desktop model selection is unavailable');
    const script = [
        'Add-Type -AssemblyName UIAutomationClient',
        "$process = Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
        'if (-not $process) { throw \'Codex Desktop is not running\' }',
        '$root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)',
        '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
        "$trigger = $null; for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $element.Current.Name -match '^(?:GPT[- ]?)?5\\.\\d+') { $trigger = $element; break } }",
        'if (-not $trigger) { throw \'Desktop model selector is unavailable\' }',
        '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
        "$modelMenu = $null; for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -and $element.Current.Name -match '^Model ') { $modelMenu = $element; break } }",
        "if (-not $modelMenu) { $trigger.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand(); Start-Sleep -Milliseconds 120; $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -and $element.Current.Name -match '^Model ') { $modelMenu = $element; break } } }",
        'if (-not $modelMenu) { throw \'Desktop model menu is unavailable\' }',
        '$modelPattern = $modelMenu.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern); if ($modelPattern.Current.ExpandCollapseState -eq [System.Windows.Automation.ExpandCollapseState]::Collapsed) { $modelPattern.Expand(); Start-Sleep -Milliseconds 120 }',
        '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)',
        `$target = '${label}'`,
        '$option = $null; for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::MenuItem -and $element.Current.Name -eq $target) { $option = $element; break } }',
        'if (-not $option) { throw "Desktop model option $target is unavailable" }',
        '$option.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 150; Write-Output $option.Current.Name'
    ].join('; ');
    try {
        execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 3000, windowsHide: true });
        visibleDesktopModelCache = { expiresAt: 0, model: null };
        return modelId;
    } catch (error) {
        throw new Error(error.stderr?.toString().trim() || `Desktop model selection failed for ${modelId}`);
    }
}

function logDesktopUiAttempt(entry) {
    try {
        fs.mkdirSync(path.dirname(desktopUiLogPath), { recursive: true });
        fs.appendFileSync(desktopUiLogPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`);
    } catch {}
}

function runDesktopUiScript(script, { timeout = 3000, operation = 'desktop-ui', attempts = 1 } = {}) {
    if (process.platform !== 'win32') throw new Error('Codex Desktop automation is unavailable');
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        const startedAt = Date.now();
        try {
            const output = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout, windowsHide: true }).trim();
            logDesktopUiAttempt({ operation, attempt, durationMs: Date.now() - startedAt, success: true });
            return output;
        } catch (error) {
            const message = error.stderr?.toString().trim() || error.stdout?.toString().trim() || 'Codex Desktop automation failed';
            lastError = new Error(message);
            logDesktopUiAttempt({ operation, attempt, durationMs: Date.now() - startedAt, success: false, error: message.slice(0, 500) });
            if (attempt < attempts) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * attempt);
        }
    }
    throw lastError;
}

const desktopUiSetup = [
    'Add-Type -AssemblyName UIAutomationClient',
    'Add-Type -AssemblyName System.Windows.Forms',
    "Add-Type @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public static class CodexDesktopInput {',
    '  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);',
    '  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);',
    '  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);',
    '}',
    "'@",
    "$process = Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1",
    "if (-not $process) { throw 'Codex Desktop is not running' }",
    '$root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)',
    '$all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)'
].join('\n');

function sendDesktopPrompt(prompt) {
    const encodedPrompt = Buffer.from(prompt, 'utf8').toString('base64');
    const script = [
        desktopUiSetup,
        "$active = $null; for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $element.Current.Name -match '\\b(stop|cancel|interrupt)\\b') { $active = $element; break } }",
        "if ($active) { throw 'Codex Desktop is already running a turn' }",
        "$modelButton = $null; for ($attempt = 0; $attempt -lt 10 -and -not $modelButton; $attempt++) { $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $element.Current.Name -match '^(?:GPT[- ]?)?5\\.\\d+') { $modelButton = $element; break } }; if (-not $modelButton) { Start-Sleep -Milliseconds 100 } }",
        "if (-not $modelButton) { throw 'Codex Desktop composer is unavailable' }",
        '$rect = $modelButton.Current.BoundingRectangle',
        '[CodexDesktopInput]::SetForegroundWindow($process.MainWindowHandle) | Out-Null',
        '[CodexDesktopInput]::SetCursorPos([int]($rect.Left - 160), [int]($rect.Top - 34)) | Out-Null',
        '[CodexDesktopInput]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero); [CodexDesktopInput]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero)',
        'Start-Sleep -Milliseconds 150',
        `$text = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encodedPrompt}'))`,
        '$clipboardText = Get-Clipboard -Raw -ErrorAction SilentlyContinue',
        'try {',
        '  [System.Windows.Forms.SendKeys]::SendWait("^a"); [System.Windows.Forms.SendKeys]::SendWait("{BACKSPACE}")',
        '  Set-Clipboard -Value $text',
        '  [System.Windows.Forms.SendKeys]::SendWait("^v")',
        '  Start-Sleep -Milliseconds 200',
        '  $send = $null; $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition); for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); $buttonRect = $element.Current.BoundingRectangle; if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and -not $element.Current.Name -and $element.Current.IsEnabled -and $buttonRect.Left -gt $rect.Right -and [Math]::Abs($buttonRect.Top - $rect.Top) -le 5 -and $buttonRect.Width -ge 30 -and $buttonRect.Width -le 40) { $send = $element; break } }',
        "  if (-not $send) { [System.Windows.Forms.SendKeys]::SendWait('^a'); [System.Windows.Forms.SendKeys]::SendWait('{BACKSPACE}'); throw 'Codex Desktop did not accept prompt text' }",
        '  $sendRect = $send.Current.BoundingRectangle; [CodexDesktopInput]::SetCursorPos([int]($sendRect.Left + ($sendRect.Width / 2)), [int]($sendRect.Top + ($sendRect.Height / 2))) | Out-Null; [CodexDesktopInput]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero); [CodexDesktopInput]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero)',
        '} finally { if ($null -ne $clipboardText) { Set-Clipboard -Value $clipboardText } }',
        '$textCondition = New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)), (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $text)))',
        '$stopCondition = New-Object System.Windows.Automation.AndCondition((New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)), (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Stop")))',
        '$started = $false; for ($attempt = 0; $attempt -lt 20 -and -not $started; $attempt++) { Start-Sleep -Milliseconds 100; $started = $null -ne $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $textCondition) -or $null -ne $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $stopCondition) }',
        "if (-not $started) { throw 'Codex Desktop did not start prompt' }",
        "Write-Output 'submitted'"
    ].join('\n');
    const result = runDesktopUiScript(script, { timeout: 7000, operation: 'send-prompt' });
    if (result !== 'submitted') throw new Error('Codex Desktop did not submit prompt');
    return { accepted: true };
}

function getDesktopTurnActive() {
    const script = [
        desktopUiSetup,
        "for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $element.Current.Name -match '\\b(stop|cancel|interrupt)\\b') { Write-Output 'active'; exit 0 } }",
        "Write-Output 'idle'"
    ].join('\n');
    return runDesktopUiScript(script, { operation: 'read-activity', attempts: 2 }) === 'active';
}

function stopDesktopTurn() {
    const script = [
        desktopUiSetup,
        "$stop = $null; for ($i = 0; $i -lt $all.Count; $i++) { $element = $all.Item($i); if ($element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $element.Current.Name -match '\\b(stop|cancel|interrupt)\\b') { $stop = $element; break } }",
        "if (-not $stop) { throw 'Codex Desktop is not running a turn' }",
        '$stop.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()',
        "Write-Output 'stopped'"
    ].join('\n');
    if (runDesktopUiScript(script, { operation: 'stop-turn' }) !== 'stopped') throw new Error('Codex Desktop did not stop turn');
    return { stopped: true };
}

function getDesktopThreadTarget(threadId) {
    if (!fs.existsSync(stateDatabasePath)) return null;
    let database;
    try {
        database = new Database(stateDatabasePath, { readonly: true, fileMustExist: true });
        return database.prepare('SELECT title, cwd FROM threads WHERE id = ?').get(threadId) || null;
    } catch {
        return null;
    } finally {
        database?.close();
    }
}

function getDesktopThreadTitle(threadId) {
    return getDesktopThreadTarget(threadId)?.title || null;
}

async function resolveDesktopThreadTarget(threadId) {
    try {
        const result = await request('thread/read', { threadId, includeTurns: false });
        const thread = result.thread;
        const desktopState = getDesktopState();
        return {
            title: thread.name || thread.preview || getDesktopThreadTitle(threadId),
            cwd: desktopState.threadWorkspacePaths?.get(threadId) || thread.cwd || null
        };
    } catch {
        return getDesktopThreadTarget(threadId);
    }
}

async function openDesktopThread(threadId) {
    const target = await resolveDesktopThreadTarget(threadId);
    if (!target?.title) throw new Error('Codex Desktop task is unavailable');
    const projectName = target.cwd ? path.basename(target.cwd) : '';
    const script = [
        desktopUiSetup,
        `$target = '${target.title.replace(/'/g, "''")}'`,
        `$projectName = '${projectName.replace(/'/g, "''")}'`,
        '$textType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)',
        '$listItemType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::ListItem)',
        '$buttonType = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)',
        '$targetName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $target)',
        '$taskCondition = New-Object System.Windows.Automation.AndCondition($listItemType, $targetName)',
        '$headerCondition = New-Object System.Windows.Automation.AndCondition($textType, $targetName)',
        'function Find-TargetHeader { $matches = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $headerCondition); for ($index = 0; $index -lt $matches.Count; $index++) { $candidate = $matches.Item($index); $candidateRect = $candidate.Current.BoundingRectangle; if ($candidateRect.Left -gt 300 -and $candidateRect.Top -ge 40 -and $candidateRect.Top -le 90) { return $candidate } }; return $null }',
        '$current = Find-TargetHeader',
        "if ($current) { Write-Output 'opened'; exit 0 }",
        '$project = $null; if ($projectName) { $projectNameCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $projectName); $projectCondition = New-Object System.Windows.Automation.AndCondition($listItemType, $projectNameCondition); $project = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $projectCondition) }',
        '$task = if ($project) { $project.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $taskCondition) } else { $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $taskCondition) }',
        '$task = if ($task) { $task } else { $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $taskCondition) }',
        'if (-not $task -and $project) { $rect = $project.Current.BoundingRectangle; if ($rect.Height -le 45) { $projectButtonName = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $projectName); $projectButton = $project.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.AndCondition($buttonType, $projectButtonName))); if (-not $projectButton) { throw "Codex Desktop project control is unavailable" }; $projectButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke(); Start-Sleep -Milliseconds 300; $project = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $projectCondition); if ($project) { $task = $project.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $taskCondition) } } }',
        "if (-not $task) { throw 'Codex Desktop task is not visible' }",
        '$task.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView(); Start-Sleep -Milliseconds 120',
        '$taskRect = $task.Current.BoundingRectangle',
        '[CodexDesktopInput]::SetForegroundWindow($process.MainWindowHandle) | Out-Null',
        '[CodexDesktopInput]::SetCursorPos([int]($taskRect.Left + 100), [int]($taskRect.Top + ($taskRect.Height / 2))) | Out-Null',
        'Start-Sleep -Milliseconds 50',
        '[CodexDesktopInput]::mouse_event(0x2, 0, 0, 0, [UIntPtr]::Zero); [CodexDesktopInput]::mouse_event(0x4, 0, 0, 0, [UIntPtr]::Zero)',
        '$confirmed = $false; for ($attempt = 0; $attempt -lt 20 -and -not $confirmed; $attempt++) { Start-Sleep -Milliseconds 100; $confirmed = $null -ne (Find-TargetHeader) }',
        "if (-not $confirmed) { throw 'Codex Desktop task selection was not confirmed' }",
        "Write-Output 'opened'"
    ].join('\n');
    if (runDesktopUiScript(script, { timeout: 3500, operation: 'open-task' }) !== 'opened') throw new Error('Codex Desktop did not open task');
    return { opened: true, id: threadId };
}

function getDesktopThreadModel(threadId) {
    const visibleModel = getVisibleDesktopModel();
    if (visibleModel) return visibleModel;
    if (!fs.existsSync(stateDatabasePath)) return null;
    let database;
    try {
        database = new Database(stateDatabasePath, { readonly: true, fileMustExist: true });
        const row = database.prepare('SELECT rollout_path FROM threads WHERE id = ?').get(threadId);
        if (!row?.rollout_path || !fs.existsSync(row.rollout_path)) return null;
        const mtimeMs = fs.statSync(row.rollout_path).mtimeMs;
        const cached = desktopModelCache.get(threadId);
        if (cached?.mtimeMs === mtimeMs) return cached.model;
        const model = modelFromRolloutText(fs.readFileSync(row.rollout_path, 'utf8'));
        desktopModelCache.set(threadId, { mtimeMs, model });
        return model;
    } catch {
        return null;
    } finally {
        database?.close();
    }
}

function updatePinnedThreadIds(raw, threadId, pinned) {
    const persistedState = raw['electron-persisted-atom-state'] || {};
    const pinnedThreadIds = new Set(raw['pinned-thread-ids'] || persistedState['pinned-thread-ids'] || []);
    if (pinned) pinnedThreadIds.add(threadId);
    else pinnedThreadIds.delete(threadId);
    const nextPinnedThreadIds = [...pinnedThreadIds];
    return {
        ...raw,
        'pinned-thread-ids': nextPinnedThreadIds,
        ...(raw['electron-persisted-atom-state'] ? {
            'electron-persisted-atom-state': {
                ...persistedState,
                'pinned-thread-ids': nextPinnedThreadIds
            }
        } : {})
    };
}

function updatePinnedProjectIds(raw, workspacePath, pinned) {
    const persistedState = raw['electron-persisted-atom-state'] || {};
    const pinnedProjectIds = new Set(raw['pinned-project-ids'] || persistedState['pinned-project-ids'] || []);
    if (pinned) pinnedProjectIds.add(workspacePath);
    else pinnedProjectIds.delete(workspacePath);
    const nextPinnedProjectIds = [...pinnedProjectIds];
    return {
        ...raw,
        'pinned-project-ids': nextPinnedProjectIds,
        ...(raw['electron-persisted-atom-state'] ? {
            'electron-persisted-atom-state': {
                ...persistedState,
                'pinned-project-ids': nextPinnedProjectIds
            }
        } : {})
    };
}

function setThreadPinned(threadId, pinned) {
    const raw = JSON.parse(fs.readFileSync(desktopStatePath, 'utf8'));
    const next = updatePinnedThreadIds(raw, threadId, pinned);
    const temporaryPath = `${desktopStatePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(next), 'utf8');
        fs.renameSync(temporaryPath, desktopStatePath);
    } finally {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
    desktopStateCache = { mtimeMs: -1, data: null };
    return { id: threadId, isPinned: getDesktopState().pinnedThreadIds.has(threadId) };
}

function setWorkspacePinned(workspacePath, pinned) {
    const raw = JSON.parse(fs.readFileSync(desktopStatePath, 'utf8'));
    const next = updatePinnedProjectIds(raw, workspacePath, pinned);
    const temporaryPath = `${desktopStatePath}.${process.pid}.${Date.now()}.tmp`;
    try {
        fs.writeFileSync(temporaryPath, JSON.stringify(next), 'utf8');
        fs.renameSync(temporaryPath, desktopStatePath);
    } finally {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    }
    desktopStateCache = { mtimeMs: -1, data: null };
    return { path: workspacePath, isPinned: getDesktopState().workspaces.some(workspace => workspace.path === workspacePath && workspace.isPinned) };
}

function parseTomlString(value) {
    if (!value) return '';
    try { return JSON.parse(value); } catch { return value.replace(/^['"]|['"]$/g, ''); }
}

function parseAutomationToml(text) {
    const valueFor = key => text.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, 'm'))?.[1]?.trim() || '';
    const targetValue = valueFor('target');
    const target = targetValue.match(/type\s*=\s*["']([^"']+)["']/)?.[1] || 'projectless';
    const targetProject = targetValue.match(/project_id\s*=\s*["']([^"']+)["']/)?.[1] || '';
    return {
        id: parseTomlString(valueFor('id')),
        name: parseTomlString(valueFor('name')),
        kind: parseTomlString(valueFor('kind')),
        prompt: parseTomlString(valueFor('prompt')),
        status: parseTomlString(valueFor('status')),
        rrule: parseTomlString(valueFor('rrule')),
        model: parseTomlString(valueFor('model')),
        executionEnvironment: parseTomlString(valueFor('execution_environment')),
        target,
        targetProject
    };
}

function formatAutomationSchedule(rrule) {
    if (!rrule) return 'Schedule unavailable';
    const fields = Object.fromEntries(rrule.replace(/^RRULE:/i, '').split(';').map(part => part.split('=')));
    const frequency = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', HOURLY: 'Hourly' }[fields.FREQ] || fields.FREQ || 'Recurring';
    const hour = fields.BYHOUR ? `${String(fields.BYHOUR).padStart(2, '0')}:${String(fields.BYMINUTE || '0').padStart(2, '0')}` : '';
    const days = fields.BYDAY?.split(',').map(day => ({ MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' }[day] || day)).join(', ');
    return [frequency, days, hour].filter(Boolean).join(' · ');
}

function automationRuns(id, limit = 20) {
    if (!fs.existsSync(stateDatabasePath)) return [];
    let database;
    try {
        database = new Database(stateDatabasePath, { readonly: true, fileMustExist: true });
        const rows = database.prepare(`
            SELECT title, cwd, created_at_ms, updated_at_ms
            FROM threads
            WHERE thread_source = 'automation' AND title LIKE ?
            ORDER BY COALESCE(updated_at_ms, created_at_ms) DESC
            LIMIT ?
        `).all(`%Automation ID: ${id}%`, limit);
        return rows.map(row => {
            const title = row.title.match(/^Automation:\s*([^\r\n]+)/)?.[1] || id;
            return {
                title,
                triggeredAt: new Date(row.updated_at_ms || row.created_at_ms).toISOString(),
                workspace: path.basename(String(row.cwd || '').replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '')) || 'global'
            };
        });
    } catch {
        return [];
    } finally {
        database?.close();
    }
}

function normalizeAutomation(automation) {
    const events = automation.events || automationRuns(automation.id);
    return {
        id: automation.id,
        name: automation.name || automation.id,
        provider: 'codex',
        prompt: automation.prompt || '',
        schedule: formatAutomationSchedule(automation.rrule),
        rrule: automation.rrule || '',
        enabled: automation.status === 'ACTIVE',
        status: automation.status || 'UNKNOWN',
        model: automation.model || null,
        workspace: automation.workspace || (automation.targetProject ? path.basename(automation.targetProject) : automation.target === 'projectless' ? 'global' : automation.target),
        events
    };
}

function automationFile(id) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Codex automation is unavailable');
    const directory = path.join(automationsPath, id);
    const file = path.join(directory, 'automation.toml');
    if (path.dirname(file) !== directory || !fs.existsSync(file)) throw new Error('Codex automation is unavailable');
    return file;
}

function listAutomations() {
    const automations = fs.existsSync(automationsPath) ? fs.readdirSync(automationsPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => {
            try { return normalizeAutomation(parseAutomationToml(fs.readFileSync(automationFile(entry.name), 'utf8'))); }
            catch { return null; }
        })
        .filter(Boolean) : [];
    const knownIds = new Set(automations.map(automation => automation.id));
    for (const run of automationRunIds()) {
        if (knownIds.has(run.id)) continue;
        automations.push(normalizeAutomation({
            id: run.id,
            name: run.name,
            status: 'ACTIVE',
            rrule: /daily/i.test(run.id) ? 'RRULE:FREQ=DAILY' : '',
            workspace: run.workspace,
            events: automationRuns(run.id)
        }));
    }
    return automations;
}

function automationRunIds() {
    if (!fs.existsSync(stateDatabasePath)) return [];
    let database;
    try {
        database = new Database(stateDatabasePath, { readonly: true, fileMustExist: true });
        const rows = database.prepare("SELECT title, cwd FROM threads WHERE thread_source = 'automation' AND title LIKE '%Automation ID:%' GROUP BY title, cwd").all();
        const ids = new Map();
        for (const row of rows) {
            const id = row.title.match(/Automation ID:\s*([^\r\n]+)/)?.[1];
            if (id && !ids.has(id)) ids.set(id, { id, name: row.title.match(/^Automation:\s*([^\r\n]+)/)?.[1] || id, workspace: path.basename(String(row.cwd || '').replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '')) || 'global' });
        }
        return [...ids.values()];
    } catch {
        return [];
    } finally {
        database?.close();
    }
}

function getAutomation(id) {
    return normalizeAutomation(parseAutomationToml(fs.readFileSync(automationFile(id), 'utf8')));
}

function setAutomationEnabled(id, enabled) {
    const file = automationFile(id);
    const current = fs.readFileSync(file, 'utf8');
    const nextStatus = enabled ? 'ACTIVE' : 'PAUSED';
    const next = /^status\s*=.*$/m.test(current)
        ? current.replace(/^status\s*=.*$/m, `status = "${nextStatus}"`)
        : `${current.trimEnd()}\nstatus = "${nextStatus}"\n`;
    fs.writeFileSync(file, next, 'utf8');
    return getAutomation(id);
}

function commandInvocation(value = command) {
    const useNode = value.endsWith('.js');
    return {
        executable: useNode ? process.execPath : value,
        args: useNode ? [value, 'app-server', '--listen', 'stdio://'] : ['app-server', '--listen', 'stdio://']
    };
}

function reset(error) {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    child = undefined;
    started = undefined;
}

function handleMessage(message) {
    if (message.id !== undefined && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) request.reject(new Error(message.error.message || 'Codex App Server request failed'));
        else request.resolve(message.result);
        return;
    }

    if (message.method && message.id !== undefined) {
        // Mobile UI cannot safely approve host commands yet. Reject requests rather
        // than leaving Codex turns blocked indefinitely.
        send({ id: message.id, result: { decision: 'decline' } });
        return;
    }

    if (message.method === 'turn/started' && message.params?.threadId && message.params?.turn?.id) activeTurns.set(message.params.threadId, message.params.turn.id);
    if (message.method === 'turn/completed' && message.params?.threadId) activeTurns.delete(message.params.threadId);
    if (message.method) events.emit('notification', message);
}

function send(message) {
    if (!child?.stdin?.writable) throw new Error('Codex App Server is unavailable');
    child.stdin.write(`${JSON.stringify(message)}\n`);
}

function call(method, params = {}) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try { send({ id, method, params }); }
        catch (error) { pending.delete(id); reject(error); }
    });
}

async function start() {
    if (started) return started;

    started = new Promise((resolve, reject) => {
        const { executable, args } = commandInvocation();
        child = spawn(executable, args, {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true
        });

        child.once('error', error => {
            reset(error);
            reject(new Error(`Codex App Server failed to start: ${error.message}`));
        });
        child.once('exit', (code, signal) => reset(new Error(`Codex App Server stopped (${signal || code || 'unknown'})`)));
        child.stdout.on('data', chunk => {
            buffer += chunk.toString('utf8');
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline).trim();
                buffer = buffer.slice(newline + 1);
                if (!line) continue;
                try { handleMessage(JSON.parse(line)); } catch {}
            }
        });

        call('initialize', {
            clientInfo: { name: 'antigravity_remote', title: 'Antigravity Remote', version: '1.0.0' }
        }).then(() => {
            send({ method: 'initialized', params: {} });
            resolve();
        }).catch(error => {
            reset(error);
            reject(error);
        });
    });

    try { await started; }
    catch (error) { started = undefined; throw error; }
}

async function request(method, params) {
    await start();
    return call(method, params);
}

function normalizeThread(thread, desktopState = {}) {
    const assignedWorkspacePath = desktopState.threadWorkspacePaths?.get(thread.id);
    return {
        id: thread.id,
        provider: 'codex',
        title: thread.name || thread.preview || 'Untitled Thread',
        workspacePath: assignedWorkspacePath || thread.cwd || null,
        lastUpdated: thread.updatedAt ? new Date(thread.updatedAt * 1000).toISOString() : null,
        status: thread.status?.type || 'notLoaded',
        model: thread.model || null,
        messageCount: thread.turns?.length || 0,
        isTurnActive: thread.status?.type === 'active',
        activeTurnId: activeTurns.get(thread.id) || thread.turns?.find(turn => turn.status === 'inProgress')?.id || null,
        isProjectless: !assignedWorkspacePath && (desktopState.projectlessThreadIds?.has(thread.id) || false),
        isPinned: desktopState.pinnedThreadIds?.has(thread.id) || false
    };
}

function normalizeContent(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return content == null ? '' : String(content);
    return content.map(part => {
        if (typeof part === 'string') return part;
        if (part?.type === 'localImage') return part.path ? `Attached image: ${part.path}` : 'Attached image';
        return part?.text || part?.content || '';
    }).filter(Boolean).join('\n');
}

function normalizeMessages(thread) {
    return (thread.turns || []).flatMap(turn => (turn.items || []).flatMap(item => {
        if (item.type === 'userMessage') return [{ id: item.id, role: 'user', content: normalizeContent(item.content), created_at: item.createdAt }];
        if (item.type === 'agentMessage') return [{ id: item.id, role: 'ai', content: normalizeContent(item.text || item.content), created_at: item.createdAt }];
        if (item.type === 'commandExecution') return [{ id: item.id, role: 'event', title: item.command || 'Ran command', detail: item.aggregatedOutput || '', created_at: item.createdAt }];
        return [];
    }));
}

async function listThreads({ limit = 500, cwd, searchTerm } = {}) {
    const result = await request('thread/list', { limit, sortKey: 'updated_at', cwd, searchTerm });
    const desktopState = getDesktopState();
    return (result.data || []).map(thread => normalizeThread(thread, desktopState));
}

function listWorkspaces() {
    return getDesktopState().workspaces;
}

async function readThread(id) {
    const result = await request('thread/read', { threadId: id, includeTurns: true });
    const thread = result.thread;
    const messages = normalizeMessages(thread);
    const normalizedThread = normalizeThread(thread, getDesktopState());
    normalizedThread.model = getDesktopThreadModel(id) || normalizedThread.model;
    return { thread: normalizedThread, messages };
}

async function listModels() {
    const result = await request('model/list', { limit: 100, includeHidden: false });
    return (result.data || []).map(model => ({ id: model.id || model.model, name: model.displayName || model.model || model.id, isDefault: model.isDefault }));
}

async function startThread({ cwd, model } = {}) {
    const result = await request('thread/start', { cwd: cwd || null, model: model || null, approvalPolicy: 'on-request' });
    return normalizeThread(result.thread);
}

async function sendPrompt(id, { prompt, cwd, model } = {}) {
    const selectedModel = getDesktopThreadModel(id) || model || null;
    await request('thread/resume', { threadId: id, cwd: cwd || null, model: selectedModel, approvalPolicy: 'on-request' });
    const result = await request('turn/start', {
        threadId: id,
        cwd: cwd || null,
        model: selectedModel,
        input: [{ type: 'text', text: prompt }]
    });
    if (result?.turn?.id) activeTurns.set(id, result.turn.id);
    return result;
}

async function steerPrompt(id, prompt) {
    const thread = await request('thread/read', { threadId: id, includeTurns: true });
    const expectedTurnId = activeTurns.get(id) || thread.thread?.turns?.find(turn => turn.status === 'inProgress')?.id;
    if (!expectedTurnId) throw new Error('No active Codex turn to steer');
    return request('turn/steer', {
        threadId: id,
        expectedTurnId,
        input: [{ type: 'text', text: prompt }]
    });
}

async function archiveThread(id) {
    await request('thread/archive', { threadId: id });
}

module.exports = { archiveThread, commandInvocation, desktopModelLabelFromId, events, formatAutomationSchedule, getAutomation, getDesktopThreadModel, getDesktopTurnActive, getDesktopThreadTitle, getVisibleDesktopModel, listAutomations, listModels, listThreads, listWorkspaces, modelFromRolloutText, modelIdFromDesktopLabel, normalizeAutomation, normalizeContent, normalizeDesktopState, normalizeMessages, normalizeThread, openDesktopThread, parseAutomationToml, readThread, sendDesktopPrompt, sendPrompt, setAutomationEnabled, setThreadPinned, setVisibleDesktopModel, setWorkspacePinned, startThread, steerPrompt, stopDesktopTurn, updatePinnedProjectIds, updatePinnedThreadIds };
