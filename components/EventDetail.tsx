'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { formatMs, OUTCOME_META, relative, STATUS_META, timeShort } from '@/lib/format';

type EventRow = {
  id: string;
  endpoint_id: string;
  idempotency_key: string;
  event_type: string;
  payload: string;
  status: 'queued' | 'delivered' | 'dlq';
  source: 'ingest' | 'test' | 'replay';
  attempts: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_error: string | null;
  received_at: string;
  delivered_at: string | null;
};

type DeliveryRow = {
  id: string;
  attempt_no: number;
  outcome: 'success' | 'retry' | 'fatal';
  status_code: number | null;
  response_body: string | null;
  duration_ms: number;
  error: string | null;
  started_at: string;
};

type Bundle = {
  event: EventRow;
  endpoint: { id: string; name: string; slug: string; mode: string; max_attempts: number };
  deliveries: DeliveryRow[];
  now: string;
};

function prettyPayload(payload: string): string {
  try {
    return JSON.stringify(JSON.parse(payload), null, 2);
  } catch {
    return payload;
  }
}

export function EventDetail({ eventId }: { eventId: string }) {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/events/${eventId}`, { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không tải được sự kiện.');
        return;
      }
      setBundle(data as Bundle);
      setError(null);
    } catch {
      setError('Không kết nối được server.');
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function replay() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${eventId}/replay`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error?.message ?? 'Không replay được.');
        return;
      }
      setNotice(
        `Đã replay: ${STATUS_META[data.event.status as 'queued'].label}, ${data.event.attempts} lần thử.`,
      );
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!bundle && error) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
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
      <main className="mx-auto w-full max-w-3xl px-4 py-16 sm:px-6">
        <div className="card animate-pulse space-y-4">
          <div className="h-6 w-1/3 rounded bg-line/70" />
          <div className="h-3 w-1/2 rounded bg-line/50" />
          <div className="h-40 rounded-xl bg-line/30" />
        </div>
      </main>
    );
  }

  const { event, endpoint, deliveries } = bundle;

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-20 pt-8 sm:px-6">
      <nav>
        <Link className="link text-sm" href={`/endpoints/${endpoint.id}`}>
          ← {endpoint.name}
        </Link>
      </nav>

      <header className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{event.event_type}</h1>
            <span className={`badge ${STATUS_META[event.status].className}`}>
              {STATUS_META[event.status].label}
            </span>
            <span className="badge">{event.source}</span>
          </div>
          <p className="mt-1 font-mono text-xs text-slate-500">{event.id}</p>
        </div>
        <button className="btn-primary" type="button" disabled={busy} onClick={() => void replay()}>
          {busy ? 'Đang replay…' : 'Replay ngay'}
        </button>
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

      <section className="card mt-5">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Idempotency key</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-slate-200">{event.idempotency_key}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Nhận lúc</dt>
            <dd className="mt-0.5 text-slate-200" title={timeShort(event.received_at)}>
              {timeShort(event.received_at)} · {relative(event.received_at)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Số lần thử</dt>
            <dd className="mt-0.5 text-slate-200">
              {event.attempts}/{endpoint.max_attempts}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Lần thử tiếp theo</dt>
            <dd className="mt-0.5 text-slate-200">
              {event.status === 'queued' ? relative(event.next_attempt_at) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">Giao xong lúc</dt>
            <dd className="mt-0.5 text-slate-200">{event.delivered_at ? timeShort(event.delivered_at) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">HTTP gần nhất</dt>
            <dd className="mt-0.5 font-mono text-slate-200">{event.last_status_code ?? '—'}</dd>
          </div>
        </dl>
        {event.last_error && (
          <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {event.last_error}
          </p>
        )}
      </section>

      <section className="card mt-5">
        <h2 className="text-lg font-semibold">Payload</h2>
        <pre className="mt-3 max-h-80 overflow-auto rounded-xl border border-line bg-ink/80 p-3 text-[11px] leading-relaxed text-slate-300">
          <code>{prettyPayload(event.payload)}</code>
        </pre>
      </section>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">Lịch sử giao hàng</h2>
        {deliveries.length === 0 && (
          <div className="card mt-3 border-dashed text-center text-sm text-slate-500">
            Chưa có lần giao nào. Bấm Replay để thử ngay.
          </div>
        )}
        <ol className="mt-3 space-y-3">
          {deliveries.map((delivery) => {
            const meta = OUTCOME_META[delivery.outcome] ?? OUTCOME_META.retry;
            return (
              <li key={delivery.id} className="card">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-panel text-xs font-semibold text-slate-300">
                      {delivery.attempt_no}
                    </span>
                    <div>
                      <p className={`text-sm font-semibold ${meta.className}`}>{meta.label}</p>
                      <p className="text-xs text-slate-500">
                        {timeShort(delivery.started_at)} · {relative(delivery.started_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="font-mono">HTTP {delivery.status_code ?? '—'}</span>
                    <span>{formatMs(delivery.duration_ms)}</span>
                  </div>
                </div>
                {(delivery.response_body || delivery.error) && (
                  <pre className="mt-3 max-h-40 overflow-auto rounded-xl border border-line bg-ink/70 p-3 text-[11px] leading-relaxed text-slate-400">
                    <code>{delivery.response_body || delivery.error || ''}</code>
                  </pre>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <p className="mt-8 text-xs text-slate-500">
        Replay reset số lần thử, giữ nguyên payload và idempotency key, rồi giao lại ngay. Hành động được
        ghi audit với actor hiện tại.
      </p>
    </main>
  );
}
