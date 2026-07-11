const fs = require('fs');
const os = require('os');
const path = require('path');

const parseFrontmatter = (content) => {
    const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    return Object.fromEntries(match[1].split(/\r?\n/).flatMap(line => {
        const separator = line.indexOf(':');
        if (separator < 0) return [];
        return [[line.slice(0, separator).trim(), line.slice(separator + 1).trim()]];
    }));
};

const listSkillRoot = (root, scope) => {
    if (!fs.existsSync(root)) return [];
    const skillFiles = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const entryPath = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(entryPath);
            else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') skillFiles.push(entryPath);
        }
    };
    visit(root);
    return skillFiles.flatMap(skillPath => {
        try {
            const frontmatter = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
            const fallback = path.basename(path.dirname(skillPath));
            return [{
                name: frontmatter.name || fallback,
                description: frontmatter.description || 'Run this skill',
                scope,
                slug: frontmatter.name || fallback
            }];
        } catch {
            return [];
        }
    });
};

const getSkills = () => {
    const roots = [
        [path.join(process.cwd(), '.agents', 'skills'), 'local'],
        [path.join(os.homedir(), '.gemini', 'config', 'plugins'), 'global']
    ];
    const seen = new Set();
    return roots.flatMap(([root, scope]) => listSkillRoot(root, scope)).filter(skill => {
        const key = skill.name.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

module.exports = { getSkills };
