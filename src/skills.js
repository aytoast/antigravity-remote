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
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .flatMap(entry => {
            const skillPath = path.join(root, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillPath)) return [];
            try {
                const frontmatter = parseFrontmatter(fs.readFileSync(skillPath, 'utf8'));
                return [{
                    name: frontmatter.name || entry.name,
                    description: frontmatter.description || 'Run this skill',
                    scope,
                    slug: entry.name
                }];
            } catch {
                return [];
            }
        });
};

const getSkills = () => {
    const roots = [
        [path.join(process.cwd(), '.agents', 'skills'), 'local'],
        [path.join(process.cwd(), '.codex', 'skills'), 'local'],
        [path.join(os.homedir(), '.codex', 'skills'), 'global']
    ];
    const seen = new Set();
    return roots.flatMap(([root, scope]) => listSkillRoot(root, scope)).filter(skill => {
        if (seen.has(skill.slug)) return false;
        seen.add(skill.slug);
        return true;
    });
};

module.exports = { getSkills };
