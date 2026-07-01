"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChromaClient = getChromaClient;
exports.getCollection = getCollection;
exports.resetCollection = resetCollection;
const chromadb_1 = require("chromadb");
const config_1 = require("../config");
const embedding_1 = require("./embedding");
let chromaClient = null;
let collection = null;
function getChromaClient() {
    if (!chromaClient) {
        chromaClient = new chromadb_1.ChromaClient({
            path: config_1.config.chromaDbUrl,
        });
    }
    return chromaClient;
}
async function getCollection() {
    if (!collection) {
        const client = getChromaClient();
        try {
            collection = await client.getCollection({
                name: config_1.config.chromaCollection,
                embeddingFunction: embedding_1.hashEmbeddingFn,
            });
        }
        catch {
            collection = await client.createCollection({
                name: config_1.config.chromaCollection,
                embeddingFunction: embedding_1.hashEmbeddingFn,
            });
        }
    }
    return collection;
}
async function resetCollection() {
    const client = getChromaClient();
    try {
        await client.deleteCollection({ name: config_1.config.chromaCollection });
    }
    catch {
    }
    collection = await client.createCollection({
        name: config_1.config.chromaCollection,
        embeddingFunction: embedding_1.hashEmbeddingFn,
    });
    return collection;
}
exports.default = { getChromaClient, getCollection, resetCollection };
