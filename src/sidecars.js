const fs = require('fs');
const path = require('path');
const { getWorkspaces } = require('./parser');

const SIDECARS_DIR = path.join(process.env.USERPROFILE || process.env.HOME, '.gemini', 'config', 'sidecars');

function formatSchedule(cron) {
    const match = cron.match(/^0\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
    if (!match) return cron;
    const hour = Number(match[1]);
    const displayHour = hour % 12 || 12;
    return `Daily around ${displayHour}:00 ${hour < 12 ? 'AM' : 'PM'}`;
}

function getSidecarWorkspace(prompt) {
    const normalizedPrompt = prompt.toLowerCase().replace(/\\/g, '/');
    return getWorkspaces().find(workspace => normalizedPrompt.includes(workspace.path.toLowerCase().replace(/\\/g, '/')))?.name || '';
}

function readSidecar(directory) {
    try {
        const config = JSON.parse(fs.readFileSync(path.join(SIDECARS_DIR, directory, 'sidecar.json'), 'utf8'));
        if (config.builtin !== 'schedule' || !Array.isArray(config.args)) return null;
        const cron = String(config.args[0] || '');
        const prompt = String(config.args[3] || '');
        return {
            name: config.displayName || directory,
            cron,
            schedule: formatSchedule(cron),
            prompt,
            workspace: getSidecarWorkspace(prompt)
        };
    } catch {
        return null;
    }
}

function getScheduledSidecars() {
    try {
        return fs.readdirSync(SIDECARS_DIR, { withFileTypes: true })
            .filter(entry => entry.isDirectory())
            .map(entry => readSidecar(entry.name))
            .filter(Boolean);
    } catch {
        return [];
    }
}

function getScheduledSidecar(name) {
    return getScheduledSidecars().find(sidecar => sidecar.name === name) || null;
}

module.exports = { getScheduledSidecars, getScheduledSidecar };
