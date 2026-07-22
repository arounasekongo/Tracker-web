const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const uploadsRoot = path.resolve(__dirname, '..', 'uploads');

function configuredMaxSize() {
    const raw = String(process.env.MAX_PHOTO_SIZE || 5 * 1024 * 1024).trim();
    const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB)?$/i.exec(raw);
    if (!match) return 5 * 1024 * 1024;
    const multipliers = { B: 1, KB: 1024, MB: 1024 * 1024 };
    return Math.floor(Number(match[1]) * multipliers[(match[2] || 'B').toUpperCase()]);
}

class ImageProcessor {
    static diskPath(relativePath) {
        if (!relativePath) return null;
        const target = path.resolve(uploadsRoot, path.basename(relativePath));
        return path.dirname(target) === uploadsRoot ? target : null;
    }

    static decode(base64Image) {
        const match = /^data:image\/(jpeg|jpg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(base64Image || '');
        if (!match) return null;
        const buffer = Buffer.from(match[2], 'base64');
        if (!buffer.length) return null;
        return buffer;
    }

    static validateBase64(base64Image) {
        const buffer = this.decode(base64Image);
        const maxSize = configuredMaxSize();
        return Boolean(buffer && buffer.length <= maxSize);
    }

    static async processImage(base64Image, options = {}) {
        try {
            const buffer = this.decode(base64Image);
            if (!buffer) throw new Error('Photo invalide');
            const metadata = await sharp(buffer).metadata();
            if (!['jpeg', 'png'].includes(metadata.format) || !metadata.width || !metadata.height) {
                throw new Error('Format de photo non pris en charge');
            }
            const maxWidth = Number(options.maxWidth || 800);
            const maxHeight = Number(options.maxHeight || 800);
            const processedBuffer = await sharp(buffer)
                .rotate()
                .resize(maxWidth, maxHeight, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: Number(options.quality || 80), mozjpeg: true })
                .toBuffer();
            return {
                base64: `data:image/jpeg;base64,${processedBuffer.toString('base64')}`,
                buffer: processedBuffer,
                size: processedBuffer.length
            };
        } catch (error) {
            const wrapped = new Error(error.message || 'Impossible de traiter la photo');
            wrapped.code = 'INVALID_IMAGE';
            throw wrapped;
        }
    }

    static async saveToDisk(base64Image) {
        const buffer = this.decode(base64Image);
        if (!buffer) throw new Error('Photo invalide');
        await fs.mkdir(uploadsRoot, { recursive: true });
        const filename = `${crypto.randomUUID()}.jpg`;
        const filePath = path.join(uploadsRoot, filename);
        await fs.writeFile(filePath, buffer, { flag: 'wx' });
        return { path: filePath, filename, relativePath: `/uploads/${filename}` };
    }

    static async deleteFromDisk(relativePath) {
        if (!relativePath) return false;
        const target = this.diskPath(relativePath);
        if (!target) return false;
        try {
            await fs.unlink(target);
            return true;
        } catch (error) {
            if (error.code !== 'ENOENT') console.error('Erreur suppression photo:', error.message);
            return error.code === 'ENOENT';
        }
    }

    static async readFromDisk(relativePath) {
        const target = this.diskPath(relativePath);
        if (!target) return null;
        try {
            return await fs.readFile(target);
        } catch (error) {
            if (error.code !== 'ENOENT') console.error('Erreur lecture photo:', error.message);
            return null;
        }
    }
}

module.exports = ImageProcessor;
