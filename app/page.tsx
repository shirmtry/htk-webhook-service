import Link from 'next/link';
import { getUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const FEATURES = [
  {
    title: 'HMAC + timestamp',
    body: 'Mỗi request được ký HMAC-SHA256 trên timestamp và raw body. Lệch quá 5 phút hoặc sai chữ ký bị từ chối trước khi chạm hàng đợi.',
  },
  {
    title: 'Idempotency key',
    body: 'Sender gửi x-idempotency-key. Cùng key trong cùng endpoint trả lại event cũ với duplicate=true, không tạo lần giao thứ hai.',
  },
  {
    title: 'Backoff + jitter',
    body: 'Lịch thử 10s → 30s → 2m → 5m → 15m, mỗi bậc lệch ±20% để nhiều event lỗi không dồn thành một cơn bão.',
  },
  {
    title: 'DLQ và replay',
    body: 'Sau 5 lần thất bại, event vào DLQ. Replay reset bộ đếm, giữ payload và idempotency key, ghi audit kèm actor.',
  },
  {
    title: 'Xoay secret',
    body: 'Tạo secret mới, secret cũ còn hiệu lực 24 giờ để phía gửi chuyển tiếp mà không mất event nào.',
  },
  {
    title: 'Rate limit theo endpoint',
    body: 'Cửa sổ 1 phút cho từng endpoint, vượt hạn trả 429 kèm Retry-After. Endpoint paused ngừng nhận nhưng giữ event cũ.',
  },
];

export default async function HomePage() {
  const user = await getUser();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 pb-20 pt-10 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-accent/15 text-lg font-black text-accent">
            H
          </span>
          <div>
            <p className="text-sm font-semibold tracking-wide text-slate-200">HTK Hooks</p>
            <p className="text-xs text-slate-500">Webhook control plane</p>
          </div>
        </div>
        <nav className="flex items-center gap-2">
          {user ? (
            <Link className="btn-ghost" href="/workspace">
              Mở workspace
            </Link>
          ) : (
            <>
              <Link className="btn-ghost" href="/register">
                Đăng ký
              </Link>
              <Link className="btn-primary" href="/login">
                Đăng nhập
              </Link>
            </>
          )}
        </nav>
      </header>

      <section className="mt-16 max-w-3xl">
        <span className="badge border-accent/40 text-accent">Next.js · PGlite · HMAC · Retry engine</span>
        <h1 className="mt-5 text-4xl font-semibold leading-tight sm:text-5xl">
          Webhook không còn là hộp đen,
          <span className="text-accent"> mỗi lần giao đều nhìn thấy</span>.
        </h1>
        <p className="mt-5 text-base leading-relaxed text-slate-300 sm:text-lg">
          Nhận sự kiện có chữ ký, chống trùng, retry theo backoff + jitter, đẩy vào DLQ khi bỏ cuộc và
          replay bằng một nút. Debug console hiện payload, HTTP code, response body và thời gian từng lần thử.
        </p>
        <div className="mt-7 flex flex-wrap gap-3">
          <Link className="btn-primary" href={user ? '/workspace' : '/login'}>
            {user ? 'Mở workspace' : 'Thử bản demo'}
          </Link>
          <Link className="btn-ghost" href="/register">
            Tạo tài khoản
          </Link>
        </div>
        <div className="mt-8 rounded-xl border border-line bg-panel/50 px-4 py-3 text-sm">
          <p className="font-semibold text-slate-200">Tài khoản demo</p>
          <p className="mt-1 font-mono text-xs text-accent">demo@htk.dev · Demo12345!</p>
          <p className="mt-1 text-xs text-slate-400">
            3 endpoint: billing đang có event chờ worker, CRM có DLQ và secret vừa xoay, OCR đang tạm dừng.
          </p>
        </div>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Tính năng">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="card">
            <h2 className="text-base font-semibold text-slate-100">{feature.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">{feature.body}</p>
          </article>
        ))}
      </section>

      <section className="mt-14 grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="card">
          <h2 className="text-lg font-semibold">Một sự kiện đi qua hệ thống thế nào?</h2>
          <ol className="mt-4 space-y-3 text-sm text-slate-300">
            {[
              'Sender POST tới /api/ingest/:slug kèm timestamp, chữ ký và idempotency key.',
              'Server kiểm tra HMAC, cửa sổ 5 phút, rate limit của endpoint rồi chống trùng theo key.',
              'Event được ghi vào PGlite; worker gọi target ngay và lưu HTTP code, body, thời gian.',
              'Nếu lỗi, event hẹn lần thử kế tiếp bằng backoff + jitter; chạm max_attempts thì vào DLQ.',
              'Chủ endpoint đọc timeline, replay một event hoặc xoay secret mà không mất sự kiện.',
            ].map((step, index) => (
              <li key={step} className="flex gap-3">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
        <div className="card">
          <h2 className="text-lg font-semibold">Sandbox hay live?</h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            Endpoint <span className="text-slate-200">sandbox</span> không gọi mạng: upstream mô phỏng trả 500
            hai lần đầu rồi 200, đủ để thấy retry, DLQ và replay một cách tất định. Endpoint{' '}
            <span className="text-slate-200">live</span> gọi URL thật với timeout 5 giây, ký lại payload và
            chặn host nội bộ.
          </p>
          <p className="mt-4 text-xs text-slate-500">
            Trên serverless, worker chạy ngay sau ingest và qua endpoint cron. Ở production nên tách queue
            thật để không phụ thuộc thời gian sống của lambda.
          </p>
        </div>
      </section>

      <footer className="mt-16 border-t border-line pt-6 text-sm text-slate-500">
        <p>
          Tác giả <span className="text-slate-300">HTK 0396241674</span> · Dự án 07/10 trong portfolio
          full-stack.
        </p>
      </footer>
    </main>
  );
}
