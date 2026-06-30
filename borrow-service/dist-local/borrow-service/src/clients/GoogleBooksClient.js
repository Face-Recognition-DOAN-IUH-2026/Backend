"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchGoogleBooks = fetchGoogleBooks;
const circuitBreaker_1 = require("../../../shared/utils/circuitBreaker");
const circuit = new circuitBreaker_1.CircuitBreaker(3, 60000);
// Google Books API key - should be set via environment variable in production
const GOOGLE_BOOKS_API_KEY = process.env.GOOGLE_BOOKS_API_KEY || '';
async function fetchGoogleBooks(isbn) {
    if (!circuit.canRequest())
        return null;
    if (!GOOGLE_BOOKS_API_KEY) {
        console.warn('Google Books API key not configured');
        return null;
    }
    try {
        const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&maxResults=1&key=${GOOGLE_BOOKS_API_KEY}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) {
            circuit.recordFailure();
            return null;
        }
        const data = await res.json();
        circuit.recordSuccess();
        if (!data.items || data.items.length === 0)
            return null;
        const volume = data.items[0];
        const info = volume.volumeInfo;
        if (!info)
            return null;
        const isbn10 = info.industryIdentifiers?.find((id) => id.type === 'ISBN_10')?.identifier || null;
        const isbn13 = info.industryIdentifiers?.find((id) => id.type === 'ISBN_13')?.identifier || null;
        const thumbnail = info.imageLinks?.thumbnail
            || info.imageLinks?.smallThumbnail
            || null;
        const authors = Array.isArray(info.authors) ? info.authors.join(', ') : null;
        const categories = Array.isArray(info.categories) ? info.categories.join(', ') : null;
        return {
            title: info.title || `ISBN ${isbn}`,
            subtitle: info.subtitle || null,
            author: authors,
            publisher: info.publisher || null,
            publishedDate: info.publishedDate || null,
            description: info.description || null,
            pageCount: info.pageCount || null,
            categories,
            averageRating: info.averageRating || null,
            language: info.language || null,
            coverUrl: thumbnail,
            isbn10,
            isbn13,
        };
    }
    catch {
        circuit.recordFailure();
        return null;
    }
}
