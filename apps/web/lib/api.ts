import type { components } from "@deadlock/api-client";

export type PlayerCandidate = components["schemas"]["PlayerCandidateOut"];
export type Player = components["schemas"]["PlayerOut"];
export type PlayerStats = components["schemas"]["PlayerStatsOut"];
export type MatchHistoryItem = components["schemas"]["MatchHistoryItem"];
export type Match = components["schemas"]["MatchOut"];
export type Job = components["schemas"]["JobOut"];
export type Hero = components["schemas"]["HeroOut"];
export type HeroStats = components["schemas"]["HeroGlobalStatsOut"];
export type HeroDetail = components["schemas"]["HeroDetailOut"];
export type ApiMeta = components["schemas"]["ApiMeta"];

export type ApiEnvelope<T> = { data: T; meta: ApiMeta; status?: number };

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function delay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    }
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
}

type ApiPayload<T> = ApiEnvelope<T> | { error?: { code?: string; message?: string } };

export async function apiRequest<T>(
  path: string,
  options: { signal?: AbortSignal; method?: "GET" | "POST" } = {},
): Promise<ApiEnvelope<T>> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: { accept: "application/json" },
    cache: "no-store",
  });
  const payload = (await response.json()) as ApiPayload<T>;
  if (!response.ok) {
    const error = "error" in payload ? payload.error : undefined;
    throw new ApiError(
      error?.message ?? "Не удалось загрузить данные",
      response.status,
      error?.code ?? "request_failed",
    );
  }
  return { ...(payload as ApiEnvelope<T>), status: response.status };
}

export function queryString(values: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) query.set(key, value);
  }
  const result = query.toString();
  return result ? `?${result}` : "";
}

export function isValidDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1000) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function datePeriodError(from: string, to: string, requireBoth: boolean) {
  if ((from && !isValidDateOnly(from)) || (to && !isValidDateOnly(to))) return "Ссылка содержит некорректную дату. Укажите период заново.";
  if (requireBoth && Boolean(from) !== Boolean(to)) return "Укажите обе даты периода.";
  if (from && to) {
    if (from > to) return "Начало периода должно быть раньше конца.";
    const [year, month, day] = to.split("-").map(Number);
    const end = Date.UTC(year, month - 1, day + 1);
    const start = Date.parse(`${from}T00:00:00Z`);
    if (end - start > 31 * 24 * 60 * 60 * 1000) return "Период не может превышать 31 день.";
  }
  return "";
}

export function nextUtcDayStart(date: string) {
  if (!isValidDateOnly(date)) return "";
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString();
}

export function formatNumber(value: number | null | undefined, digits = 1) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  return value == null ? "—" : `${formatNumber(value * 100, 1)}%`;
}

export function formatMatches(value: number | null | undefined) {
  if (value == null) return "—";
  const absolute = Math.abs(Math.trunc(value));
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? "матчей" : last === 1 ? "матч" : last >= 2 && last <= 4 ? "матча" : "матчей";
  return `${formatNumber(value, 0)} ${word}`;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "время неизвестно";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatDuration(value: number | null) {
  if (value == null) return "—";
  return `${Math.floor(value / 60)} мин`;
}

export function sourceDescription(meta: ApiMeta) {
  const source = meta.source === "database" ? "База Deadlock Inside" : meta.source === "steam" ? "Steam" : meta.source;
  return `${source} · выборка ${formatNumber(meta.sample_size, 0)} · обновлено ${formatDate(meta.updated_at)}`;
}
