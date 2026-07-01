"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenRouterClient = void 0;
const zod_1 = require("zod");
const config_1 = require("../config");
const shared_1 = require("../../../shared");
const analysisSchema = zod_1.z.object({
    headline: zod_1.z.string().min(1),
    operational_score: zod_1.z.number().min(0).max(100),
    insights: zod_1.z.array(zod_1.z.object({
        category: zod_1.z.enum(['access', 'borrow', 'schedule', 'inventory', 'risk']),
        severity: zod_1.z.enum(['info', 'warning', 'critical']),
        title: zod_1.z.string().min(1),
        summary: zod_1.z.string().min(1),
        evidence: zod_1.z.array(zod_1.z.object({
            label: zod_1.z.string(),
            value: zod_1.z.union([zod_1.z.string(), zod_1.z.number()]),
        })).default([]),
        recommended_actions: zod_1.z.array(zod_1.z.string()).default([]),
        reason: zod_1.z.string().default(''),
        confidence: zod_1.z.number().min(0).max(1).default(0.85),
        alternatives: zod_1.z.array(zod_1.z.string()).default([]),
    })).default([]),
});
function extractJson(text) {
    const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    return JSON.parse(cleaned);
}
async function throwOpenRouterError(res) {
    const detail = (await res.text()).slice(0, 300);
    if (res.status === 401) {
        throw new shared_1.HttpError(502, 'OpenRouter authentication failed (401). Check OPENROUTER_API_KEY in Backend/.env.');
    }
    if (res.status === 402) {
        throw new shared_1.HttpError(502, 'OpenRouter billing/credits issue (402). Check your OpenRouter account credits.');
    }
    if (res.status === 404) {
        throw new shared_1.HttpError(502, `OpenRouter model not found (404). Check OPENROUTER_MODEL. ${detail}`);
    }
    throw new shared_1.HttpError(502, `OpenRouter returned ${res.status}. ${detail}`);
}
class OpenRouterClient {
    async analyze(snapshot) {
        if (config_1.config.ai.mockMode)
            return this.mockAnalyze(snapshot);
        if (!config_1.config.openRouter.apiKey) {
            throw new shared_1.HttpError(503, 'OPENROUTER_API_KEY is not configured. Set AI_MOCK_MODE=true for offline demo.');
        }
        const started = Date.now();
        const makeRequest = async (withResponseFormat) => {
            const body = {
                model: config_1.config.openRouter.model,
                temperature: 0.2,
                messages: [
                    {
                        role: 'system',
                        content: [
                            'Ban la AI Command Center cho thu vien dai hoc.',
                            'Chi duoc dua ra nhan dinh dua tren snapshot duoc cung cap.',
                            'Tra loi bang JSON strict voi fields: headline, operational_score, insights.',
                            'insights toi da 5 item, tieng Viet co dau, ngan gon, hanh dong ro rang.',
                            'Moi insight can co reason (giai thich tai sao dua ra nhan dinh nay), confidence (0-1, do tin cay), alternatives (cac hanh dong khac da can nhac).',
                        ].join(' '),
                    },
                    { role: 'user', content: JSON.stringify(snapshot) },
                ],
            };
            if (withResponseFormat) {
                body.response_format = { type: 'json_object' };
            }
            return fetch(`${config_1.config.openRouter.baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config_1.config.openRouter.apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost',
                    'X-Title': 'IUH Library AI Command Center',
                },
                body: JSON.stringify(body),
            });
        };
        let res = await makeRequest(true);
        if (!res.ok) {
            console.warn(`OpenRouter response_format failed (${res.status}), retrying without...`);
            res = await makeRequest(false);
        }
        const latencyMs = Date.now() - started;
        if (!res.ok)
            await throwOpenRouterError(res);
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        if (!content)
            throw new shared_1.HttpError(502, 'OpenRouter returned an empty response');
        const parsed = analysisSchema.parse(extractJson(content));
        return { result: parsed, usage: data.usage || null, latencyMs };
    }
    async chat(question, snapshot, insights) {
        if (config_1.config.ai.mockMode) {
            return {
                model: 'mock',
                answer: `Dựa trên dữ liệu hiện tại: có ${snapshot.active_patrons} độc giả trong thư viện, ${snapshot.active_borrows} lượt mượn đang mở và ${snapshot.scheduled_staff_today} ca trực hôm nay. Câu hỏi "${question}" nên được xử lý bằng cách ưu tiên các cảnh báo đang mở trong AI Command Center.`,
            };
        }
        if (!config_1.config.openRouter.apiKey)
            throw new shared_1.HttpError(503, 'OPENROUTER_API_KEY is not configured.');
        const res = await fetch(`${config_1.config.openRouter.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${config_1.config.openRouter.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'http://localhost',
                'X-Title': 'IUH Library AI Command Center',
            },
            body: JSON.stringify({
                model: config_1.config.openRouter.model,
                temperature: 0.2,
                messages: [
                    { role: 'system', content: 'Tra loi tieng Viet ngan gon. Chi dua tren snapshot va insights duoc cung cap. Neu thieu du lieu, noi ro thieu du lieu.' },
                    { role: 'user', content: JSON.stringify({ question, snapshot, insights }) },
                ],
            }),
        });
        if (!res.ok)
            await throwOpenRouterError(res);
        const data = await res.json();
        return { answer: data.choices?.[0]?.message?.content || 'Không có câu trả lời.', model: config_1.config.openRouter.model };
    }
    async mockAnalyze(snapshot) {
        const insights = [];
        if (snapshot.active_patrons >= 20) {
            insights.push({
                category: 'access',
                severity: 'warning',
                title: 'Lượng độc giả trong thư viện đang cao',
                summary: `Hiện có ${snapshot.active_patrons} độc giả trong thư viện. Nên theo dõi các tầng đông và chuẩn bị hỗ trợ quầy trả sách.`,
                evidence: [{ label: 'Đang trong thư viện', value: snapshot.active_patrons }],
                recommended_actions: ['Kiểm tra camera cổng vào/ra', 'Điều phối staff tới khu vực đông nếu cần'],
                reason: `Số lượng độc giả hiện tại (${snapshot.active_patrons}) vượt ngưỡng an toàn 20 người, dựa trên dữ liệu realtime từ access-service.`,
                confidence: 0.92,
                alternatives: ['Chờ đến khi đông hơn mới can thiệp', 'Tăng cường staff ở quầy mượn thay vì cổng'],
            });
        }
        if (snapshot.overdue_borrows > 0) {
            insights.push({
                category: 'borrow',
                severity: 'critical',
                title: 'Có sách quá hạn cần xử lý',
                summary: `${snapshot.overdue_borrows} sách đang quá hạn trong danh sách mượn hiện tại.`,
                evidence: [{ label: 'Sách quá hạn', value: snapshot.overdue_borrows }],
                recommended_actions: ['Ưu tiên nhắc độc giả quá hạn', 'Kiểm tra dashboard trả sách theo độc giả'],
                reason: `Có ${snapshot.overdue_borrows} đầu sách quá hạn, ảnh hưởng đến khả năng mượn của độc giả khác. Dữ liệu lấy từ borrow-service.`,
                confidence: 0.88,
                alternatives: ['Gửi email nhắc nhở thay vì can thiệp ngay', 'Đợi đến cuối ngày xử lý batch'],
            });
        }
        if (snapshot.scheduled_staff_today === 0) {
            insights.push({
                category: 'schedule',
                severity: 'warning',
                title: 'Chưa có lịch trực hôm nay',
                summary: 'AI không tìm thấy ca trực nào cho hôm nay trong schedule-service.',
                evidence: [{ label: 'Ca trực hôm nay', value: 0 }],
                recommended_actions: ['Mở Lịch trực và phân nhân viên cho các tầng', 'Kiểm tra cấu hình tầng và ca trực'],
                reason: 'Schedule-service trả về 0 ca trực. Có thể chưa ai lên lịch hoặc service chưa đồng bộ dữ liệu.',
                confidence: 0.75,
                alternatives: ['Kiểm tra lại API schedule-service', 'Xem lịch tuần trước để ước lượng'],
            });
        }
        if (snapshot.warnings.length) {
            insights.push({
                category: 'risk',
                severity: 'warning',
                title: 'Một phần dữ liệu vận hành chưa sẵn sàng',
                summary: 'Một vài service không trả dữ liệu, AI đang phân tích trên snapshot chưa đầy đủ.',
                evidence: snapshot.warnings.slice(0, 3).map((warning, index) => ({ label: `Nguồn ${index + 1}`, value: warning })),
                recommended_actions: ['Kiểm tra health các service liên quan', 'Làm mới phân tích sau khi service ổn định'],
                reason: `AI phát hiện ${snapshot.warnings.length} nguồn dữ liệu không phản hồi. Phân tích dựa trên dữ liệu không đầy đủ nên độ chính xác thấp hơn.`,
                confidence: 0.6,
                alternatives: ['Bỏ qua warnings và tiếp tục theo dõi', 'Phân tích thủ công từ dashboard'],
            });
        }
        if (!insights.length) {
            insights.push({
                category: 'risk',
                severity: 'info',
                title: 'Hoạt động đang ổn định',
                summary: 'Chưa phát hiện cảnh báo lớn từ access, mượn trả hoặc lịch trực trong snapshot hiện tại.',
                evidence: [
                    { label: 'Lượt vào hôm nay', value: snapshot.today_entries },
                    { label: 'Lượt ra hôm nay', value: snapshot.today_exits },
                ],
                recommended_actions: ['Tiếp tục theo dõi realtime', 'Làm mới phân tích khi bước sang ca trực mới'],
                reason: 'Tất cả các chỉ số đều trong ngưỡng an toàn. Không phát hiện bất thường từ access, borrow, hay schedule.',
                confidence: 0.95,
                alternatives: ['Chủ động tìm kiếm vấn đề tiềm ẩn', 'Phân tích dữ liệu lịch sử để dự đoán'],
            });
        }
        return {
            result: {
                headline: insights[0].title,
                operational_score: Math.max(45, 92 - snapshot.overdue_borrows * 8 - snapshot.warnings.length * 10),
                insights,
            },
            usage: null,
            latencyMs: 20,
        };
    }
}
exports.OpenRouterClient = OpenRouterClient;
