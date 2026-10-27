import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const base = process.env.DEADLOCK_API_INTERNAL_URL ?? "http://127.0.0.1:8000";
  const upstream = new URL(
    `/api/v1/${path.map((segment) => encodeURIComponent(segment)).join("/")}${request.nextUrl.search}`,
    base,
  );
  const headers = new Headers({ accept: "application/json" });
  for (const name of ["content-type", "cookie", "x-csrf-token", "origin"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body: ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(12_000),
    });
    const responseHeaders = new Headers();
    const responseType = response.headers.get("content-type");
    const location = response.headers.get("location");
    if (responseType) responseHeaders.set("content-type", responseType);
    if (location) responseHeaders.set("location", location);
    for (const cookie of response.headers.getSetCookie()) responseHeaders.append("set-cookie", cookie);
    responseHeaders.set("cache-control", "no-store");
    return new NextResponse(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return NextResponse.json(
      { error: { code: "api_unavailable", message: "Сервис статистики временно недоступен", request_id: "" } },
      { status: 502, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
