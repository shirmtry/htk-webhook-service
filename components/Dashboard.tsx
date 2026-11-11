'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { formatMs, relative, truncate } from '@/lib/format';

type EndpointRow = {
  id: string;
  name: string;
  slug: string;
  mode: 'sandbox' | 'live';
  status: 'active' | 'paused';
  target_url: string;
  rate_limit_per_min: number;
  delivered: number;
  dlq: number;
  queued: number;
  attempts: number;
  last_event_at: string | null;
};

type Metrics = {
  endpoints: number;
  activeEndpoints: number;
  events: number;
  delivered: number;
  dlq: number;
  queued: number;
  attempts: number;
  retries: number;
  successRate: number | null;
  p95DeliveryMs: number | null;
  requestP50: number | null;
  requestP95: number | null;
};

type User = { id: string; email: string; name: string };

export function Dashboard({ user }: { user: User }) {
  const router = useRouter();
  const [endpoints, setEndpoints] = useState<EndpointRow[] | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    mode: 'sandbox' as 'sandbox' | 'live',
    targetUrl: 'https://hooks.sandbox.local/receiver',
    rateLimitPerMin: 60,
  });

  const load = useCallback(async () => {
    setError(null);
    try {
      const [endpointResponse, metricResponse] = await Promise.all([
        fetch('/api/endpoints', { cache: 'no-store' }),
        fetch('/api/metrics', { cache: 'no-store' }),
      ]);
      if (!endpointResponse.ok) {
        const data = await endpointResponse.json().catch(() => null);
        throw new Error(data?.error?.message ?? 'Không tải được endpoint.');
      }
      const endpointData = (await endpointResponse.json()) as { endpoints: EndpointRow[] };
      const metricData = (await metricResponse.json()) as { metrics: Metrics };
      setEndpoints(endpointData.endpoints);
      setMetrics(metricData.metrics);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Lỗi mạng.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function createEndpoint(event: React.FormEvent) {
    event.preventDefault();
    setBusy('create');
    setNotice(null);
    setError(null);
    try {
      const response = await fetch('/api/endpoints', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không tạo được endpoint.');
        return;
      }
      setNotice(`Đã tạo ${data.endpoint.name}. Mở endpoint để lấy secret và URL ingestion.`);
      setForm((current) => ({ ...current, name: '' }));
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggle(endpoint: EndpointRow) {
    setBusy(endpoint.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/endpoints/${endpoint.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: endpoint.status === 'active' ? 'paused' : 'active' }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        setError(data?.error?.message ?? 'Không đổi được trạng thái.');
        return;
      }
      setNotice(endpoint.status === 'active' ? `Đã tạm dừng ${endpoint.name}.` : `Đã bật lại ${endpoint.name}.`);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function sendTest(endpoint: EndpointRow) {
    setBusy(endpoint.id);
    setNotice(null);
    try {
      const response = await fetch(`/api/endpoints/${endpoint.id}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          eventType: 'demo.ping',
          payload: { message: 'Xin chào từ debug console', endpoint: endpoint.slug, at: new Date().toISOString() },
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không gửi được sự kiện thử.');
        return;
      }
      setNotice(
        `Đã gửi demo.ping tới ${endpoint.name}: ${data.event.status} · ${data.event.attempts} lần thử.`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function runWorker() {
    setBusy('worker');
    setNotice(null);
    try {
      const response = await fetch('/api/jobs/deliver', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Worker lỗi.');
        return;
      }
      setNotice(
        `Worker xử lý ${data.processed} sự kiện: ${data.delivered} giao thành công, ${data.stillQueued} còn chờ, ${data.deadLettered} vào DLQ.`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
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
        <div className="flex items-center gap-3 text-sm">
          <span className="hidden text-slate-400 sm:inline">{user.name}</span>
          <button className="btn-ghost" type="button" onClick={() => void logout()}>
            Đăng xuất
          </button>
        </div>
      </header>

      <section className="mt-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold sm:text-3xl">Endpoint và hàng đợi</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Mỗi sự kiện vào bằng HTTP kèm HMAC, được chống trùng theo idempotency key, giao ngay rồi retry
            theo backoff + jitter. Sau 5 lần thất bại, event vào DLQ và có thể replay.
          </p>
        </div>
        <button className="btn-ghost" type="button" onClick={() => void runWorker()} disabled={busy === 'worker'}>
          {busy === 'worker' ? 'Đang quét…' : 'Chạy worker ngay'}
        </button>
      </section>

      <div aria-live="polite" role="status" className="mt-4 space-y-2">
        {notice && (
          <p className="rounded-xl border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
            {notice}
          </p>
        )}
        {error && (
          <p className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
            {error}
          </p>
        )}
      </div>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Chỉ số">
        {[
          ['Tỉ lệ giao', metrics && metrics.successRate !== null ? `${metrics.successRate}%` : '—', 'delivered / (delivered + DLQ)'],
          ['Trong DLQ', metrics ? String(metrics.dlq) : '—', 'cần replay hoặc xử lý tay'],
          ['Sự kiện', metrics ? `${metrics.delivered}/${metrics.events}` : '—', 'đã giao trên tổng nhận'],
          ['p95 giao hàng', formatMs(metrics?.p95DeliveryMs ?? null), `request p95 ${formatMs(metrics?.requestP95 ?? null)}`],
        ].map(([label, value, note]) => (
          <div key={label} className="card py-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-100">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <h2 className="text-lg font-semibold">Endpoint của bạn</h2>
          <div className="mt-3 space-y-3">
            {endpoints === null && !error && (
              <div className="card animate-pulse space-y-3" aria-label="Đang tải">
                <div className="h-4 w-1/3 rounded bg-line/70" />
                <div className="h-3 w-2/3 rounded bg-line/50" />
              </div>
            )}
            {endpoints !== null && endpoints.length === 0 && (
              <div className="card border-dashed text-center">
                <p className="text-sm text-slate-400">Chưa có endpoint. Tạo endpoint sandbox đầu tiên ở cột phải.</p>
              </div>
            )}
            {endpoints?.map((endpoint) => (
              <article key={endpoint.id} className="card">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-100">{endpoint.name}</h3>
                      <span
                        className={`badge ${
                          endpoint.status === 'active'
                            ? 'border-emerald-400/40 text-emerald-200'
                            : 'border-slate-500/40 text-slate-400'
                        }`}
                      >
                        {endpoint.status === 'active' ? 'active' : 'paused'}
                      </span>
                      <span className="badge">{endpoint.mode}</span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-500">
                      /{endpoint.slug} · {truncate(endpoint.target_url, 48)}
                    </p>
                  </div>
                  <Link className="btn-ghost" href={`/endpoints/${endpoint.id}`}>
                    Mở debug
                  </Link>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">
                  <div>
                    <dt>Đã giao</dt>
                    <dd className="text-base font-semibold text-emerald-300">{endpoint.delivered}</dd>
                  </div>
                  <div>
                    <dt>DLQ</dt>
                    <dd className="text-base font-semibold text-rose-300">{endpoint.dlq}</dd>
                  </div>
                  <div>
                    <dt>Đang chờ</dt>
                    <dd className="text-base font-semibold text-amber-300">{endpoint.queued}</dd>
                  </div>
                  <div>
                    <dt>Rate limit</dt>
                    <dd className="text-base font-semibold text-slate-200">{endpoint.rate_limit_per_min}/phút</dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                  <p className="text-xs text-slate-500">
                    Lần nhận gần nhất: {endpoint.last_event_at ? relative(endpoint.last_event_at) : 'chưa có'}
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="btn-ghost px-3 py-1.5 text-xs"
                      type="button"
                      disabled={busy === endpoint.id || endpoint.status !== 'active'}
                      onClick={() => void sendTest(endpoint)}
                    >
                      Gửi test
                    </button>
                    <button
                      className="btn-ghost px-3 py-1.5 text-xs"
                      type="button"
                      disabled={busy === endpoint.id}
                      onClick={() => void toggle(endpoint)}
                    >
                      {endpoint.status === 'active' ? 'Tạm dừng' : 'Bật lại'}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold">Tạo endpoint</h2>
          <form className="card mt-3 space-y-4" onSubmit={(event) => void createEndpoint(event)}>
            <div>
              <label className="label" htmlFor="endpoint-name">
                Tên
              </label>
              <input
                id="endpoint-name"
                className="input"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Billing alerts"
                required
                minLength={2}
                maxLength={60}
              />
            </div>
            <div>
              <label className="label" htmlFor="endpoint-mode">
                Chế độ
              </label>
              <select
                id="endpoint-mode"
                className="input"
                value={form.mode}
                onChange={(event) => setForm({ ...form, mode: event.target.value as 'sandbox' | 'live' })}
              >
                <option value="sandbox">Sandbox — mô phỏng upstream, không gọi mạng</option>
                <option value="live">Live — gọi URL thật</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="endpoint-url">
                Target URL
              </label>
              <input
                id="endpoint-url"
                className="input font-mono text-xs"
                type="url"
                value={form.targetUrl}
                onChange={(event) => setForm({ ...form, targetUrl: event.target.value })}
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Sandbox chỉ lưu URL để hiển thị. Live cần https và bị chặn host nội bộ.
              </p>
            </div>
            <div>
              <label className="label" htmlFor="endpoint-rate">
                Giới hạn mỗi phút
              </label>
              <input
                id="endpoint-rate"
                className="input"
                type="number"
                min={10}
                max={600}
                value={form.rateLimitPerMin}
                onChange={(event) => setForm({ ...form, rateLimitPerMin: Number(event.target.value) })}
                required
              />
            </div>
            <button className="btn-primary w-full" type="submit" disabled={busy === 'create'}>
              {busy === 'create' ? 'Đang tạo…' : 'Tạo endpoint'}
            </button>
          </form>

          <div className="card mt-4">
            <h3 className="text-sm font-semibold text-slate-200">Đang chờ xử lý</h3>
            <p className="mt-1 text-2xl font-semibold text-amber-300">{metrics?.queued ?? '—'}</p>
            <p className="mt-1 text-xs text-slate-500">
              {metrics ? `${metrics.attempts} lần giao, ${metrics.retries} lần phải thử lại` : 'Đang tải…'}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Worker chạy khi bạn bấm nút, sau mỗi lần ingest hoặc qua cron secret. Sự kiện của endpoint
              paused được giữ nguyên.
            </p>
          </div>
        </div>
      </section>

      <footer className="mt-12 text-xs text-slate-500">
        Mốc thời gian hiển thị theo giờ máy · danh sách tự làm mới mỗi 30 giây.
      </footer>
    </main>
  );
}
