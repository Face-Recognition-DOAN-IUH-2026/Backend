"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processMessage = processMessage;
const nvidia_1 = require("../clients/nvidia");
const tools_1 = require("../tools/tools");
const retriever_1 = require("../rag/retriever");
function buildToolsDescription() {
    return tools_1.tools
        .map(t => `- ${t.name}: ${t.description}`)
        .join('\n');
}
function buildSystemPrompt(contextDocuments, userContext) {
    const kbContext = contextDocuments.length > 0
        ? `\n\nKnowledge Base Context:\n${contextDocuments.map(d => `[${d.docTitle}] ${d.content}`).join('\n\n')}`
        : '';
    let userContextPrompt = '';
    if (userContext) {
        if (userContext.role === 'patron') {
            userContextPrompt = `
NGƯỜI DÙNG HIỆN TẠI:
- Vai trò: Độc giả (patron)
- Mã thẻ: ${userContext.userId}
- Họ tên: ${userContext.fullName || 'Chưa cập nhật'}
- Email: ${userContext.email}

QUY TẮC CHO PATRON:
- LUÔN sử dụng mã thẻ trên khi gọi tool (get_patron_info, get_patron_borrows, get_patron_history, etc.)
- CHỈ hiển thị dữ liệu CỦA CHÍNH NGƯỜI DÙNG NÀY
- KHÔNG BAO GIỜ hiển thị dữ liệu của người khác
- Khi người dùng hỏi "lịch sử mượn" hoặc "đã mượn những gì", dùng tool get_patron_history
- Khi người dùng hỏi "đang mượn" hoặc "sách đang giữ", dùng tool get_patron_borrows`;
        }
        else {
            userContextPrompt = `
NGƯỜI DÙNG HIỆN TẠI:
- Vai trò: Nhân viên (${userContext.role})
- Mã nhân viên: ${userContext.userId}
- Họ tên: ${userContext.fullName || 'Chưa cập nhật'}
- Email: ${userContext.email}

QUY TẮC CHO NHÂN VIÊN:
- CHỈ được tra cứu CỦA CHÍNH MÌNH hoặc theo yêu cầu của độc giả (yêu cầu mã thẻ hoặc mã số sinh viên)
- CHỈ sử dụng các tool READ-ONLY (tra cứu, tìm kiếm, xem lịch sử)
- KHÔNG thực hiện bất kỳ thao tác ghi/xóa/sửa nào qua AI`;
        }
    }
    return `Bạn là trợ lý thư viện của IUH (Viện Đào tạo Quốc tế - Đại học Công nghệ TP.HCM), tên "TVTL" (Trợ lý Vi tính Thư viện).

Nhiệm vụ chính:
- Trả lời câu hỏi về thư viện (giờ mở cửa, quy định, chính sách)
- Hỗ trợ tìm kiếm sách và thông tin tài liệu
- Tư vấn lịch trực và báo cáo
- Hướng dẫn sử dụng thư viện

Nguyên tắc quan trọng:
1. LUÔN trả lời bằng tiếng Việt, thân thiện và chuyên nghiệp
2. Sử dụng ngữ cảnh từ Knowledge Base khi có sẵn
3. Nếu cần thông tin từ hệ thống, chỉ sử dụng các công cụ được cung cấp (KHÔNG tự invent thông tin)
4. KHÔNG BAO GIỜ thực hiện các thao tác ghi/xóa/sửa (write/delete/update) — AI chỉ hỗ trợ tra cứu (read-only)
5. Nếu người dùng yêu cầu thêm/xóa/sửa dữ liệu, từ chối và hướng dẫn họ thực hiện trực tiếp trên giao diện thư viện

CÁCH GỌI TOOL (QUAN TRỌNG - PHẢI TUÂN THỦ ĐÚNG FORMAT):
Khi cần gọi tool, bạn PHẢI trả về đúng format JSON sau:
{"tool": "ten_tool", "arguments": {"param1": "value1", "param2": "value2"}}

Ví dụ:
- Để tìm sách: {"tool": "search_books", "arguments": {"query": "Clean Code"}}
- Để tra cứu sách: {"tool": "lookup_book", "arguments": {"isbn_or_query": "9780132350884"}}

KHÔNG BAO GIỜ trả về JSON mà không có key "tool". Nếu không gọi tool, hãy trả lời bằng tiếng Việt bình thường.

Các công cụ có sẵn (tất cả đều là READ-ONLY):
${buildToolsDescription()}

FORMAT CARD SÁCH (QUAN TRỌNG - phải đúng format để frontend hiển thị đẹp):
Khi hiển thị thông tin sách, PHẢI dùng đúng format sau:
:::book_card
{"title": "Tên sách", "author": "Tác giả", "isbn": "ISBN", "categories": "Thể loại", "description": "Mô tả", "cover_url": "URL ảnh", "source": "database hoặc google_books"}
:::

Ví dụ:
:::book_card
{"title": "Clean Code", "author": "Robert C. Martin", "isbn": "9780132350884", "categories": "Computers", "description": "This title shows the process of cleaning code...", "cover_url": "http://books.google.com/books/content?id=...", "source": "google_books"}
:::

KHÔNG BAO GIỜ hiển thị thông tin sách bằng text thuần. Luôn dùng format :::book_card ở trên.

Hướng dẫn sử dụng tool:
- Đọc kết quả tool và quyết định: trả lời trực tiếp HOẶC gọi thêm tool
- Khi đã có đủ thông tin, trả lời tổng hợp cho người dùng
- NHỚ: AI KHÔNG có quyền ghi/xóa/sửa — chỉ tra cứu
${userContextPrompt}
${kbContext}`;
}
function parseToolCalls(assistantMessage) {
    const toolCalls = [];
    // Format 1: {"tool": "name", "arguments": {...}}
    const jsonRegex = /\{"tool"\s*:\s*"(\w+)"\s*,\s*"arguments"\s*:\s*(\{[^}]*\})\}/g;
    let match;
    while ((match = jsonRegex.exec(assistantMessage)) !== null) {
        try {
            const args = JSON.parse(match[2]);
            toolCalls.push({ name: match[1], args });
        }
        catch { }
    }
    if (toolCalls.length > 0)
        return toolCalls;
    // Format 2: functions.search_books<|tool_call_argument_begin|>{"query": "..."}<|tool_call_end|>
    const nimRegex = /functions\.(\w+)<\|tool_call_argument_begin\|>(\{[^<]*\})<\|tool_call_end\|>/g;
    while ((match = nimRegex.exec(assistantMessage)) !== null) {
        try {
            const args = JSON.parse(match[2]);
            toolCalls.push({ name: match[1], args });
        }
        catch { }
    }
    if (toolCalls.length > 0)
        return toolCalls;
    // Format 3: <tool_call>name {args}</tool_call>
    const tagRegex = /<tool_call>\s*(\w+)\s*\{\s*([^}]+)\s*\}/g;
    while ((match = tagRegex.exec(assistantMessage)) !== null) {
        const toolName = match[1];
        const argsStr = match[2];
        const args = {};
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
    if (toolCalls.length > 0)
        return toolCalls;
    // Format 4: Bare JSON with known tool param patterns (fallback)
    const bareJsonMatch = assistantMessage.match(/^\s*(\{[^}]+\})\s*$/);
    if (bareJsonMatch) {
        try {
            const parsed = JSON.parse(bareJsonMatch[1]);
            if (parsed.isbn_or_title || parsed.query || parsed.isbn || parsed.title) {
                if (parsed.isbn_or_title) {
                    toolCalls.push({ name: 'lookup_book', args: { isbn_or_query: parsed.isbn_or_title } });
                }
                else if (parsed.query) {
                    toolCalls.push({ name: 'search_books', args: { query: parsed.query } });
                }
            }
        }
        catch { }
    }
    return toolCalls;
}
async function processMessage(message, sessionId, patronId, sessionHistory, userContext) {
    const contextDocs = await (0, retriever_1.retrieve)(message, 5);
    const systemPrompt = buildSystemPrompt(contextDocs, userContext);
    const messages = [
        { role: 'system', content: systemPrompt },
    ];
    if (sessionHistory && sessionHistory.length > 0) {
        for (const msg of sessionHistory.slice(-10)) {
            if (msg.role === 'user' || msg.role === 'assistant') {
                messages.push({ role: msg.role, content: msg.content });
            }
        }
    }
    messages.push({ role: 'user', content: message });
    let maxIterations = 3;
    let toolResults = [];
    while (maxIterations > 0) {
        maxIterations--;
        const response = await nvidia_1.nvidiaClient.createChatCompletion(messages, {
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
                        if (data.length === 0)
                            return `Không tìm thấy kết quả từ ${t.name}.`;
                        return `Từ ${t.name}: ${data.length} kết quả.`;
                    }
                    return `Kết quả từ ${t.name}.`;
                })
                    .join('\n');
                finalResponse = toolSummary || 'Đã truy vấn xong.';
            }
            if (!finalResponse) {
                finalResponse = 'Xin lỗi, tôi đã gặp sự cố khi xử lý câu hỏi của bạn. Vui lòng thử lại.';
            }
            return {
                response: finalResponse,
                toolResults: toolResults.length > 0 ? toolResults : undefined,
                sessionId,
            };
        }
        const callsToProcess = toolCalls.slice(0, 1);
        for (const call of callsToProcess) {
            const tool = tools_1.tools.find(t => t.name === call.name);
            if (!tool) {
                toolResults.push({
                    name: call.name,
                    result: { error: `Unknown tool: ${call.name}` },
                });
                messages.push({
                    role: 'user',
                    content: `[Hệ thống] Tool "${call.name}" không tồn tại. Chỉ sử dụng các tool có sẵn: ${tools_1.tools.map(t => t.name).join(', ')}`,
                });
                continue;
            }
            try {
                const fn = tool.func;
                const argValues = Object.values(call.args);
                const result = await fn(...argValues);
                toolResults.push({ name: call.name, result });
                const resultStr = JSON.stringify(result, null, 2);
                messages.push({
                    role: 'user',
                    content: `[Hệ thống] Kết quả từ tool "${call.name}":\n${resultStr}\n\nDựa trên kết quả trên, hãy trả lời người dùng bằng tiếng Việt. Nếu đã có đủ thông tin, hãy tổng hợp và trả lời. Nếu cần thêm thông tin, hãy gọi tool tiếp theo.`,
                });
            }
            catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                toolResults.push({ name: call.name, result: { error: errorMsg } });
                messages.push({
                    role: 'user',
                    content: `[Hệ thống] Lỗi khi gọi tool "${call.name}": ${errorMsg}`,
                });
            }
        }
    }
    return {
        response: 'Đã đạt đến giới hạn số bước xử lý. Vui lòng thử lại với câu hỏi ngắn hơn.',
        toolResults,
        sessionId,
    };
}
exports.default = { processMessage };
