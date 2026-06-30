"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchOpenLibrary = fetchOpenLibrary;
const circuitBreaker_1 = require("../../../shared/utils/circuitBreaker");
const circuit = new circuitBreaker_1.CircuitBreaker(3, 60000);
async function fetchOpenLibrary(isbn) {
    if (!circuit.canRequest())
        return null;
    try {
        const url = new URL('https://openlibrary.org/api/books');
        url.searchParams.set('bibkeys', `ISBN:${isbn}`);
        url.searchParams.set('format', 'json');
        url.searchParams.set('jscmd', 'data');
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
            circuit.recordFailure();
            return null;
        }
        const data = await res.json();
        const book = data[`ISBN:${isbn}`];
        circuit.recordSuccess();
        if (!book)
            return null;
        return {
            title: book.title || `ISBN ${isbn}`,
            author: book.authors?.[0]?.name || null,
            cover_url: book.cover?.medium || book.cover?.small || null,
        };
    }
    catch {
        circuit.recordFailure();
        return null;
    }
}
