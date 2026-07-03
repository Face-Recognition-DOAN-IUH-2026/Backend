"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hashEmbeddingFn = exports.HashEmbeddingFunction = void 0;
const DIMENSION = 384;
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash;
}
function textToEmbedding(text) {
    const embedding = [];
    const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
    for (let i = 0; i < DIMENSION; i++) {
        let val = 0;
        for (let j = 0; j < words.length; j++) {
            const word = words[j];
            val += Math.sin(simpleHash(word + '_' + i) * 0.001) * 0.5;
            val += Math.cos(simpleHash(word + '_' + i + '_2') * 0.001) * 0.3;
        }
        embedding.push(val);
    }
    const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
        for (let i = 0; i < embedding.length; i++) {
            embedding[i] /= norm;
        }
    }
    return embedding;
}
class HashEmbeddingFunction {
    async generate(texts) {
        return texts.map(text => textToEmbedding(text));
    }
}
exports.HashEmbeddingFunction = HashEmbeddingFunction;
exports.hashEmbeddingFn = new HashEmbeddingFunction();
