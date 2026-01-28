import { NextResponse } from "next/server";
import { handlePaymentRequest, handleSettlement, handleWebhookRequest, } from "@foldset/core";
import { getWorkerCore } from "./core";
import { ProxyAdapter } from "./adapter";
export function createFoldsetProxy(options) {
    if (!options.apiKey) {
        console.warn("No API key provided to Foldset proxy");
        return async function proxy() {
            return NextResponse.next();
        };
    }
    return async function proxy(request) {
        const core = await getWorkerCore(options.apiKey);
        const adapter = new ProxyAdapter(request);
        if (request.method === "POST" && request.nextUrl.pathname === "/foldset/webhooks") {
            try {
                const result = await handleWebhookRequest(core, adapter, await request.text());
                return new NextResponse(result.body, { status: result.status });
            }
            catch (error) {
                core.errorReporter.captureException(error);
                return NextResponse.json({ error: "Failed to process webhook" }, { status: 500 });
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
                    return new NextResponse(result.response.body, {
                        status: result.response.status,
                        headers: result.response.headers,
                    });
                case "payment-verified": {
                    // Optimistic settlement: We settle the payment before knowing the
                    // upstream response status. This avoids a fetch loop (middleware
                    // fetching its own URL) and allows us to use NextResponse.next().
                    // Trade-off: If upstream returns an error, the payment is already settled.
                    // TODO rfradkin: This is a bit of a hack, figure out a workaround
                    const settlement = await handleSettlement(core, httpServer, adapter, result.paymentPayload, result.paymentRequirements, 200);
                    if (!settlement.success) {
                        return NextResponse.json({
                            error: "Settlement failed",
                            details: settlement.errorReason,
                        }, { status: 402 });
                    }
                    const response = NextResponse.next();
                    for (const [key, value] of Object.entries(settlement.headers)) {
                        response.headers.set(key, value);
                    }
                    return response;
                }
            }
        }
        catch (error) {
            core.errorReporter.captureException(error);
            return NextResponse.next();
        }
    };
}
