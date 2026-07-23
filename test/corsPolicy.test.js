const test = require('node:test');
const assert = require('node:assert/strict');
const { createOriginPolicy, parseOrigins } = require('../middleware/corsPolicy');

function evaluate(policy, origin) {
    return new Promise((resolve) => {
        policy(origin, (error, allowed) => resolve({ error, allowed }));
    });
}

test('autorise les origines locales implicites uniquement hors production', async () => {
    assert.ok(parseOrigins(undefined, false).includes('http://localhost:3000'));
    assert.equal(parseOrigins(undefined, true).length, 0);

    const development = await evaluate(
        createOriginPolicy({ configuredOrigins: undefined, isProduction: false }),
        'http://localhost:3000'
    );
    assert.equal(development.allowed, true);

    const production = await evaluate(
        createOriginPolicy({ configuredOrigins: undefined, isProduction: true }),
        'http://localhost:3000'
    );
    assert.equal(production.allowed, false);
    assert.equal(production.error, null);
});

test('respecte strictement la liste CORS explicite en production', async () => {
    const policy = createOriginPolicy({
        configuredOrigins: 'https://app.example, https://admin.example',
        isProduction: true
    });

    assert.equal((await evaluate(policy, undefined)).allowed, true);
    assert.equal((await evaluate(policy, 'https://app.example')).allowed, true);
    assert.match((await evaluate(policy, 'https://evil.example')).error.message, /non autorisee/);
});
