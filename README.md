# HTK Hooks — webhook delivery control plane

Nhận webhook có chữ ký HMAC, chống trùng, retry backoff + jitter, DLQ và replay, kèm debug console hiển thị từng lần giao.

- **Live:** https://htk-webhook-service.vercel.app
- **Demo:** `demo@htk.dev` / `Demo12345!`
- **Case study:** [`case-study.pdf`](./case-study.pdf)

## Demo

1. Mở https://htk-webhook-service.vercel.app/login và bấm **Dùng tài khoản demo**.
2. Vào endpoint **Billing alerts** → **Hiện** secret → **Gửi sự kiện thử** để xem một event đi qua retry.
3. Bấm **Chạy worker ngay** ở workspace để xử lý event đang đến hạn, rồi mở một event DLQ và **Replay ngay**.

Chạy local:

```bash
cp .env.example .env.local
npm install
npm run dev
# http://localhost:3000
```

## Bài toán

Webhook thường hỏng lặng lẽ: sender nhận 200 nhưng upstream của người nhận lỗi, retry dồn cùng lúc gây bão, event trùng vì mạng đứt sau khi đã ghi, và khi cần điều tra thì không ai biết lần giao thứ ba trả gì. Một control plane tối thiểu phải trả lời được: event này đã giao chưa, thử mấy lần, vì sao bỏ cuộc, replay có an toàn không, và xoay secret mà không mất event.

## Tính năng

- **Ingest có chữ ký:** HMAC-SHA256 trên `timestamp + "." + raw body`, cửa sổ lệch 5 phút, so sánh timing-safe; sai chữ ký bị chặn trước khi ghi event.
- **Idempotency:** `x-idempotency-key` là duy nhất theo endpoint; request lặp trả `200 { duplicate: true }` cùng event id.
- **Rate limit theo endpoint:** cửa sổ 1 phút, vượt hạn trả `429` kèm `Retry-After`.
- **Retry backoff + jitter:** lịch 10s → 30s → 2m → 5m → 15m, lệch ±20% mỗi bậc, tối đa 5 lần.
- **DLQ và replay:** chạm `max_attempts` thì vào DLQ; replay reset bộ đếm, giữ payload và idempotency key, ghi audit kèm actor.
- **Xoay secret:** secret cũ còn hiệu lực 24 giờ để phía gửi chuyển tiếp; log audit cho lần xoay và lần xem secret.
- **Debug console:** URL ingest, secret (ẩn/hiện), snippet Node, payload, HTTP code, response body, thời gian từng attempt, lọc theo trạng thái, gửi test và replay.

## Tech stack và trade-off

| Thành phần | Lựa chọn | Vì sao |
| --- | --- | --- |
| Ứng dụng | Next.js 15 App Router + TypeScript | Một codebase cho API, UI và cron route; deploy Vercel |
| Dữ liệu | PGlite (PostgreSQL WASM) | SQL thật, chạy được local lẫn serverless không cần dịch vụ ngoài |
| Bền vững | JSON snapshot → Vercel Blob private | Giữ dữ liệu qua cold start; đánh đổi là single-writer |
| Bảo mật | HMAC-SHA256 + timing-safe compare | Không phụ thuộc TLS để xác thực nội dung |
| Worker | Gọi ngay sau ingest + endpoint cron | Serverless không có tiến trình nền thường trú |
| Kiểm thử | Vitest + PGlite tạm | Test cả thuần (sign, backoff) lẫn tích hợp (ingest, DLQ, replay) |

Trade-off đáng kể:

- **Không có queue thật.** Attempt chạy trong request và khi gọi worker; nếu lambda chết giữa attempt, event vẫn ở trạng thái queued và lần sweep sau sẽ thử lại. Production nên dùng SQS/pg-boss để tách vòng đời.
- **PGlite + Blob là single-writer.** Phù hợp demo và tải nhỏ; nhiều instance ghi đồng thời có thể ghi đè snapshot. Postgres thật sẽ bỏ được ràng buộc này.
- **Rate limit là per-instance + bảng DB.** Không phải quota toàn cục chính xác dưới tải cao; Redis token bucket là bước tiếp theo.
- **Secret lưu dạng đọc được trong DB demo.** Vì server phải ký và UI cần hiển thị lại; production nên mã hoá at-rest bằng KMS và chỉ hiện một lần.

## Kiến trúc

