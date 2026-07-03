import { sanitizeInput } from '../index';

describe('sanitizeInput', () => {
  it('should strip script tags and content', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).toBe('');
  });

  it('should strip HTML tags but keep text content', () => {
    expect(sanitizeInput('Hello <b>World</b>')).toBe('Hello World');
    expect(sanitizeInput('Hello <b onmouseover="alert(1)">World</b>')).toBe('Hello World');
  });

  it('should strip event handler attributes', () => {
    expect(sanitizeInput('<img src=x onerror=alert(1)>')).toBe('');
    expect(sanitizeInput('<div onmouseover="alert(1)">test</div>')).toBe('test');
  });

  it('should keep safe characters like quotes intact', () => {
    expect(sanitizeInput('test"value')).toBe('test"value');
    expect(sanitizeInput("test'value")).toBe("test'value");
  });

  it('should handle empty string', () => {
    expect(sanitizeInput('')).toBe('');
  });

  it('should not modify plain text', () => {
    expect(sanitizeInput('Hello World')).toBe('Hello World');
  });
});
