import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { WorkerCore, RequestAdapter } from "@foldset/core";
import type { x402HTTPResourceServer } from "@x402/core/server";
import {
  handlePaymentRequest,
  handleSettlement,
  parseMcpRequest,
  getMcpRouteKey,
  isMcpListMethod,
  getMcpListPaymentRequirements,
  buildJsonRpcError,
} from "@foldset/core";

import type { FoldsetProxyOptions } from "./types";
import { getWorkerCore } from "./core";
import { NextjsAdapter } from "./adapter";

async function handleMcpRequest(
  request: NextRequest,
  core: WorkerCore,
  httpServer: x402HTTPResourceServer,
  adapter: RequestAdapter,
  mcpEndpoint: string,
): Promise<NextResponse> {
  // Only POST carries JSON-RPC in MCP Streamable HTTP;
  // GET (SSE) and DELETE (session close) pass through.
  if (request.method !== "POST") {
    return NextResponse.next();
  }

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    return NextResponse.next();
  }

  const rpc = parseMcpRequest(body);
  if (!rpc) {
    return NextResponse.next();
  }

  // List methods — pass through, attach payment requirements header
  if (isMcpListMethod(rpc.method)) {
    const restrictions = await core.restrictions.get() ?? [];
    const requirements = await getMcpListPaymentRequirements(
      rpc.method,
      mcpEndpoint,
      httpServer,
      adapter,
      restrictions,
    );

    const response = NextResponse.next();
    if (requirements.length > 0) {
      response.headers.set("Payment-Required", JSON.stringify(requirements));
    }
    return response;
  }

  // Call/read/get — check payment via route key
  const routeKey = getMcpRouteKey(mcpEndpoint, rpc.method, rpc.params);
  if (!routeKey) {
    return NextResponse.next();
  }

  const result = await handlePaymentRequest(core, httpServer, adapter, routeKey);

  switch (result.type) {
    case "no-payment-required":
      return NextResponse.next();

    case "payment-error": {
      const headers = new Headers(result.response.headers as HeadersInit);
      headers.set("Content-Type", "application/json");
      return new NextResponse(
        JSON.stringify(buildJsonRpcError(rpc.id ?? null, 402, "Payment required")),
        { status: result.response.status, headers },
      );
    }

    case "payment-verified": {
      // TODO rfradkin: Optimistically assumes 200 — Next.js middleware
      // can't see the downstream response status code.
      const settlement = await handleSettlement(
        core,
        httpServer,
        adapter,
        result.paymentPayload,
        result.paymentRequirements,
        200,
      );

      if (!settlement.success) {
        return new NextResponse(
          JSON.stringify(buildJsonRpcError(rpc.id ?? null, 402, "Settlement failed", { details: settlement.errorReason })),
          { status: 402, headers: { "Content-Type": "application/json" } },
        );
      }

      const response = NextResponse.next();
      for (const [key, value] of Object.entries(settlement.headers)) {
        response.headers.set(key, value);
      }
      return response;
    }
  }
}

async function handleWebRequest(
  core: WorkerCore,
  httpServer: x402HTTPResourceServer,
  adapter: RequestAdapter,
): Promise<NextResponse> {
  const result = await handlePaymentRequest(core, httpServer, adapter);

  switch (result.type) {
    case "no-payment-required":
      return NextResponse.next();

    case "payment-error":
      return new NextResponse(result.response.body as string, {
        status: result.response.status,
        headers: result.response.headers,
      });

    case "payment-verified": {
      // TODO rfradkin: Optimistically assumes 200 — Next.js middleware
      // can't see the downstream response status code.
      const settlement = await handleSettlement(
        core,
        httpServer,
        adapter,
        result.paymentPayload,
        result.paymentRequirements,
        200,
      );

      if (!settlement.success) {
        return NextResponse.json(
          { error: "Settlement failed", details: settlement.errorReason },
          { status: 402 },
        );
      }

      const response = NextResponse.next();
      for (const [key, value] of Object.entries(settlement.headers)) {
        response.headers.set(key, value);
      }
      return response;
    }
  }
}

export function createFoldsetProxy(options: FoldsetProxyOptions) {
  if (!options.apiKey) {
    console.warn("No API key provided to Foldset proxy");
    return async function proxy(_request: NextRequest) {
      return NextResponse.next();
    };
  }

  return async function proxy(request: NextRequest) {
    const core = await getWorkerCore(options.apiKey);
    const adapter = new NextjsAdapter(request);

    const httpServer = await core.httpServer.get();
    if (!httpServer) {
      return NextResponse.next();
    }

    try {
      const hostConfig = await core.hostConfig.get();
      const mcpEndpoint = hostConfig?.mcpEndpoint;

      if (mcpEndpoint && adapter.getPath() === mcpEndpoint) {
        return handleMcpRequest(request, core, httpServer, adapter, mcpEndpoint);
      }

      return handleWebRequest(core, httpServer, adapter);
    } catch (error) {
      core.errorReporter.captureException(error);
      return NextResponse.next();
    }
  };
}
