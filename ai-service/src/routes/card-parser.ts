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

const VIETNAMESE_SURNAME_MAP: Record<string, string> = {
  nguyen: 'Nguyễn',
  tran: 'Trần',
  le: 'Lê',
  ly: 'Lý',
  pham: 'Phạm',
  phan: 'Phan',
  hoang: 'Hoàng',
  huynh: 'Huỳnh',
  vu: 'Vũ',
  vo: 'Võ',
  dang: 'Đặng',
  bui: 'Bùi',
  do: 'Đỗ',
  ho: 'Hồ',
  ngo: 'Ngô',
  duong: 'Dương',
  trinh: 'Trịnh',
};

const VI_MIDDLE_MAP: Record<string, string> = {
  van: 'Văn',
  thi: 'Thị',
  minh: 'Minh',
  huu: 'Hữu',
  cong: 'Công',
  duc: 'Đức',
  thanh: 'Thanh',
  quang: 'Quang',
  trong: 'Trọng',
};

function capitalize(word: string): string {
  if (!word) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function normalizeStudentCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d]/g, '');
  return digits || null;
}

function normalizeFullName(value: string | null | undefined): string | null {
  if (!value) return null;
  const parts = value.trim().split(/\s+/);
  const normalized = parts.map((part, idx) => {
    const lower = part.toLowerCase();
    if (idx === 0) {
      return VIETNAMESE_SURNAME_MAP[lower] || capitalize(lower);
    }
    if (idx === parts.length - 1) {
      return capitalize(lower);
    }
    return VI_MIDDLE_MAP[lower] || capitalize(lower);
  });
  return normalized.join(' ');
}

function normalizeDateOfBirth(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const ddmmyyyy = trimmed.match(/^(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})$/);
  if (ddmmyyyy) {
    return `${ddmmyyyy[1]}/${ddmmyyyy[2]}/${ddmmyyyy[3]}`;
  }
  return trimmed;
}

function extractCourseFromClassName(class_name: string | null | undefined, course: string | null | undefined): string | null {
  if (course) return course;
  if (!class_name) return null;
  const match = class_name.match(/\-(\d+)/);
  if (match) return match[1];
  const kMatch = class_name.match(/K(\d+)/i);
  if (kMatch) return kMatch[1];
  return null;
}

function normalizeParsedCard(raw: Record<string, unknown>): ParsedCardData {
  return {
    student_code: normalizeStudentCode((raw.student_code as string) || ''),
    full_name: normalizeFullName((raw.full_name as string) || ''),
    class_name: (raw.class_name as string) || null,
    date_of_birth: normalizeDateOfBirth((raw.date_of_birth as string) || ''),
    course: extractCourseFromClassName((raw.class_name as string) || '', (raw.course as string) || ''),
    permanent_address: (raw.permanent_address as string) || null,
    faculty: (raw.faculty as string) || null,
  };
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

const CARD_PARSE_PROMPT = `You are a Vietnamese student card text parser. Extract structured fields from the raw OCR text of a Vietnamese university student card (thẻ sinh viên). Return a JSON object with these fields:
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
4. Normalize full_name: If Vietnamese diacritics are missing from OCR (e.g. "Nguyen Van A"), reconstruct proper Vietnamese diacritics based on common name patterns (e.g. "Nguyễn Văn A"). Always return Vietnamese with correct diacritics.
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
      parsed = normalizeParsedCard(extracted as Record<string, unknown>);
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
