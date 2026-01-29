import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  handlePaymentRequest,
  handleSettlement,
  handleWebhookRequest,
} from "@foldset/core";

import type { FoldsetProxyOptions } from "./types";
import { getWorkerCore } from "./core";
import { NextjsAdapter } from "./adapter";

const BYPASS_HEADER = "x-foldset-bypass";

export function createFoldsetProxy(options: FoldsetProxyOptions) {
  // TODO rfradkin: This might cause bugs check if the api key can switch.
  if (!options.apiKey) {
    console.warn("No API key provided to Foldset proxy");
    return async function proxy(request: NextRequest) {
      return NextResponse.next();
    };
  }
  return async function proxy(request: NextRequest) {
    // Skip proxy on upstream fetch to prevent infinite loop
    // Use API key as value so external requests can't spoof the bypass
    if (request.headers.get(BYPASS_HEADER) === options.apiKey) {
      return NextResponse.next();
    }

    const core = await getWorkerCore(options.apiKey);
    const adapter = new NextjsAdapter(request);

    if (request.method === "POST" && request.nextUrl.pathname === "/foldset/webhooks") {
      try {
        const result = await handleWebhookRequest(
          core,
          adapter,
          await request.text(),
        );
        return new NextResponse(result.body, { status: result.status });
      } catch (error) {
        core.errorReporter.captureException(error);
        return NextResponse.json(
          { error: "Failed to process webhook" },
          { status: 500 },
        );
      }
    }

    const httpServer = await core.httpServer.get();
    if (!httpServer) {
      return NextResponse.next();
    }

    try {
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
          const upstreamHeaders = new Headers(request.headers);
          upstreamHeaders.set(BYPASS_HEADER, options.apiKey);
          const upstream = await fetch(request.url, {
            method: request.method,
            headers: upstreamHeaders,
            body: request.body,
          });

          const settlement = await handleSettlement(
            core,
            httpServer,
            adapter,
            result.paymentPayload,
            result.paymentRequirements,
            upstream.status,
          );

          if (!settlement.success) {
            return NextResponse.json(
              {
                error: "Settlement failed",
                details: settlement.errorReason,
              },
              { status: 402 },
            );
          }

          const response = new NextResponse(upstream.body, {
            status: upstream.status,
            statusText: upstream.statusText,
            headers: new Headers(upstream.headers),
          });
          for (const [key, value] of Object.entries(settlement.headers)) {
            response.headers.set(key, value);
          }
          return response;
        }
      }
    } catch (error) {
      core.errorReporter.captureException(error);
      return NextResponse.next();
    }
  };
}
