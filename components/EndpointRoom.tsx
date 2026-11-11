'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatMs, relative, STATUS_META, timeShort, truncate } from '@/lib/format';

type Endpoint = {
  id: string;
  name: string;
  slug: string;
  mode: 'sandbox' | 'live';
  status: 'active' | 'paused';
  target_url: string;
  rate_limit_per_min: number;
  max_attempts: number;
  previous_secret: string | null;
  secret_rotated_at: string | null;
  delivered: number;
  dlq: number;
  queued: number;
  attempts: number;
  last_event_at: string | null;
};

type EventRow = {
  id: string;
  event_type: string;
  idempotency_key: string;
  status: 'queued' | 'delivered' | 'dlq';
  source: 'ingest' | 'test' | 'replay';
  attempts: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_error: string | null;
  received_at: string;
  delivered_at: string | null;
};

type Bundle = {
  endpoint: Endpoint;
  events: EventRow[];
  metrics: {
    delivered: number;
    dlq: number;
    queued: number;
    attempts: number;
    successRate: number | null;
    p95DeliveryMs: number | null;
  };
  ingestUrl: string;
  now: string;
};

export function EndpointRoom({ endpointId }: { endpointId: string }) {
  const router = useRouter();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'queued' | 'delivered' | 'dlq'>('all');
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [rate, setRate] = useState(60);
  const [testForm, setTestForm] = useState({
    eventType: 'demo.ping',
    payload: '{\n  "message": "Xin chào từ debug console"\n}',
  });

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/endpoints/${endpointId}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không tải được endpoint.');
        return;
      }
      setBundle(data as Bundle);
      setRate((data as Bundle).endpoint.rate_limit_per_min);
      setError(null);
    } catch {
      setError('Không kết nối được server.');
    }
  }, [endpointId]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function patch(body: Record<string, unknown>, message: string) {
    setBusy('patch');
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`/api/endpoints/${endpointId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không cập nhật được endpoint.');
        return;
      }
      setNotice(message);
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus() {
    if (!bundle) return;
    await patch(
      { status: bundle.endpoint.status === 'active' ? 'paused' : 'active' },
      bundle.endpoint.status === 'active'
        ? 'Đã tạm dừng nhận sự kiện. Event đang chờ được giữ nguyên.'
        : 'Đã bật lại endpoint.',
    );
  }

  async function saveRate() {
    await patch({ rateLimitPerMin: rate }, `Đã đặt giới hạn ${rate} sự kiện/phút.`);
  }

  async function reveal() {
    setBusy('secret');
    setError(null);
    try {
      const response = await fetch(`/api/endpoints/${endpointId}/secret`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không lấy được secret.');
        return;
      }
      setSecret(data.secret);
      setNotice('Secret đã hiện. Hành động này được ghi audit.');
    } finally {
      setBusy(null);
    }
  }

  async function rotate() {
    setBusy('rotate');
    setNotice(null);
    setError(null);
    setConfirmRotate(false);
    try {
      const response = await fetch(`/api/endpoints/${endpointId}/rotate`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không xoay được secret.');
        return;
      }
      setSecret(data.secret);
      setNotice('Đã xoay secret. Secret cũ còn hiệu lực 24 giờ để phía gửi kịp chuyển.');
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function sendTest(event: React.FormEvent) {
    event.preventDefault();
    setBusy('test');
    setNotice(null);
    setError(null);
    let payload: unknown;
    try {
      payload = JSON.parse(testForm.payload);
    } catch {
      setError('Payload phải là JSON hợp lệ.');
      return;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      setError('Payload phải là JSON object.');
      return;
    }
    try {
      const response = await fetch(`/api/endpoints/${endpointId}/test`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventType: testForm.eventType, payload }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không gửi được sự kiện thử.');
        return;
      }
      setNotice(
        `Đã gửi ${data.event.event_type}: ${STATUS_META[data.event.status as 'queued'].label}, ${data.event.attempts} lần thử.`,
      );
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`Đã copy ${label}.`);
    } catch {
      setError('Trình duyệt không cho copy tự động. Chọn và copy thủ công.');
    }
  }

  const events = useMemo(() => {
    if (!bundle) return [];
    return filter === 'all' ? bundle.events : bundle.events.filter((event) => event.status === filter);
  }, [bundle, filter]);

  const nodeSnippet = bundle
    ? `import crypto from 'node:crypto';

const secret = process.env.HTK_WEBHOOK_SECRET;
const body = JSON.stringify({ type: 'invoice.paid', id: 'inv_2041' });
const timestamp = Math.floor(Date.now() / 1000);
const signature = 'sha256=' + crypto
  .createHmac('sha256', secret)
  .update(\`\${timestamp}.\${body}\`)
  .digest('hex');

await fetch('${bundle.ingestUrl}', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-event-type': 'invoice.paid',
    'x-idempotency-key': 'inv_2041',
    'x-htk-timestamp': String(timestamp),
    'x-htk-signature': signature,
  },
  body,
});`
    : '';

  if (!bundle && error) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6">
        <div className="card text-center">
          <p className="text-sm text-rose-200">{error}</p>
          <button className="btn-ghost mt-4" type="button" onClick={() => void load()}>
            Thử lại
          </button>
          <Link className="btn-ghost ml-2 mt-4" href="/workspace">
            Về workspace
          </Link>
        </div>
      </main>
    );
  }

  if (!bundle) {
    return (
      <main className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6">
        <div className="card animate-pulse space-y-4">
          <div className="h-6 w-1/3 rounded bg-line/70" />
          <div className="h-3 w-2/3 rounded bg-line/50" />
          <div className="h-24 rounded-xl bg-line/30" />
        </div>
      </main>
    );
  }

  const endpoint = bundle.endpoint;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6">
      <nav className="flex items-center justify-between">
        <Link className="link text-sm" href="/workspace">
          ← Workspace
        </Link>
        <button
          className="btn-ghost px-3 py-1.5 text-xs"
          type="button"
          onClick={() => router.refresh()}
        >
          Làm mới
        </button>
      </nav>

      <header className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold sm:text-3xl">{endpoint.name}</h1>
            <span
              className={`badge ${
                endpoint.status === 'active'
                  ? 'border-emerald-400/40 text-emerald-200'
                  : 'border-slate-500/40 text-slate-400'
              }`}
            >
              {endpoint.status}
            </span>
            <span className="badge">{endpoint.mode}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">
            /{endpoint.slug} → {truncate(endpoint.target_url, 70)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" type="button" disabled={busy === 'patch'} onClick={() => void toggleStatus()}>
            {endpoint.status === 'active' ? 'Tạm dừng' : 'Bật lại'}
          </button>
          {confirmRotate ? (
            <>
              <button className="btn-primary" type="button" disabled={busy === 'rotate'} onClick={() => void rotate()}>
                {busy === 'rotate' ? 'Đang xoay…' : 'Xác nhận xoay secret'}
              </button>
              <button className="btn-ghost" type="button" onClick={() => setConfirmRotate(false)}>
                Huỷ
              </button>
            </>
          ) : (
            <button className="btn-ghost" type="button" onClick={() => setConfirmRotate(true)}>
              Xoay secret
            </button>
          )}
        </div>
      </header>

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

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Chỉ số endpoint">
        {[
          ['Đã giao', String(bundle.metrics.delivered), 'event nhận 2xx'],
          ['DLQ', String(bundle.metrics.dlq), `tối đa ${endpoint.max_attempts} lần thử`],
          ['Đang chờ', String(bundle.metrics.queued), 'worker sẽ xử lý'],
          ['p95 giao hàng', formatMs(bundle.metrics.p95DeliveryMs), `${bundle.metrics.attempts} lần giao`],
        ].map(([label, value, note]) => (
          <div key={label} className="card py-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold text-slate-100">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{note}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="card min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">Kết nối</h2>
            <span className="text-xs text-slate-500">
              {endpoint.secret_rotated_at
                ? `Secret xoay ${relative(endpoint.secret_rotated_at)}`
                : 'Secret chưa xoay'}
            </span>
          </div>

          <label className="label mt-4" htmlFor="ingest-url">
            Ingest URL
          </label>
          <div className="flex min-w-0 gap-2">
            <input id="ingest-url" className="input min-w-0 font-mono text-xs" readOnly value={bundle.ingestUrl} />
            <button className="btn-ghost shrink-0 px-3" type="button" onClick={() => void copy(bundle.ingestUrl, 'URL')}>
              Copy
            </button>
          </div>

          <label className="label mt-4" htmlFor="secret-value">
            Signing secret
          </label>
          <div className="flex min-w-0 gap-2">
            <input
              id="secret-value"
              className="input min-w-0 font-mono text-xs"
              readOnly
              value={secret ?? '••••••••••••••••••••••••••••'}
            />
            <button
              className="btn-ghost shrink-0 px-3"
              type="button"
              onClick={() => (secret ? setSecret(null) : void reveal())}
              disabled={busy === 'secret'}
            >
              {secret ? 'Ẩn' : 'Hiện'}
            </button>
            {secret && (
              <button className="btn-ghost shrink-0 px-3" type="button" onClick={() => void copy(secret, 'secret')}>
                Copy
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Ký <code>HMAC-SHA256(secret, timestamp + &quot;.&quot; + body)</code>. Secret cũ được chấp nhận 24
            giờ sau khi xoay. Bản demo lưu secret dạng đọc được trong PGlite; production nên mã hoá at-rest.
          </p>

          <h3 className="mt-6 text-sm font-semibold text-slate-200">Gửi thử bằng Node</h3>
          <pre className="mt-2 max-h-72 max-w-full overflow-auto rounded-xl border border-line bg-ink/80 p-3 text-[11px] leading-relaxed text-slate-300">
            <code className="block min-w-max">{nodeSnippet}</code>
          </pre>
        </div>

        <div className="min-w-0 space-y-5">
          <form className="card space-y-3" onSubmit={(event) => void sendTest(event)}>
            <h2 className="text-lg font-semibold">Gửi sự kiện thử</h2>
            <p className="text-xs text-slate-500">
              Server tự ký bằng secret hiện tại và đi qua đúng pipeline giao hàng, kể cả retry và DLQ.
            </p>
            <div>
              <label className="label" htmlFor="test-type">
                Event type
              </label>
              <input
                id="test-type"
                className="input"
                value={testForm.eventType}
                onChange={(event) => setTestForm({ ...testForm, eventType: event.target.value })}
                required
                minLength={2}
                maxLength={80}
              />
            </div>
            <div>
              <label className="label" htmlFor="test-payload">
                Payload JSON
              </label>
              <textarea
                id="test-payload"
                className="input min-h-[110px] font-mono text-xs"
                value={testForm.payload}
                onChange={(event) => setTestForm({ ...testForm, payload: event.target.value })}
                required
              />
            </div>
            <button className="btn-primary w-full" type="submit" disabled={busy === 'test'}>
              {busy === 'test' ? 'Đang gửi…' : 'Gửi vào hàng đợi'}
            </button>
          </form>

          <div className="card">
            <h2 className="text-lg font-semibold">Giới hạn ingest</h2>
            <div className="mt-3 flex items-end gap-2">
              <div className="flex-1">
                <label className="label" htmlFor="rate">
                  Sự kiện mỗi phút
                </label>
                <input
                  id="rate"
                  className="input"
                  type="number"
                  min={10}
                  max={600}
                  value={rate}
                  onChange={(event) => setRate(Number(event.target.value))}
                />
              </div>
              <button className="btn-ghost" type="button" disabled={busy === 'patch'} onClick={() => void saveRate()}>
                Lưu
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Cửa sổ 1 phút theo từng endpoint, trả 429 kèm Retry-After khi vượt. Bộ đếm nằm trong bộ nhớ
              instance + bảng rate_limits, không phải quota toàn cục.
            </p>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Sự kiện gần đây</h2>
          <div className="flex flex-wrap gap-1" role="group" aria-label="Lọc theo trạng thái">
            {(['all', 'queued', 'delivered', 'dlq'] as const).map((value) => (
              <button
                key={value}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  filter === value ? 'bg-accent/20 text-accent' : 'text-slate-400 hover:text-slate-200'
                }`}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'Tất cả' : STATUS_META[value].label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-panel/80 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Sự kiện</th>
                <th className="px-4 py-3">Trạng thái</th>
                <th className="px-4 py-3">Lần thử</th>
                <th className="px-4 py-3">HTTP</th>
                <th className="px-4 py-3">Nhận lúc</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {events.map((event) => (
                <tr key={event.id} className="align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-200">{event.event_type}</p>
                    <p className="font-mono text-[11px] text-slate-500">
                      {truncate(event.idempotency_key, 34)} · {event.source}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_META[event.status].className}`}>
                      {STATUS_META[event.status].label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-300">{event.attempts}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-300">{event.last_status_code ?? '—'}</td>
                  <td className="px-4 py-3 text-xs text-slate-400" title={timeShort(event.received_at)}>
                    {relative(event.received_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link className="link text-xs" href={`/events/${event.id}`}>
                      Chi tiết
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && (
            <div className="px-4 py-10 text-center text-sm text-slate-500">
              Không có sự kiện nào khớp bộ lọc.
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Hiển thị 30 sự kiện mới nhất. Sự kiện đang chờ cho lần thử tiếp theo:{' '}
          {bundle.events.filter((event) => event.status === 'queued').length}.
        </p>
      </section>
    </main>
  );
}
