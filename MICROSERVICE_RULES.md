# Nguyên tắc Microservice Architecture

## 1. Edge và API Gateway
- Nginx là public edge duy nhất được publish ra host.
- Mọi request HTTP API từ **external client** (FE, mobile) phải qua API Gateway.
- Realtime WebSocket/STOMP đi qua Nginx và được route trực tiếp tới Realtime Service.
- Không expose port service ra ngoài trực tiếp; các service chỉ listen trên internal network (Docker internal).

## 2. Gateway không gọi trực tiếp Infrastructure
- ❌ Sai: Gateway → Redis / DB / Cloudinary / S3 / ...
- ✅ Đúng: Gateway → Service → Infrastructure
- Gateway chỉ giao tiếp với service qua REST/GraphQL

## 3. Service-to-Service Communication
- **Đồng bộ (sync):** Gọi REST trực tiếp trong internal network (Docker)
  - Ví dụ: Chat Service → Realtime Service, không qua Gateway
- **Bất đồng bộ (async):** Qua Message Broker (RabbitMQ)
  - Ví dụ: Auth Service → RabbitMQ → Chat Service (user.created event)
- Service không gọi nhau qua API Gateway (tránh circular dependency)

## 4. Internal API Key pattern
- Service-to-service calls dùng header `x-internal-api-key`
- Không dùng JWT user token cho internal calls
- Key là shared secret giữa các service (cấu hình qua env)
- Validation: kiểm tra API key trước khi xử lý internal request

## 5. Mỗi service owns data riêng
- Auth Service: `auth_service` DB (users, friends, blocks, refresh_tokens)
- Chat Service: `chat_service` DB (conversations, messages, message_attachments)
- Không share database giữa các service
- Service A muốn data của Service B → gọi REST API, không query trực tiếp DB

## 6. Shared state qua Redis
- Presence/online status → Realtime Service quản lý Redis cho WebSocket sessions; Auth Service có thể cung cấp presence API nếu cần.
- Message cache → Chat Service quản lý Redis.
- API Gateway không kết nối Redis/DB/Cloudinary; rate limit ở Gateway dùng local in-memory store hoặc đẩy xuống edge/service chuyên trách.
- Mỗi service có Redis connection riêng (hoặc dùng chung Redis instance với key prefix).

## 7. Cấu hình qua Environment Variables
- Mọi config phải qua env vars, không hardcode
- File `.env.example` ở mỗi service document đủ các biến
- Docker Compose là single source of truth cho tất cả env

## 8. Service có health / ready endpoint
- Mỗi service có `GET /health` (simple alive check)
- Mỗi service có `GET /ready` (check dependencies: DB, Redis, RabbitMQ)
- Gateway / Orchestrator dùng health check để route traffic

## 9. Input validation ở mỗi service
- Mỗi service tự validate input của nó (defense in depth)
- Không tin tưởng Gateway đã validate hết
- Dùng `express-validator` pattern hiện có

## 10. Graceful shutdown
- Mỗi service phải handle `SIGTERM` signal
- Đóng connection (DB, Redis, RabbitMQ) trước khi exit
- Dùng `process.on('SIGTERM', async () => { ... })`

## 11. Service không publish port ra ngoài
- Chỉ Nginx publish port ra host (Docker: `ports: - "4321:80"` hoặc map qua biến `NGINX_HTTP_PORT`).
- Service khác chỉ communication qua internal Docker network.
- Nếu cần expose để debug -> ghi chú rõ trong docker-compose.

## 12. Service URL qua Environment Variables
- Khi Service A gọi Service B, URL của B phải qua env var
- ❌ Sai: hardcode `http://realtime-service:8080` trong code
- ✅ Đúng: `process.env.REALTIME_SERVICE_URL || 'http://realtime-service:8080'`
