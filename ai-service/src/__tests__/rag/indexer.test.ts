import { extractFrontmatter, parseRoles } from '../../rag/indexer';

/**
 * BLF-RAG-01 — RAG role isolation: documents without valid role frontmatter
 * must NOT fail-open to `patron`.
 */
describe('BLF-RAG-01 extractFrontmatter / parseRoles (role isolation)', () => {
  describe('extractFrontmatter', () => {
    it('parses valid frontmatter roles and extracts body', () => {
      const content = '---\nroles: patron\n---\n\nThis is the body.';
      const { metadata, body } = extractFrontmatter(content);
      expect(metadata.roles).toBe('patron');
      expect(body).toBe('\nThis is the body.');
    });

    it('parses multiple roles', () => {
      const content = '---\nroles: staff, admin\n---\n\nBody here.';
      const { metadata } = extractFrontmatter(content);
      expect(metadata.roles).toBe('staff, admin');
    });

    it('does NOT default frontmatter-less documents to roles: patron (fail-open fix)', () => {
      const content = '# Staff-only document\n\nConfidential financial report content.';
      const { metadata, body } = extractFrontmatter(content);
      expect(metadata).toEqual({}); // no roles key -> restricted, not patron
      expect(metadata.roles).toBeUndefined();
      expect(body).toBe(content);
    });

    it('returns empty metadata when frontmatter has no roles key', () => {
      const content = '---\ndoc_title: Something\n---\n\nBody.';
      const { metadata } = extractFrontmatter(content);
      expect(metadata.roles).toBeUndefined();
    });
  });

  describe('parseRoles', () => {
    it('parses a single role', () => {
      expect(parseRoles('patron')).toEqual(['patron']);
    });

    it('parses multiple roles', () => {
      expect(parseRoles('staff, admin')).toEqual(['staff', 'admin']);
    });

    it('returns empty array for empty string', () => {
      expect(parseRoles('')).toEqual([]);
    });

    it('filters out invalid role tokens', () => {
      expect(parseRoles('invalid, patron, unknown')).toEqual(['patron']);
    });

    it('returns empty array when all tokens invalid', () => {
      expect(parseRoles('invalid, unknown')).toEqual([]);
    });
  });
});
