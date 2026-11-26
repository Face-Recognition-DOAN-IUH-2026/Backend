import { nvidiaClient } from '../clients/nvidia';
import type { NativeToolCall } from '../clients/nvidia';
import { ToolDef, patronToolDefs, getToolDefsForRole, toOpenAITools, bindToolArgs } from '../tools/registry';
import { retrieve, RetrievedDocument } from '../rag/retriever';
import { evaluateEvidence, validateCitations } from '../rag/evidenceGate';
import { MemoryService } from '../services/MemoryService';
import { TTSClient } from '../clients/TTSClient';

type ChatRole = 'system' | 'user' | 'assistant';

export interface AgentState {
  messages: Array<{ role: ChatRole; content: string }>;
  toolCalls: Array<{ name: string; args: Record<string, any> }>;
  toolResults: Array<{ name: string; result: any }>;
  requiresConfirmation: boolean;
  confirmationAction: string | null;
  sessionId: string;
}

export interface UserContext {
  userId: string;
  email: string;
  role: string;
  fullName?: string;
}

function buildToolsDescription(toolDefs: ToolDef[]): string {
  return toolDefs
    .map(t => `- ${t.name}: ${t.description}`)
    .join('\n');
}

export function buildSystemPrompt(
  contextDocuments: RetrievedDocument[],
  userContext?: UserContext,
  availableTools: ToolDef[] = patronToolDefs,
): string {
  const kbContext = contextDocuments.length > 0
    ? `\n\n=== TAI LIEU TRI THUC THU VIEN (Knowledge Base Context) ===\nUu tien so 1: Neu cau hoi cua nguoi dung lien quan den thong tin co trong tai lieu duoi day, BAT BUOC tra loi chinh xac theo noi dung tai lieu nay (khong tu bia hoac dung quy dinh khac) va trich dan ten tai lieu [Ten tai lieu].\n\n${contextDocuments.map(d => `[${d.docTitle}] ${d.content}`).join('\n\n')}`
    : '';

  let userContextPrompt = '';
  if (userContext) {
    if (userContext.role === 'patron') {
      userContextPrompt = `
NGUOI DUNG HIEN TAI:
- Vai tro: Doc gia (patron)
- Ma the: ${userContext.userId}
- Ho ten: ${userContext.fullName || 'Chua cap nhat'}
- Email: ${userContext.email}

QUY TAC CHO PATRON:
- CAC TOOL get_patron_info/get_patron_borrows/get_patron_history KHONG CAN tham so — he thong tu dong inject userId
- CHI hien thi du lieu CUA CHINH NGUOI DUNG NAY
- KHONG BAO GIO hien thi du lieu cua nguoi khac`;
    } else {
      userContextPrompt = `
NGUOI DUNG HIEN TAI:
- Vai tro: ${userContext.role === 'admin' ? 'Quan tri vien (admin)' : 'Nhan vien (staff)'}
- Ma: ${userContext.userId}
- Ho ten: ${userContext.fullName || 'Chua cap nhat'}
- Email: ${userContext.email}

QUY TAC CHO STAFF/ADMIN:
- DUOC phep tra cuu nguoi khac NHUNG phai co MSSV/Ma the hop le
- CHI su dung cac tool READ-ONLY (tra cuu, tim kiem, xem lich su)
- KHONG thuc hien bat ky thao tac ghi/xoa/sua nao qua AI`;
    }
  }

  const basePrompt = `Ban la tro ly thu vien cua IUH (Vien Dao tao Quoc te - Dai hoc Cong nghe TP.HCM), ten "TVTL".`;

  return `${basePrompt}

Nhiem vu chinh:
- Tra loi cau hoi ve thu vien (gio mo cua, quy dinh, chinh sach)
- Ho tro tim kiem sach va thong tin tai lieu
- Tu van lich truc va bao cao
- Huong dan su dung thu vien

Nguyen tac quan trong:
1. LUON tra loi bang tieng Viet, than thien, tu nhien va chuyen nghiep (KHONG bao gio tra ve raw JSON hay ten ham ky thuat cho nguoi dung)
2. Su dung ngu canh tu Knowledge Base khi co san: Uu tien tuyet doi thong tin, quy dinh, chinh sach, huong dan nam trong tai lieu tri thuc duoc cung cap va trich dan nguon [Ten tai lieu]
3. Neu can thong tin thuc te tu he thong (so ban doc trong thu vien, sach, muon tra, lich truc, gio mo cua...), BAT BUOC goi tool tuong ung trong danh sach — TUYET DOI KHONG tu choi bang cau "Toi chi la mot mo hinh ngon ngu..." khi da co tool ho tro
4. KHONG BAO GIO thuc hien cac thao tac ghi/xoa/sua (write/delete/update) — AI chi ho tro tra cuu (read-only)
5. Neu nguoi dung yeu cau them/xoa/sua du lieu, tu choi va huong dan ho thuc hien truc tiep tren giao dien

CAC TOOL CO SAN (READ-ONLY):
${buildToolsDescription(availableTools)}

KHI CAN GOI TOOL, tra ve dung format JSON:
{"tool": "ten_tool", "arguments": {"param1": "value1"}}
KHONG BAO GIO tra ve JSON ma khong co key "tool". Neu khong goi tool, tra loi bang tieng Viet binh thuong.

Khi da co du thong tin, tong hop va tra loi nguoi dung.

FORMAT CARD SACH (QUAN TRONG - phai dung format de frontend hien thi dep):
Khi hien thi thong tin sach, PHAI dung dung format sau:
:::book_card {"title": "Ten sach", "author": "Tac gia", "isbn": "ISBN", "categories": "The loai", "description": "Mo ta", "cover_url": "URL anh", "source": "database hoac google_books"}
KHONG BAO GIO hien thi thong tin sach bang text thuan. Luon dung format :::book_card o tren.

QUY TAC TRA LOI GIO MO CUA (get_library_hours):
- TUYET DOI KHONG tra ve raw JSON, object JSON {"schedule": [...]}, hoac format lap trinh cho nguoi dung.
- LUON dien giai va tra loi nguoi dung bang tieng Viet tu nhien, than thien, ro rang theo cac ngay trong tuan.
${userContextPrompt}
${kbContext}`;
}

