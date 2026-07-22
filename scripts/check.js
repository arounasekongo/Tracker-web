const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const required = ['server.js', 'public/index.html', 'public/client.js', 'public/admin.html', 'public/admin.js', 'database/init.sql'];

for (const relativePath of required) {
    if (!fs.existsSync(path.join(root, relativePath))) throw new Error(`Fichier requis absent: ${relativePath}`);
}

function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(fullPath);
        else if (entry.name.endsWith('.js')) execFileSync(process.execPath, ['--check', fullPath], { stdio: 'inherit' });
    }
}

visit(root);
console.log('Structure et syntaxe JavaScript valides.');
