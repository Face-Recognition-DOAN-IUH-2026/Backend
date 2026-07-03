"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const index_1 = require("../index");
describe('sanitizeInput', () => {
    it('should strip script tags and content', () => {
        expect((0, index_1.sanitizeInput)('<script>alert("xss")</script>')).toBe('');
    });
    it('should strip HTML tags but keep text content', () => {
        expect((0, index_1.sanitizeInput)('Hello <b>World</b>')).toBe('Hello World');
        expect((0, index_1.sanitizeInput)('Hello <b onmouseover="alert(1)">World</b>')).toBe('Hello World');
    });
    it('should strip event handler attributes', () => {
        expect((0, index_1.sanitizeInput)('<img src=x onerror=alert(1)>')).toBe('');
        expect((0, index_1.sanitizeInput)('<div onmouseover="alert(1)">test</div>')).toBe('test');
    });
    it('should keep safe characters like quotes intact', () => {
        expect((0, index_1.sanitizeInput)('test"value')).toBe('test"value');
        expect((0, index_1.sanitizeInput)("test'value")).toBe("test'value");
    });
    it('should handle empty string', () => {
        expect((0, index_1.sanitizeInput)('')).toBe('');
    });
    it('should not modify plain text', () => {
        expect((0, index_1.sanitizeInput)('Hello World')).toBe('Hello World');
    });
});
