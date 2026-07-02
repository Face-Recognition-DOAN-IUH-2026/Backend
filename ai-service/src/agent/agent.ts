import { nvidiaClient } from '../clients/nvidia';
import { ToolDef, patronToolDefs, getToolDefsForRole } from '../tools/registry';
import { retrieve, RetrievedDocument } from '../rag/retriever';

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

function buildSystemPrompt(
  contextDocuments: RetrievedDocument[],
  userContext?: UserContext,
  availableTools: ToolDef[] = patronToolDefs,
): string {
  const kbContext = contextDocuments.length > 0
    ? `\n\nKnowledge Base Context:\n${contextDocuments.map(d => `[${d.docTitle}] ${d.content}`).join('\n\n')}`
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

  return `Ban la tro ly thu vien cua IUH (Vien Dao tao Quoc te - Dai hoc Cong nghe TP.HCM), ten "TVTL".

Nhiem vu chinh:
- Tra loi cau hoi ve thu vien (gio mo cua, quy dinh, chinh sach)
- Ho tro tim kiem sach va thong tin tai lieu
- Tu van lich truc va bao cao
- Huong dan su dung thu vien

Nguyen tac quan trong:
1. LUON tra loi bang tieng Viet, than thi va chuyen nghiep
2. Su dung ngu canh tu Knowledge Base khi co san
3. Neu can thong tin tu he thong, chi su dung cac cong cu duoc cung cap (KHONG tu invent thong tin)
4. KHONG BAO GIO thuc hien cac thao tac ghi/xoa/sua (write/delete/update) — AI chi ho tro tra cuu (read-only)
5. Neu nguoi dung yeu cau them/xoa/sua du lieu, tu choi va huong dan ho thuc hien truc tiep tren giao dien

CAC TOOL CO SAN (READ-ONLY):
${buildToolsDescription(availableTools)}

KHI CAN GOI TOOL, tra ve dung format JSON:
{"tool": "ten_tool", "arguments": {"param1": "value1"}}
KHONG BAO GIO tra ve JSON ma khong co key "tool". Neu khong goi tool, tra loi bang tieng Viet binh thuong.

Khi da co du thong tin, tong hop va tra loi nguoi dung.
${userContextPrompt}
${kbContext}`;
}

function parseToolCalls(assistantMessage: string): Array<{ name: string; args: Record<string, any> }> {
  const toolCalls: Array<{ name: string; args: Record<string, any> }> = [];

  const jsonRegex = /\{"tool"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\}/g;
  let match;

  while ((match = jsonRegex.exec(assistantMessage)) !== null) {
    try {
      const args = JSON.parse(match[2]);
      toolCalls.push({ name: match[1], args });
    } catch {}
  }

  if (toolCalls.length > 0) return toolCalls;

  const nimRegex = /functions\.(\w+)<\|tool_call_argument_begin\|>(\{[^<]*\})<\|tool_call_end\|>/g;
  while ((match = nimRegex.exec(assistantMessage)) !== null) {
    try {
      const args = JSON.parse(match[2]);
      toolCalls.push({ name: match[1], args });
    } catch {}
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
    } catch {}
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

  const contextDocs = await retrieve(message, 5);
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

    const response = await nvidiaClient.createChatCompletion(messages, {
      temperature: 0.7,
      maxTokens: 2048,
    });

    messages.push({ role: 'assistant', content: response });

    const toolCalls = parseToolCalls(response || '');

    if (!response || toolCalls.length === 0) {
      let finalResponse = (response || '').trim();
      if (!finalResponse && toolResults.length > 0) {
        const toolSummary = toolResults
          .filter(t => t.result?.success && t.result?.data)
          .map(t => {
            const data = t.result.data;
            if (Array.isArray(data)) {
              if (data.length === 0) return `Khong tim thay ket qua tu ${t.name}.`;
              return `Tu ${t.name}: ${data.length} ket qua.`;
            }
            return `Ket qua tu ${t.name}.`;
          })
          .join('\n');
        finalResponse = toolSummary || 'Da truy van xong.';
      }
      if (!finalResponse) {
        finalResponse = 'Xin loi, toi da gap su co khi xu ly cau hoi cua ban. Vui long thu lai.';
      }
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
          content: `[He thong] Tool "${call.name}" khong ton tai hoac ban khong co quyen su dung. Chi su dung cac tool: ${availableTools.map(t => t.name).join(', ')}`,
        });
        continue;
      }

      try {
        const fn = tool.func as (...args: any[]) => any;

        let result: any;
        if (tool.injectUserId && userContext) {
          result = await fn(userContext.userId);
        } else {
          const argValues = Object.values(call.args);
          result = await fn(...argValues);
        }

        toolResults.push({ name: call.name, result });

        const resultStr = JSON.stringify(result, null, 2);
        messages.push({
          role: 'user',
          content: `[He thong] Ket qua tu tool "${call.name}":\n${resultStr}\n\nDua tren ket qua tren, tra loi nguoi dung bang tieng Viet. Neu da co du thong tin, tong hop va tra loi. Neu can them thong tin, goi tool tiep theo.`,
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

export default { processMessage };