export function formatScheduleJson(text: string): string {
  if (!text) return text;

  // Check if text is or contains JSON with "schedule"
  const scheduleJsonMatch = text.match(/\{[\s\S]*?"schedule"\s*:\s*\[[\s\S]*?\][\s\S]*?\}/);
  if (scheduleJsonMatch) {
    try {
      const parsed = JSON.parse(scheduleJsonMatch[0]);
      if (Array.isArray(parsed.schedule)) {
        let formatted = '🕒 **Giờ mở cửa thư viện IUH:**\n';
        for (const item of parsed.schedule) {
          let days = (item.days || item.day || '').trim();
          days = days
            .replace(/Monday\s*-\s*Friday/i, 'Thứ Hai - Thứ Sáu')
            .replace(/Saturday\s*-\s*Sunday/i, 'Thứ Bảy - Chủ Nhật')
            .replace(/Monday/i, 'Thứ Hai')
            .replace(/Tuesday/i, 'Thứ Ba')
            .replace(/Wednesday/i, 'Thứ Tư')
            .replace(/Thursday/i, 'Thứ Năm')
            .replace(/Friday/i, 'Thứ Sáu')
            .replace(/Saturday/i, 'Thứ Bảy')
            .replace(/Sunday/i, 'Chủ Nhật');
          const hours = item.hours || item.time || '';
          formatted += `• **${days}**: ${hours}\n`;
        }
        if (parsed.note) {
          formatted += `\n📌 *Lưu ý: ${parsed.note}*`;
        }
        let replaced = text.replace(scheduleJsonMatch[0], formatted.trim());
        replaced = replaced.replace(/```(?:json)?\s*\n?\s*```/g, '').trim();
        return replaced;
      }
    } catch (error) {
      console.warn('[Agent] schedule JSON parse failed, returning raw text:', (error as Error).message);
    }
  }
  return text;
}

