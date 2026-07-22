const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ImageProcessor = require('../utils/imageProcessor');

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('valide uniquement les images base64 prises en charge', () => {
    assert.equal(ImageProcessor.validateBase64(png), true);
    assert.equal(ImageProcessor.validateBase64('data:text/plain;base64,SGVsbG8='), false);
    assert.equal(ImageProcessor.validateBase64('data:image/png;base64,***'), false);
});

test('accepte une limite de taille lisible dans la configuration', () => {
    const previous = process.env.MAX_PHOTO_SIZE;
    process.env.MAX_PHOTO_SIZE = '5MB';
    assert.equal(ImageProcessor.validateBase64(png), true);
    if (previous === undefined) delete process.env.MAX_PHOTO_SIZE;
    else process.env.MAX_PHOTO_SIZE = previous;
});

test('compresse, sauvegarde et supprime une photo', async () => {
    const processed = await ImageProcessor.processImage(png);
    assert.match(processed.base64, /^data:image\/jpeg;base64,/);
    assert.ok(processed.size > 0);
    const saved = await ImageProcessor.saveToDisk(processed.base64);
    const absolutePath = path.join(__dirname, '..', saved.relativePath.replace(/^\//, ''));
    assert.equal(fs.existsSync(absolutePath), true);
    assert.equal(await ImageProcessor.deleteFromDisk(saved.relativePath), true);
    assert.equal(fs.existsSync(absolutePath), false);
});