```
Sender ──POST /api/ingest/:slug──┐
  headers: timestamp, HMAC, idem  │
                                  ▼
                       kiểm tra HMAC + cửa sổ 5 phút
                                  │
                       rate limit theo endpoint (1 phút)
                                  │
                       idempotency key (unique per endpoint)
                                  ▼
                        events (queued) ──► deliver ngay
                                  │              │
                                  │       target sandbox/live
                                  │              │
                                  ▼              ▼
                        deliveries ◄──── HTTP code, body, duration
                                  │
                    lỗi → next_attempt_at = now + backoff(jitter)
                                  │
                    chạm max_attempts → DLQ → replay thủ công
```

Bảng chính: `users`, `sessions`, `endpoints`, `events`, `deliveries`, `audit_logs`, `request_logs`, `rate_limits` (ephemeral).

## API

| Method | Path | Ghi chú |
| --- | --- | --- |
| POST | `/api/auth/login`, `/api/auth/register` | scrypt, session cookie httpOnly, rate limit theo IP |
| GET/POST | `/api/endpoints` | danh sách kèm thống kê, tạo endpoint |
| GET/PATCH | `/api/endpoints/:id` | bundle + events + metrics; đổi trạng thái, rate limit |
| GET | `/api/endpoints/:id/secret` | chỉ chủ sở hữu, có audit |
| POST | `/api/endpoints/:id/rotate` | secret mới + grace 24 giờ |
| POST | `/api/endpoints/:id/test` | ký nội bộ rồi chạy pipeline giao hàng |
| POST | `/api/ingest/:slug` | public, HMAC + idempotency + rate limit |
| GET | `/api/events/:id` | event + toàn bộ attempt |
| POST | `/api/events/:id/replay` | reset attempts, giao lại ngay |
| POST/GET | `/api/jobs/deliver` | user scope hoặc `Bearer CRON_SECRET` |
| GET | `/api/metrics`, `/api/health` | số liệu vận hành, health |

## Kiểm thử

```bash
npm test
```

- `lib/sign.test.ts` — 6 test: định dạng chữ ký, body bị sửa, secret sai, timestamp lệch, secret cũ trong grace.
- `lib/backoff.test.ts` — 5 test: lịch backoff, biên jitter ±20%, chạm max_attempts, DLQ, định dạng chờ.
- `lib/delivery.test.ts` — 12 test tích hợp: seed, ingest + duplicate, sai chữ ký, retry đến thành công, DLQ, rate limit, endpoint paused, xoay secret hết hạn, replay, sweep bỏ qua endpoint paused, chặn SSRF.

Kết quả: **23/23 test pass**, build production sạch.

## Đo lường

Đo trên máy local (Node 24, Windows, `next start`), 30–40 request mỗi loại sau khi PGlite đã khởi động:

| Luồng | p50 | p95 |
| --- | --- | --- |
| `GET /api/endpoints` | 14.68 ms | 21.45 ms |
| `GET /api/metrics` | 14.68 ms | 26.19 ms |
| `GET /api/endpoints/:id` | 15.13 ms | 17.39 ms |
| `GET /api/events/:id` | 14.82 ms | 17.07 ms |
| `POST /api/jobs/deliver` | 14.62 ms | 16.54 ms |
| `POST /api/ingest/:slug` (ký HMAC) | 14.63 ms | 17.13 ms |
| Ingest trùng key | 15.33 ms | 16.51 ms |

- `request_logs` 500 mẫu: p50 **3 ms**, p95 **7 ms** (wrapper + ghi log).
- 40 ingest liên tiếp đều trả `202`, 0 lỗi chữ ký.
- Trạng thái seed: 3 endpoint, 8 event, success rate **60%**, p95 giao hàng **22 ms**.
- Sau benchmark: 51 event, 64 attempt, request p95 **7 ms**.
- Trình duyệt: 0 console error, overflow ngang 0 px ở 375 và 1440.

**Chưa đo:** throughput đồng thời, độ trễ cron thật trên Vercel, độ bền khi lambda bị kill giữa attempt, tải 1.000 event/phút.

## Chạy bằng Docker

```bash
docker build -t htk-webhook-service .
docker run --rm -p 3000:3000 -v htk-hooks-data:/data htk-webhook-service
```

Image dùng `output: standalone`, dữ liệu PGlite ở volume `/data/pg`. Không cần Blob token khi chạy container.

## Giới hạn đã biết

- Email/thông báo khi DLQ chưa có; hiện chỉ hiện trong UI.
- Chưa có retry theo lịch cron tự động trên Vercel — cần cấu hình cron gọi `/api/jobs/deliver` với `CRON_SECRET`.
- Chưa hỗ trợ batch replay nhiều event cùng lúc.
- Secret demo lưu plaintext trong PGlite; xem mục trade-off.
- Live mode chặn host nội bộ theo hostname/IP literal, nhưng chưa chống DNS rebinding.

## Tác giả

HTK 0396241674 — dự án 07/10 trong portfolio full-stack.
