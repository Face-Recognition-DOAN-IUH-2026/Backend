import { sanitizeInput } from '../index';

describe('sanitizeInput', () => {
  it('should escape HTML tags', () => {
    expect(sanitizeInput('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('should escape quotes', () => {
    expect(sanitizeInput('test"value')).toBe('test&quot;value');
    expect(sanitizeInput("test'value")).toBe("test&#x27;value");
  });

  it('should handle empty string', () => {
    expect(sanitizeInput('')).toBe('');
  });

  it('should not modify plain text', () => {
    expect(sanitizeInput('Hello World')).toBe('Hello World');
  });
});
