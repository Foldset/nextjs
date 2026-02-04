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
  console.log("[foldset] MCP request:", request.method, mcpEndpoint);

  // Only POST carries JSON-RPC in MCP Streamable HTTP;
  // GET (SSE) and DELETE (session close) pass through.
  if (request.method !== "POST") {
    console.log("[foldset] MCP non-POST, passing through");
    return NextResponse.next();
  }

  let body: unknown;
  try {
    body = await request.clone().json();
  } catch {
    console.log("[foldset] MCP body not JSON, passing through");
    return NextResponse.next();
  }

  const rpc = parseMcpRequest(body);
  if (!rpc) {
    console.log("[foldset] MCP body not valid JSON-RPC, passing through");
    return NextResponse.next();
  }

  console.log("[foldset] MCP JSON-RPC method:", rpc.method, "id:", rpc.id);

  // List methods — pass through, attach payment requirements header
  if (isMcpListMethod(rpc.method)) {
    console.log("[foldset] MCP list method, attaching payment requirements");
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
      console.log("[foldset] MCP list: attached", requirements.length, "payment requirements");
    } else {
      console.log("[foldset] MCP list: no payment requirements");
    }
    return response;
  }

  // Call/read/get — check payment via route key
  const routeKey = getMcpRouteKey(mcpEndpoint, rpc.method, rpc.params);
  if (!routeKey) {
    console.log("[foldset] MCP no route key for method, passing through");
    return NextResponse.next();
  }

  console.log("[foldset] MCP route key:", routeKey);
  const result = await handlePaymentRequest(core, httpServer, adapter, routeKey);
  console.log("[foldset] MCP payment result:", result.type);

  switch (result.type) {
    case "no-payment-required":
      return NextResponse.next();

    case "payment-error": {
      console.log("[foldset] MCP payment error, status:", result.response.status);
      const headers = new Headers(result.response.headers as HeadersInit);
      headers.set("Content-Type", "application/json");
      return new NextResponse(
        JSON.stringify(buildJsonRpcError(rpc.id ?? null, 402, "Payment required")),
        { status: result.response.status, headers },
      );
    }

    case "payment-verified": {
      console.log("[foldset] MCP payment verified, settling optimistically");
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
        console.log("[foldset] MCP settlement failed:", settlement.errorReason);
        return new NextResponse(
          JSON.stringify(buildJsonRpcError(rpc.id ?? null, 402, "Settlement failed", { details: settlement.errorReason })),
          { status: 402, headers: { "Content-Type": "application/json" } },
        );
      }

      console.log("[foldset] MCP settlement success");
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
  console.log("[foldset] Web request:", adapter.getMethod(), adapter.getPath());
  const result = await handlePaymentRequest(core, httpServer, adapter);
  console.log("[foldset] Web payment result:", result.type);

  switch (result.type) {
    case "no-payment-required":
      return NextResponse.next();

    case "payment-error":
      console.log("[foldset] Web payment error, status:", result.response.status);
      return new NextResponse(result.response.body as string, {
        status: result.response.status,
        headers: result.response.headers,
      });

    case "payment-verified": {
      console.log("[foldset] Web payment verified, settling optimistically");
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
        console.log("[foldset] Web settlement failed:", settlement.errorReason);
        return NextResponse.json(
          { error: "Settlement failed", details: settlement.errorReason },
          { status: 402 },
        );
      }

      console.log("[foldset] Web settlement success");
      const response = NextResponse.next();
      for (const [key, value] of Object.entries(settlement.headers)) {
        response.headers.set(key, value);
      }
      return response;
    }
  }
}

export function createFoldsetProxy(options: FoldsetProxyOptions) {
  console.log("[foldset] createFoldsetProxy called");

  if (!options.apiKey) {
    console.warn("[foldset] No API key provided — proxy disabled");
    return async function proxy(_request: NextRequest) {
      return NextResponse.next();
    };
  }

  console.log("[foldset] Proxy configured with apiKey:", options.apiKey.slice(0, 12) + "...");

  return async function proxy(request: NextRequest) {
    console.log("[foldset] ---");
    console.log("[foldset] Incoming request:", request.method, request.url);

    const core = await getWorkerCore(options.apiKey);
    const adapter = new NextjsAdapter(request);

    console.log("[foldset] Host:", adapter.getHost(), "| Path:", adapter.getPath(), "| UA:", adapter.getUserAgent()?.slice(0, 60));

    const httpServer = await core.httpServer.get();
    if (!httpServer) {
      console.log("[foldset] No httpServer configured — passing through");
      return NextResponse.next();
    }

    try {
      const hostConfig = await core.hostConfig.get();
      console.log("[foldset] Host config:", JSON.stringify(hostConfig));

      const mcpEndpoint = hostConfig?.mcpEndpoint;

      if (mcpEndpoint && adapter.getPath() === mcpEndpoint) {
        console.log("[foldset] Routing to MCP handler");
        return handleMcpRequest(request, core, httpServer, adapter, mcpEndpoint);
      }

      console.log("[foldset] Routing to web handler");
      return handleWebRequest(core, httpServer, adapter);
    } catch (error) {
      console.error("[foldset] Error in proxy:", error);
      core.errorReporter.captureException(error);
      return NextResponse.next();
    }
  };
}
