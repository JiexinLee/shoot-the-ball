// ==========================================================================
// app/api/v1/[...path]/route.ts — Next.js Route Handler BFF
//   前端统一调同域 /api/v1/*（完全不用管 CORS），然后这个 handler 再转发给
//   Express API（services/api，默认 http://localhost:4321/v1）。
//
//   配置:
//     - API_PROXY_TARGET (server-side only env): 转发目标 baseUrl，默认 http://localhost:4321/v1
//       生产部署时改成内网地址（例如 http://api:4321/v1），避免外网暴露。
//     - 如果前端走直连（不经过 BFF），在前端 NEXT_PUBLIC_API_BASE_URL 里填完整 URL。
//
//   关键实现点:
//     1) 所有 body / headers（除了 host）原样透传，包括 Authorization: Bearer <token>。
//     2) SSE（jobs/:id/events）直接返回上游 ReadableStream，Next 保持 chunked 响应不缓冲。
//     3) 上游非 2xx 时直接把上游 status + JSON 原样返给前端，前端 ApiError 类正常工作。
// ==========================================================================

import { NextRequest, NextResponse } from "next/server";

const PROXY_TARGET =
  process.env.API_PROXY_TARGET?.replace(/\/$/, "") ??
  "http://localhost:4321/v1";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const fetchCache = "force-no-store";

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const joined = path.join("/");

  const base = PROXY_TARGET.endsWith("/") ? PROXY_TARGET : `${PROXY_TARGET}/`;
  const upstreamUrl = new URL(
    joined + (req.nextUrl.search ? req.nextUrl.search : ""),
    base,
  );

  const upstreamHeaders = new Headers(req.headers);
  upstreamHeaders.delete("host");
  upstreamHeaders.delete("connection");
  upstreamHeaders.delete("keep-alive");

  // 当 /jobs/:id/events 带 token query 兼容 SSE 客户端无法带 Authorization 头
  const tokenFromQuery = upstreamUrl.searchParams.get("token");
  if (tokenFromQuery && !upstreamHeaders.has("authorization")) {
    upstreamHeaders.set("authorization", `Bearer ${tokenFromQuery}`);
    upstreamUrl.searchParams.delete("token");
  }

  const isSSE = /\/jobs\/[^/]+\/events$/.test(`/${joined}`);

  let resBody: BodyInit | null = null;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const buf = await req.arrayBuffer();
      if (buf.byteLength > 0) resBody = buf;
    } catch {
      resBody = null;
    }
  }

  const upstreamRes = await fetch(upstreamUrl.toString(), {
    method: req.method,
    headers: upstreamHeaders,
    body: resBody,
    redirect: "manual",
    cache: "no-store",
  } as RequestInit);

  const resHeaders = new Headers(upstreamRes.headers);
  resHeaders.delete("content-encoding");
  resHeaders.delete("transfer-encoding");
  resHeaders.delete("connection");
  resHeaders.delete("keep-alive");
  if (isSSE) {
    resHeaders.set("Content-Type", "text/event-stream; charset=utf-8");
    resHeaders.set("Cache-Control", "no-cache, no-transform");
    resHeaders.set("X-Accel-Buffering", "no");
  }

  return new NextResponse(upstreamRes.body, {
    status: upstreamRes.status,
    statusText: upstreamRes.statusText,
    headers: resHeaders,
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PATCH,
  proxy as PUT,
  proxy as DELETE,
  proxy as OPTIONS,
};
