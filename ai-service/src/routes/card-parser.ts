import { Router, Request, Response } from 'express';
import { config } from '../config';
import { extractJson } from '../utils/extractJson';

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

// Regex fallback when LLM is unavailable — extracts fields directly from OCR text
// Handles many IUH card variants: "MSSV", "MSV", "Ma SV", "Ma so SV", "Student Code", etc.
function regexFallbackParse(rawText: string): ParsedCardData {
  const text = rawText;

  let student_code: string | null = null;
  // MSSV / MSV / Ma SV / Ma so sinh vien / Student ID / ID ... + 7-13 digits
  const mssvMatch =
    text.match(/(?:MSSV|MSV|Mã\s*(?:số)?\s*(?:SV|sinh\s*viên)|Ma\s*so\s*SV|Student\s*(?:ID|Code)|ID)\s*[:\-]?\s*(\d{7,13})/i) ||
    text.match(/\b(\d{8,13})\b/);
  if (mssvMatch) student_code = normalizeStudentCode(mssvMatch[1]);

  let full_name: string | null = null;
  const nameMatch =
    text.match(/Họ\s*và\s*tên\s*[:\-]?\s*([A-Za-zÀ-ỹ\s]+)/i) ||
    text.match(/Ho\s*va\s*ten\s*[:\-]?\s*([A-Za-zÀ-ỹ\s]+)/i) ||
    text.match(/Họ\s*tên\s*[:\-]?\s*([A-Za-zÀ-ỹ\s]+)/i) ||
    text.match(/(?:Tên|Ten)\s*[:\-]?\s*([A-Za-zÀ-ỹ\s]{4,40})/i);
  if (nameMatch) {
    const candidate = nameMatch[1].split('\n')[0].trim().split(/Lớp|Class|MSSV|MSV|Mã|Ngày|Khoa|HKTT|Course|Khoa/i)[0].trim();
    if (candidate.length >= 2 && candidate.length < 50 && !/^\d+$/.test(candidate) && candidate.split(/\s+/).length >= 2) {
      full_name = normalizeFullName(candidate);
    }
  }

  let class_name: string | null = null;
  const classMatch = text.match(/(?:Lớp|Class)\s*[:\-]?\s*([A-Z0-9\-_.]+)/i);
  if (classMatch) class_name = classMatch[1].trim().replace(/[.,;]+$/, '');

  let date_of_birth: string | null = null;
  const dobMatch = text.match(/(\d{2}[\/\-.]\d{2}[\/\-.]\d{4})/);
  if (dobMatch) date_of_birth = normalizeDateOfBirth(dobMatch[1]);

  let faculty: string | null = null;
  const facMatch = text.match(/Khoa\s*[:\-]?\s*([A-Za-zÀ-ỹ\s]+)/i);
  if (facMatch) {
    const f = facMatch[1].split('\n')[0].trim().split(/HKTT|Lớp|MSSV|MSV|Mã|Ngày/i)[0].trim();
    if (f.length >= 2) faculty = f.substring(0, 80);
  }

  let permanent_address: string | null = null;
  const addrMatch = text.match(/HKTT\s*[:\-]?\s*([^\n]+)/i) || text.match(/(?:Địa chỉ|Dia chi|Address)\s*[:\-]?\s*([^\n]{5,100})/i);
  if (addrMatch) permanent_address = addrMatch[1].trim().substring(0, 150);

  // Course: try explicit "Khóa học: 2022 - 2026" or "Khoa hoc: 2022-2026" or "Course: 2022-2026" first
  let course: string | null = null;
  const courseRangeMatch = text.match(/(?:Khóa\s*học|Khoa\s*hoc|Khóa học|Khóa|Course)\s*[:\-]?\s*(\d{4}\s*[–-]\s*\d{4})/i);
  if (courseRangeMatch) {
    course = courseRangeMatch[1].replace(/\s+/g, ' ').trim();
    // normalize dash spacing: "2022 - 2026"
    course = course.replace(/\s*[–-]\s*/, ' - ');
  } else {
    const singleYearMatch = text.match(/(?:Khóa\s*học|Khoa\s*hoc|Khóa|Course)\s*[:\-]?\s*(\d{4})/i);
    if (singleYearMatch) course = singleYearMatch[1];
    else course = extractCourseFromClassName(class_name, null);
  }

  return {
    student_code,
    full_name,
    class_name,
    date_of_birth,
    course,
    permanent_address,
    faculty,
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

    // Mock mode: use regex fallback without LLM
    if (config.ai.mockMode) {
      const mockResult = regexFallbackParse(raw_text);
      res.json(mockResult);
      return;
    }

    // Call LLM to parse the text — fallback to regex on any failure
    try {
      const llmResponse = await callOpenRouter(CARD_PARSE_PROMPT, raw_text);
      let parsed: ParsedCardData;
      try {
        const extracted = extractJson(llmResponse);
        parsed = normalizeParsedCard(extracted as Record<string, unknown>);
      } catch (parseErr) {
        console.warn('Failed to parse LLM response as JSON, falling back to regex:', parseErr);
        parsed = regexFallbackParse(raw_text);
      }
      // Merge with regex fallback: fill missing fields and prefer explicit year-range course
      const fallback = regexFallbackParse(raw_text);
      // Prefer regex course when it is a range like "2022 - 2026" (more specific than LLM's "18")
      const isRangeCourse = (c: string | null) => !!c && /\d{4}\s*[–-]\s*\d{4}/.test(c);
      const mergedCourse = isRangeCourse(fallback.course) ? fallback.course : (parsed.course || fallback.course);
      if (!parsed.student_code || !parsed.full_name || isRangeCourse(fallback.course) || !parsed.course) {
        parsed = {
          student_code: parsed.student_code || fallback.student_code,
          full_name: parsed.full_name || fallback.full_name,
          class_name: parsed.class_name || fallback.class_name,
          date_of_birth: parsed.date_of_birth || fallback.date_of_birth,
          course: mergedCourse,
          permanent_address: parsed.permanent_address || fallback.permanent_address,
          faculty: parsed.faculty || fallback.faculty,
        };
      } else if (fallback.course && !parsed.course) {
        parsed.course = fallback.course;
      } else if (isRangeCourse(fallback.course)) {
        parsed.course = fallback.course;
      }
      res.json(parsed);
      return;
    } catch (llmErr) {
      console.warn('LLM call failed, using regex fallback:', llmErr);
      const fallback = regexFallbackParse(raw_text);
      // Always return 200 with fallback data — don't block registration when LLM is down
      res.json(fallback);
      return;
    }
  } catch (err) {
    console.error('Card parsing error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: `Card parsing failed: ${message}` });
  }
});

export default router;
