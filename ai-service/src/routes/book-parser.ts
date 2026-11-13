import { Router, Request, Response } from 'express';
import { config } from '../config';
import { extractJson } from '../utils/extractJson';
import { requireRole } from '../../../shared/auth';

const router = Router();

export interface ParseBookTextRequest {
  raw_text: string;
}

export interface ParsedBookData {
  title: string | null;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  publish_year: number | null;
  categories: string | null;
  ddc_code: string | null;
  summary: string | null;
}

export function normalizeIsbn(val: string | null | undefined): string | null {
  if (!val) return null;
  const cleaned = val.replace(/[^0-9X]/gi, '').toUpperCase();
  if (cleaned.length === 10 || cleaned.length === 13) return cleaned;
  return null;
}

export function regexFallbackBookParse(rawText: string): ParsedBookData {
  const result: ParsedBookData = {
    title: null,
    author: null,
    isbn: null,
    publisher: null,
    publish_year: null,
    categories: null,
    ddc_code: null,
    summary: null,
  };

  // Find ISBN
  const isbnMatch = rawText.match(/ISBN(?:-1[03])?:?\s*([0-9Xx\s-]{10,17})/i);
  if (isbnMatch) {
    result.isbn = normalizeIsbn(isbnMatch[1]);
  }

  // Find Title: "Tên sách:", "Nhan đề:", "Title:"
  const titleMatch = rawText.match(/(?:Tên sách|Nhan đề|Title):\s*([^\n\r]+)/i);
  if (titleMatch) {
    result.title = titleMatch[1].trim();
  }

  // Find Author: "Tác giả:", "Tác giả chính:", "Author:"
  const authorMatch = rawText.match(/(?:Tác giả|Author):\s*([^\n\r]+)/i);
  if (authorMatch) {
    result.author = authorMatch[1].trim();
  }

  // Find Publisher: "Nhà xuất bản:", "NXB:", "Publisher:"
  const pubMatch = rawText.match(/(?:Nhà xuất bản|NXB|Publisher):\s*([^\n\r]+)/i);
  if (pubMatch) {
    result.publisher = pubMatch[1].trim();
  }

  // Find Year: "Năm XB:", "Năm xuất bản:", 4 digits
  const yearMatch = rawText.match(/(?:Năm XB|Năm xuất bản|Xuất bản năm|Year):\s*(\d{4})/i) ||
                    rawText.match(/\b(19\d{2}|20\d{2})\b/);
  if (yearMatch) {
    result.publish_year = parseInt(yearMatch[1], 10);
  }

  // Find DDC code: e.g. "DDC: 005.1" or "004.6"
  const ddcMatch = rawText.match(/DDC:?\s*(\d{3}(?:\.\d+)?)/i);
  if (ddcMatch) {
    result.ddc_code = ddcMatch[1].trim();
  }

  return result;
}

async function callOpenRouter(prompt: string, userContent: string): Promise<string> {
  if (!config.openRouter.apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured');
  }

  const res = await fetch(`${config.openRouter.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openRouter.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost',
      'X-Title': 'IUH Library Book Parser',
    },
    body: JSON.stringify({
      model: config.openRouter.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: prompt },
        { role: 'user', content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`OpenRouter returned ${res.status}: ${detail}`);
  }

  const data: any = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

const BOOK_PARSE_PROMPT = `You are an expert library cataloger. Extract structured book metadata from the raw text/OCR of a book cover, copyright page, or description.
Return a valid JSON object with the following fields:
- title: string | null (Book title)
- author: string | null (Author or authors)
- isbn: string | null (ISBN 10 or 13, digits only or with standard X)
- publisher: string | null (Publishing house / Nhà xuất bản)
- publish_year: number | null (Year of publication, e.g. 2023)
- categories: string | null (Subject categories / Thể loại)
- ddc_code: string | null (Dewey Decimal Classification code, e.g. "005.13" for programming)
- summary: string | null (Brief 1-2 sentence summary of what the book is about)

Rules:
1. Return ONLY valid JSON, no markdown code fence, no additional commentary.
2. If a field cannot be determined, set it to null.
3. Clean and normalize ISBN digits.`;

// POST /ai/parse-book-text - Parse raw OCR / catalog text into structured book metadata
// Role guard lives on the route (not on the /ai mount): a requireRole mounted on
// the whole /ai prefix would also terminate unrelated /ai requests for patrons.
router.post('/parse-book-text', requireRole(['admin', 'staff']), async (req: Request, res: Response) => {
  try {
    const { raw_text } = req.body as ParseBookTextRequest;

    if (!raw_text || typeof raw_text !== 'string') {
      res.status(400).json({ error: 'raw_text is required and must be a string' });
      return;
    }

    if (raw_text.trim().length === 0) {
      res.status(400).json({ error: 'raw_text cannot be empty' });
      return;
    }

    if (config.ai.mockMode) {
      res.json(regexFallbackBookParse(raw_text));
      return;
    }

    try {
      const llmResponse = await callOpenRouter(BOOK_PARSE_PROMPT, raw_text);
      let parsed: ParsedBookData;
      try {
        const extracted = extractJson(llmResponse) as any;
        parsed = {
          title: extracted.title || null,
          author: extracted.author || null,
          isbn: normalizeIsbn(extracted.isbn),
          publisher: extracted.publisher || null,
          publish_year: typeof extracted.publish_year === 'number' ? extracted.publish_year : (extracted.publish_year ? parseInt(extracted.publish_year, 10) : null),
          categories: extracted.categories || null,
          ddc_code: extracted.ddc_code || null,
          summary: extracted.summary || null,
        };
      } catch (parseErr) {
        console.warn('Failed to parse LLM book response as JSON, falling back to regex:', parseErr);
        parsed = regexFallbackBookParse(raw_text);
      }

      // Merge with regex fallback to fill any gaps
      const fallback = regexFallbackBookParse(raw_text);
      parsed = {
        title: parsed.title || fallback.title,
        author: parsed.author || fallback.author,
        isbn: parsed.isbn || fallback.isbn,
        publisher: parsed.publisher || fallback.publisher,
        publish_year: parsed.publish_year || fallback.publish_year,
        categories: parsed.categories || fallback.categories,
        ddc_code: parsed.ddc_code || fallback.ddc_code,
        summary: parsed.summary,
      };

      res.json(parsed);
      return;
    } catch (llmErr) {
      console.warn('LLM book call failed, using regex fallback:', llmErr);
      const fallback = regexFallbackBookParse(raw_text);
      res.json(fallback);
      return;
    }
  } catch (err) {
    console.error('Book parsing error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `Book parsing failed: ${message}` });
  }
});

export default router;