function extractBalancedJsonObjects(text: string): Array<{ raw: string; start: number; end: number }> {
  const results: Array<{ raw: string; start: number; end: number }> = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === '{') {
      // Do not treat :::book_card {...} payload as a tool call
      const prefix = text.slice(Math.max(0, i - 20), i);
      const isBookCard = /:::book_card\s*$/.test(prefix);

      let depth = 0;
      let inString = false;
      let escaped = false;
      let j = i;

      while (j < text.length) {
        const ch = text[j];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
          }
        } else {
          if (ch === '"') {
            inString = true;
          } else if (ch === '{') {
            depth++;
          } else if (ch === '}') {
            depth--;
            if (depth === 0) {
              if (!isBookCard) {
                results.push({ raw: text.slice(i, j + 1), start: i, end: j + 1 });
              }
              i = j;
              break;
            }
          }
        }
        j++;
      }
    }
    i++;
  }

  return results;
}

function normalizeJsonKeys(obj: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k.trim().toLowerCase()] = v;
  }
  return out;
}

export function sanitizeNaturalResponse(text: string): string {
  if (!text) return '';
  let cleaned = text;

  // Remove markdown code fences that only wrap tool-call JSON
  cleaned = cleaned.replace(/```(?:json)?\s*([\s\S]*?)```/gi, (full, inner: string) => {
    if (/\{\s*"\s*(?:tool|name)\s*"/i.test(inner) || /functions\.\w+/i.test(inner)) {
      return '';
    }
    return full;
  });

  // Remove leaked tool-call JSON objects (including spaced keys like {" tool": ...})
  const objects = extractBalancedJsonObjects(cleaned);
  for (let idx = objects.length - 1; idx >= 0; idx--) {
    const item = objects[idx];
    try {
      const parsed = JSON.parse(item.raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const norm = normalizeJsonKeys(parsed);
        if (typeof norm.tool === 'string' || (typeof norm.name === 'string' && norm.arguments !== undefined)) {
          cleaned = cleaned.slice(0, item.start) + cleaned.slice(item.end);
        }
      }
    } catch {
      // Ignore non-JSON braces
    }
  }

  cleaned = cleaned
    .replace(/functions\.\w+<\|tool_call_argument_begin\|>[\s\S]*?<\|tool_call_end\|>/g, '')
    .replace(/<tool_call>[\s\S]*?(?:<\/tool_call>|\})/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

export function parseToolCalls(assistantMessage: string): Array<{ name: string; args: Record<string, any> }> {
  const toolCalls: Array<{ name: string; args: Record<string, any> }> = [];

  for (const item of extractBalancedJsonObjects(assistantMessage)) {
    try {
      const parsed = JSON.parse(item.raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
      const norm = normalizeJsonKeys(parsed);
      const toolName =
        typeof norm.tool === 'string'
          ? norm.tool.trim()
          : (typeof norm.name === 'string' && norm.arguments !== undefined ? norm.name.trim() : '');
      if (toolName) {
        const args = norm.arguments && typeof norm.arguments === 'object' && !Array.isArray(norm.arguments)
          ? norm.arguments
          : {};
        toolCalls.push({ name: toolName, args });
      }
    } catch (error) {
      console.warn('[Agent] tool-call JSON parse failed:', (error as Error).message);
    }
  }

  if (toolCalls.length > 0) return toolCalls;

  let match: RegExpExecArray | null;
  const nimRegex = /functions\.(\w+)<\|tool_call_argument_begin\|>(\{[^<]*\})<\|tool_call_end\|>/g;
  while ((match = nimRegex.exec(assistantMessage)) !== null) {
    try {
      const args = JSON.parse(match[2]);
      toolCalls.push({ name: match[1], args });
    } catch (error) {
      console.warn('[Agent] NIM tool-call JSON parse failed:', (error as Error).message);
    }
  }

  if (toolCalls.length > 0) return toolCalls;

  const tagRegex = /<tool_call>\s*(\w+)\s*\{\s*([^}]+)\s*\}/g;
  while ((match = tagRegex.exec(assistantMessage)) !== null) {
    const toolName = match[1];
    const argsStr = match[2];
    const args: Record<string, any> = {};

    const argRegex = /"(\w+)":\s*(?:"([^"]*)"|(\d+)|(\w+))/g;
    let argMatch;
    while ((argMatch = argRegex.exec(argsStr)) !== null) {
      const key = argMatch[1];
      const strValue = argMatch[2];
      const numValue = argMatch[3];
      const boolValue = argMatch[4];
      args[key] = strValue ?? (numValue ? parseInt(numValue, 10) : (boolValue === 'true' ? true : boolValue === 'false' ? false : boolValue));
    }

    toolCalls.push({ name: toolName, args });
  }

  if (toolCalls.length > 0) return toolCalls;

  const bareJsonMatch = assistantMessage.match(/^\s*(\{[^}]+\})\s*$/);
  if (bareJsonMatch) {
    try {
      const parsed = JSON.parse(bareJsonMatch[1]);
      if (parsed.isbn_or_title || parsed.query || parsed.isbn || parsed.title) {
        if (parsed.isbn_or_title) {
          toolCalls.push({ name: 'lookup_book', args: { isbn_or_query: parsed.isbn_or_title } });
        } else if (parsed.query) {
          toolCalls.push({ name: 'search_books', args: { query: parsed.query } });
        }
      }
    } catch (error) {
      console.warn('[Agent] bare tool JSON parse failed:', (error as Error).message);
    }
  }

  return toolCalls;
}

