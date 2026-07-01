"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chunkText = chunkText;
exports.embedText = embedText;
exports.embedTexts = embedTexts;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config");
const CHUNK_SIZE = 500;
function chunkText(text, chunkSize = CHUNK_SIZE) {
    const chunks = [];
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    let currentChunk = '';
    for (const sentence of sentences) {
        if ((currentChunk + sentence).length <= chunkSize) {
            currentChunk += sentence;
        }
        else {
            if (currentChunk) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = sentence;
        }
    }
    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }
    return chunks;
}
async function embedText(text) {
    const response = await axios_1.default.post('https://integrate.api.nvidia.com/v1/embeddings', {
        input: text,
        model: config_1.config.nvidiaEmbedModel,
    }, {
        headers: {
            'Authorization': `Bearer ${config_1.config.nvidiaApiKey}`,
            'Content-Type': 'application/json',
        },
        timeout: 60000,
    });
    if (response.data.data && response.data.data.length > 0) {
        return response.data.data[0].embedding;
    }
    throw new Error('No embedding returned from NVIDIA API');
}
async function embedTexts(texts) {
    if (texts.length === 0)
        return [];
    const response = await axios_1.default.post('https://integrate.api.nvidia.com/v1/embeddings', {
        input: texts,
        model: config_1.config.nvidiaEmbedModel,
    }, {
        headers: {
            'Authorization': `Bearer ${config_1.config.nvidiaApiKey}`,
            'Content-Type': 'application/json',
        },
        timeout: 120000,
    });
    if (response.data.data && response.data.data.length > 0) {
        return response.data.data.map(item => item.embedding);
    }
    throw new Error('No embeddings returned from NVIDIA API');
}
exports.default = { chunkText, embedText, embedTexts };
