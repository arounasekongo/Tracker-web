'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const qualityDirectory = path.join(root, '.quality');
const statusFile = path.join(qualityDirectory, 'last-run.json');
const logFile = path.join(qualityDirectory, 'last-run.log');
const startedAt = new Date();
const log = [`Controle qualite demarre le ${startedAt.toISOString()}`];

function runNode(argumentsList) {
    const result = spawnSync(process.execPath, argumentsList, {
        cwd: root,
        encoding: 'utf8',
        timeout: 180000,
        windowsHide: true,
        env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' }
    });
    if (result.stdout) log.push(result.stdout.trim());
    if (result.stderr) log.push(result.stderr.trim());
    if (result.error) log.push(result.error.message);
    return Number.isInteger(result.status) ? result.status : 1;
}

function checkHealth() {
    return new Promise((resolve) => {
        const request = http.get('http://127.0.0.1:3000/health', { timeout: 5000 }, (response) => {
            let body = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => { body += chunk; });
            response.on('end', () => {
                try {
                    const data = JSON.parse(body);
                    resolve({ health: data.status || 'invalid', persistent: data.persistent === true });
                } catch (error) {
                    resolve({ health: 'invalid', persistent: false });
                }
            });
        });
        request.on('timeout', () => request.destroy(new Error('health timeout')));
        request.on('error', (error) => {
            log.push(`Serveur local indisponible : ${error.message}`);
            resolve({ health: 'unavailable', persistent: false });
        });
    });
}

async function main() {
    fs.mkdirSync(qualityDirectory, { recursive: true });
    const syntaxExitCode = runNode(['scripts/check.js']);
    const testsExitCode = runNode(['--test']);
    const server = await checkHealth();
    const finishedAt = new Date();
    const success = syntaxExitCode === 0 && testsExitCode === 0 &&
        server.health === 'ok' && server.persistent;
    const result = {
        success,
        started_at: startedAt.toISOString(),
        finished_at: finishedAt.toISOString(),
        duration_seconds: Number(((finishedAt - startedAt) / 1000).toFixed(2)),
        syntax_exit_code: syntaxExitCode,
        tests_exit_code: testsExitCode,
        server_health: server.health,
        persistent_storage: server.persistent
    };

    log.push(`Resultat : success=${success}, syntax=${syntaxExitCode}, tests=${testsExitCode}, health=${server.health}, persistent=${server.persistent}`);
    fs.writeFileSync(logFile, `${log.join('\n')}\n`, 'utf8');
    fs.writeFileSync(statusFile, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(result, null, 2));
    if (!success) process.exitCode = 1;
}

main().catch((error) => {
    fs.mkdirSync(qualityDirectory, { recursive: true });
    fs.writeFileSync(logFile, `${log.join('\n')}\nErreur fatale : ${error.stack || error.message}\n`, 'utf8');
    console.error(error);
    process.exitCode = 1;
});