export async function processMessage(
  message: string,
  sessionId: string,
  role: string,
  sessionHistory?: Array<{ role: string; content: string }>,
  userContext?: UserContext,
  toolDefs?: ToolDef[],
): Promise<{
  response: string;
  requiresConfirmation?: boolean;
  pendingTool?: { name: string; args: Record<string, any>; description: string };
  toolResults?: any[];
  sessionId: string;
}> {
  const availableTools = toolDefs && toolDefs.length > 0
    ? toolDefs
    : getToolDefsForRole(role);

  const contextDocs = await retrieve(message, 5, role);
  const evidenceCheck = evaluateEvidence(message, contextDocs);
  if (!evidenceCheck.passed && evidenceCheck.abstainMessage) {
    return {
      response: evidenceCheck.abstainMessage,
      sessionId,
    };
  }

  const systemPrompt = buildSystemPrompt(contextDocs, userContext, availableTools);

  const messages: Array<{ role: ChatRole; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  if (sessionHistory && sessionHistory.length > 0) {
    for (const msg of sessionHistory.slice(-10)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role as ChatRole, content: msg.content });
      }
    }
  }

  messages.push({ role: 'user', content: message });

  let maxIterations = 3;
  let toolResults: Array<{ name: string; result: any }> = [];

  while (maxIterations > 0) {
    maxIterations--;

    let response = '';
    let nativeToolCalls: NativeToolCall[] = [];
    let usedNativeStream = false;

    if (typeof (nvidiaClient as any).streamChatCompletion === 'function' && availableTools.length > 0) {
      const stream = nvidiaClient.streamChatCompletion(messages, {
        temperature: contextDocs.length > 0 ? 0.3 : 0.7,
        maxTokens: 1024,
        tools: toOpenAITools(availableTools),
      });
      if (stream && typeof (stream as any)[Symbol.asyncIterator] === 'function') {
        usedNativeStream = true;
        for await (const event of stream) {
          if (event.type === 'done') {
            response = event.content || '';
            nativeToolCalls = event.toolCalls || [];
          }
        }
      }
    }

    if (!usedNativeStream) {
      response = await nvidiaClient.createChatCompletion(messages, {
        temperature: contextDocs.length > 0 ? 0.3 : 0.7,
        maxTokens: 1024,
      });
    }

    if (response.trim()) {
      messages.push({ role: 'assistant', content: response });
    }

    const toolCalls: Array<{ name: string; args: Record<string, any>; native: boolean }> =
      nativeToolCalls.length > 0
        ? nativeToolCalls.map(tc => ({ name: tc.name, args: tc.args, native: true }))
        : parseToolCalls(response || '').map(tc => ({ name: tc.name, args: tc.args, native: false }));

    if (toolCalls.length === 0) {
      let finalResponse = sanitizeNaturalResponse(response || '');
      if (!finalResponse && toolResults.length > 0) {
        finalResponse = summariseToolResults(toolResults) || 'Đã truy vấn xong thông tin cho bạn.';
      }
      if (!finalResponse) {
        finalResponse = 'Xin lỗi, tôi chưa thể diễn giải thông tin này lúc này. Vui lòng thử hỏi lại rõ hơn.';
      }
      finalResponse = formatScheduleJson(finalResponse);
      finalResponse = validateCitations(finalResponse, contextDocs).text;
      return {
        response: finalResponse,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        sessionId,
      };
    }

    const callsToProcess = toolCalls.slice(0, 1);

    for (const call of callsToProcess) {
      const tool = availableTools.find(t => t.name === call.name);

      if (!tool) {
        toolResults.push({
          name: call.name,
          result: { error: `Unknown tool: ${call.name}. Access denied for role: ${role}` },
        });
        messages.push({
          role: 'user',
          content: `[He thong] Tool "${call.name}" không tồn tại hoac ban khong co quyen su dung. Chi su dung cac tool: ${availableTools.map(t => t.name).join(', ')}`,
        });
        continue;
      }

      try {
        const fn = tool.func as (...args: any[]) => any;

        let result: any;
        if (tool.injectUserId && userContext) {
          result = await fn(userContext.userId);
        } else if (call.native) {
          result = await fn(...bindToolArgs(tool, call.args));
        } else {
          const argValues = Object.values(call.args);
          result = await fn(...argValues);
        }

        toolResults.push({ name: call.name, result });

        const resultStr = JSON.stringify(result, null, 2);
        let resultForPrompt = resultStr;
        if (call.name === 'get_library_hours') {
          resultForPrompt = `Thứ Hai - Thứ Sáu: 06:30 - 21:00\nThứ Bảy - Chủ Nhật: 08:00 - 19:30\n(Lưu ý: Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt)`;
          if (contextDocs.length > 0) {
            resultForPrompt += `\n(Luu y bo sung: Kiem tra Knowledge Base Context de cap nhat neu co lich mo cua dac biet hoac quy dinh moi nhat.)`;
          }
        }
        messages.push({
          role: 'user',
          content: `[He thong] Ket qua tu tool "${call.name}":\n${resultForPrompt}\n\nDua tren ket qua tren, tra loi nguoi dung bang tieng Viet tu nhien (TUYET DOI KHONG tra ve raw JSON hay ma nguon). Neu da co du thong tin, tong hop va tra loi. Neu can them thong tin, goi tool tiep theo.`,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        toolResults.push({ name: call.name, result: { error: errorMsg } });
        messages.push({
          role: 'user',
          content: `[He thong] Loi khi goi tool "${call.name}": ${errorMsg}`,
        });
      }
    }
  }

  return {
    response: 'Da dat den gioi han so buoc xu ly. Vui long thu lai voi cau hoi ngan hon.',
    toolResults,
    sessionId,
  };
}

/** Human-readable summary used when the model produced no usable final answer. */
function summariseToolResults(toolResults: Array<{ name: string; result: any }>): string | null {
  const summary = toolResults
    .filter(t => t.result?.success && t.result?.data)
    .map(t => {
      const data = t.result.data;
      if (t.name === 'get_operations_summary' && typeof data === 'object') {
        const inside = data.patrons_inside ?? 0;
        const entries = data.today_entries ?? 0;
        const exits = data.today_exits ?? 0;
        const overdue = data.total_overdue_borrows ?? 0;
        return `Hiện có ${inside} bạn đọc đang ở trong thư viện (hôm nay có ${entries} lượt vào, ${exits} lượt ra và ${overdue} phiếu mượn quá hạn).`;
      }
      if (Array.isArray(data)) {
        return data.length === 0
          ? `Không tìm thấy kết quả phù hợp.`
          : `Tìm thấy ${data.length} kết quả phù hợp.`;
      }
      return `Đã tra cứu thông tin thành công.`;
    })
    .join('\n');

  return summary || 'Đã tra cứu xong thông tin.';
}

/** Parse the `:::book_card {…}` block a tool answer may embed, if present. */
function parseBookCard(finalResponse: string): Record<string, any> | null {
  if (!finalResponse.includes(':::book_card')) return null;
  const match = finalResponse.match(/:::book_card\s*(\{.*?\})/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    console.warn('[Agent] book_card JSON parse failed:', (error as Error).message);
    return null;
  }
}

export interface CompanionMessageInput {
  message?: string;
  audioBase64?: string;
  sessionId: string;
  role: string;
  patronId: string;
  sessionHistory?: Array<{ role: string; content: string }>;
}

export interface CompanionChunk {
  type: 'text_delta' | 'text' | 'audio' | 'viseme' | 'tool_result' | 'book_card' | 'companion_done';
  data: any;
}

interface CompanionToolCall {
  name: string;
  args: Record<string, any>;
  /** true = native function call (bind by schema); false = regex-detected tool JSON */
  native: boolean;
}

export async function* processCompanionMessage(
  input: CompanionMessageInput,
): AsyncGenerator<CompanionChunk> {
  const memoryService = new MemoryService();
  const ttsClient = new TTSClient();

  let message = input.message || '';

  if (input.audioBase64 && !message) {
    const { ASRClient } = await import('../clients/ASRClient');
    const asrClient = new ASRClient();
    const audioBuffer = Buffer.from(input.audioBase64, 'base64');
    const result = await asrClient.transcribeAudio(audioBuffer);
    message = result.transcript;
    yield { type: 'text', data: { content: `[Voice] ${message}` } };
  }

  let memories: Record<string, string> = {};
  try {
    memories = await memoryService.getMemoriesForPatron(input.patronId);
  } catch (e) {
    console.warn('[Companion] getMemoriesForPatron failed, using empty:', (e as Error).message);
    memories = {};
  }
  const memoryContext = Object.entries(memories)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

  const contextDocs = await retrieve(message, 5, input.role);
  const availableTools = getToolDefsForRole(input.role);

  const evidenceCheck = evaluateEvidence(message, contextDocs);
  if (!evidenceCheck.passed && evidenceCheck.abstainMessage) {
    const abstainText = evidenceCheck.abstainMessage;
    const ttsResult = await ttsClient.synthesizeSpeech(abstainText);
    yield { type: 'text', data: { content: abstainText, final: true } };
    yield { type: 'audio', data: { audioBase64: ttsResult.audioBase64, durationMs: ttsResult.durationMs } };
    yield { type: 'viseme', data: { visemes: ttsResult.visemes } };
    yield { type: 'companion_done', data: { sessionId: input.sessionId } };
    return;
  }

  let systemPrompt = buildSystemPrompt(contextDocs, {
    userId: input.patronId,
    email: '',
    role: input.role,
  }, availableTools);

  if (memoryContext) {
    systemPrompt += `\n\nLong-term Memory:\n${memoryContext}`;
  }

  const messages: Array<{ role: ChatRole; content: string }> = [
    { role: 'system', content: systemPrompt },
  ];

  if (input.sessionHistory && input.sessionHistory.length > 0) {
    for (const msg of input.sessionHistory.slice(-10)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role as ChatRole, content: msg.content });
      }
    }
  }

  messages.push({ role: 'user', content: message });

  let maxIterations = 3;
  let toolResults: Array<{ name: string; result: any }> = [];

  while (maxIterations > 0) {
    maxIterations--;

    // ---- Native function calling with graceful degradation ------------------
    // The client yields tokens as they arrive. A tool-call answer produces no visible
    // text (native `tool_calls` live in a separate field, and the degraded path buffers
    // server-side), so tool-call JSON can never reach the UI as a `text_delta`.
    let fullText = '';
    let nativeToolCalls: NativeToolCall[] = [];
    let streamedSoFar = '';
    let suppressDeltas = false;

    for await (const event of nvidiaClient.streamChatCompletion(messages, {
      temperature: contextDocs.length > 0 ? 0.3 : 0.7,
      maxTokens: 2048,
      tools: toOpenAITools(availableTools),
    })) {
      if (event.type === 'text_delta') {
        streamedSoFar += event.content;
        if (suppressDeltas) continue;
        if (/\{\s*"\s*tool\s*"/i.test(streamedSoFar) || streamedSoFar.includes('functions.') || streamedSoFar.includes('<tool_call>')) {
          suppressDeltas = true;
          continue;
        }
        yield { type: 'text_delta', data: { content: event.content } };
      } else {
        fullText = event.content;
        nativeToolCalls = event.toolCalls;
      }
    }

    if (fullText.trim()) messages.push({ role: 'assistant', content: fullText });

    // Native calls bind arguments by declared schema order; regex-detected calls keep
    // the legacy `Object.values()` contract.
    const toolCalls: CompanionToolCall[] =
      nativeToolCalls.length > 0
        ? nativeToolCalls.map(tc => ({ name: tc.name, args: tc.args, native: true }))
        : parseToolCalls(fullText || '').map(tc => ({ name: tc.name, args: tc.args, native: false }));

    // A native tool call may legitimately arrive with EMPTY content — so the branch on
    // tool calls only, never on whether text was produced.
    if (toolCalls.length === 0) {
      const sanitized = sanitizeNaturalResponse(fullText || '');
      const formatted = formatScheduleJson(
        sanitized ||
          summariseToolResults(toolResults) ||
          'Xin lỗi, tôi chưa thể diễn giải thông tin này lúc này. Vui lòng thử lại.',
      );
      const finalResponse = validateCitations(formatted, contextDocs).text;

      const ttsResult = await ttsClient.synthesizeSpeech(finalResponse);

      // `final: true` marks this chunk as the authoritative full answer so clients can
      // replace whatever they streamed token-by-token instead of appending to it.
      yield { type: 'text', data: { content: finalResponse, final: true } };
      yield { type: 'audio', data: { audioBase64: ttsResult.audioBase64, durationMs: ttsResult.durationMs } };
      yield { type: 'viseme', data: { visemes: ttsResult.visemes } };

      const bookCard = parseBookCard(finalResponse);
      if (bookCard) {
        yield { type: 'book_card', data: bookCard };
      }

      memoryService.consolidateNewMemories(input.patronId, [
        { role: 'user', content: message },
        { role: 'assistant', content: finalResponse },
      ]).catch(() => {});

      yield { type: 'companion_done', data: { sessionId: input.sessionId } };
      return;
    }

    const callsToProcess = toolCalls.slice(0, 1);

    for (const call of callsToProcess) {
      const tool = availableTools.find(t => t.name === call.name);

      if (!tool) {
        toolResults.push({
          name: call.name,
          result: { error: `Unknown tool: ${call.name}. Access denied for role: ${input.role}` },
        });
        messages.push({
          role: 'user',
          content: `[He thong] Tool "${call.name}" không tồn tại hoac ban khong co quyen su dung. Chi su dung cac tool: ${availableTools.map(t => t.name).join(', ')}`,
        });
        continue;
      }

      try {
        const fn = tool.func as (...args: any[]) => any;

        let result: any;
        if (tool.injectUserId) {
          // Server-side identity always wins — never trust a model-supplied id.
          result = await fn(input.patronId);
        } else if (call.native) {
          // Native function call: bind by declared schema order and validate required args.
          result = await fn(...bindToolArgs(tool, call.args));
        } else {
          // Legacy regex-detected tool JSON.
          result = await fn(...Object.values(call.args));
        }

        toolResults.push({ name: call.name, result });

        yield { type: 'tool_result', data: { name: call.name, result } };

        const resultStr = JSON.stringify(result, null, 2);
        let resultForPrompt = resultStr;
        if (call.name === 'get_library_hours') {
          resultForPrompt = `Thứ Hai - Thứ Sáu: 06:30 - 21:00\nThứ Bảy - Chủ Nhật: 08:00 - 19:30\n(Lưu ý: Giờ mở cửa có thể thay đổi vào ngày lễ và kỳ nghỉ đặc biệt)`;
          if (contextDocs.length > 0) {
            resultForPrompt += `\n(Luu y bo sung: Kiem tra Knowledge Base Context de cap nhat neu co lich mo cua dac biet hoac quy dinh moi nhat.)`;
          }
        }
        messages.push({
          role: 'user',
          content: `[He thong] Ket qua tu tool "${call.name}":\n${resultForPrompt}\n\nDua tren ket qua tren, tra loi nguoi dung bang tieng Viet tu nhien (TUYET DOI KHONG tra ve raw JSON hay ma nguon). Neu da co du thong tin, tong hop va tra loi. Neu can them thong tin, goi tool tiep theo.`,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        const errorResult = { error: errorMsg };
        toolResults.push({ name: call.name, result: errorResult });
        // Surface a structured error to the client instead of failing the whole turn.
        yield { type: 'tool_result', data: { name: call.name, result: errorResult } };
        messages.push({
          role: 'user',
          content: `[He thong] Loi khi goi tool "${call.name}": ${errorMsg}`,
        });
      }
    }
  }

  yield { type: 'text', data: { content: 'Da dat den gioi han so buoc xu ly. Vui long thu lai voi cau hoi ngan hon.', final: true } };
  yield { type: 'companion_done', data: { sessionId: input.sessionId } };
}

export default { processMessage, processCompanionMessage };
