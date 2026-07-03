import { Router, Request, Response } from 'express';
import { config } from '../config';

const router = Router();

interface ParseCardTextRequest {
  raw_text: string;
}

interface ParsedCardData {
  student_code: string | null;
  full_name: string | null;
  class_name: string | null;
  date_of_birth: string | null;
  course: string | null;
  permanent_address: string | null;
  faculty: string | null;
}

function extractJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  return JSON.parse(cleaned);
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
      'X-Title': 'IUH Library Card Parser',
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

const CARD_PARSE_PROMPT = `You are a Vietnamese student card text parser. Extract structured fields from the raw OCR text of a Vietnamese university student card (thẻ sinh viên).

Return a JSON object with these fields:
- student_code: string | null (MSSV - student ID number, e.g. "20520001")
- full_name: string | null (Họ và tên - full name in Vietnamese)
- class_name: string | null (Lớp - class name, e.g. "CNTT-K45")
- date_of_birth: string | null (NS or Ngày sinh - date of birth, format DD/MM/YYYY)
- course: string | null (Khóa - course/cohort number, e.g. "45" or "K45")
- permanent_address: string | null (HKTT - permanent residence/address)
- faculty: string | null (Khoa - faculty/department)

Rules:
1. Return ONLY valid JSON, no markdown, no explanation
2. If a field cannot be found, set it to null
3. Normalize student_code: remove spaces, keep only digits
4. Normalize full_name: proper case (first letter uppercase, rest lowercase for each word)
5. Normalize date_of_birth: DD/MM/YYYY format
6. Extract course number from class_name if not found separately (e.g. "CNTT-K45" -> course "45")
7. Handle common OCR errors: "0" vs "O", "1" vs "l", etc.`;

// POST /ai/parse-card-text - Parse raw OCR text into structured card data
router.post('/parse-card-text', async (req: Request, res: Response) => {
  try {
    const { raw_text } = req.body as ParseCardTextRequest;

    if (!raw_text || typeof raw_text !== 'string') {
      res.status(400).json({ error: 'raw_text is required and must be a string' });
      return;
    }

    if (raw_text.trim().length === 0) {
      res.status(400).json({ error: 'raw_text cannot be empty' });
      return;
    }

    // Mock mode: return basic parsing without LLM
    if (config.ai.mockMode) {
      const mockResult: ParsedCardData = {
        student_code: raw_text.match(/\d{7,13}/)?.[0] || null,
        full_name: null,
        class_name: null,
        date_of_birth: null,
        course: null,
        permanent_address: null,
        faculty: null,
      };
      res.json(mockResult);
      return;
    }

    // Call LLM to parse the text
    const llmResponse = await callOpenRouter(CARD_PARSE_PROMPT, raw_text);

    // Parse JSON response
    let parsed: ParsedCardData;
    try {
      const extracted = extractJson(llmResponse);
      parsed = {
        student_code: (extracted as any).student_code || null,
        full_name: (extracted as any).full_name || null,
        class_name: (extracted as any).class_name || null,
        date_of_birth: (extracted as any).date_of_birth || null,
        course: (extracted as any).course || null,
        permanent_address: (extracted as any).permanent_address || null,
        faculty: (extracted as any).faculty || null,
      };
    } catch (parseErr) {
      console.warn('Failed to parse LLM response as JSON:', parseErr);
      // Fallback: return raw text with no parsed fields
      parsed = {
        student_code: null,
        full_name: null,
        class_name: null,
        date_of_birth: null,
        course: null,
        permanent_address: null,
        faculty: null,
      };
    }

    res.json(parsed);
  } catch (err) {
    console.error('Card parsing error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `Card parsing failed: ${message}` });
  }
});

export default router;
