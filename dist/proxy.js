import { NextResponse } from "next/server";
import { handlePaymentRequest, handleSettlement, handleWebhookRequest, } from "@foldset/core";
import { getWorkerCore } from "./core";
import { NextjsAdapter } from "./adapter";
export function createFoldsetProxy(options) {
    // TODO rfradkin: This might cause bugs check if the api key can switch.
    if (!options.apiKey) {
        console.warn("No API key provided to Foldset proxy");
        return async function proxy(request) {
            return NextResponse.next();
        };
    }
    return async function proxy(request) {
        const core = await getWorkerCore(options.apiKey);
        const adapter = new NextjsAdapter(request);
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
                    // HACK: Optimistically assume the upstream will return 200 and
                    // settle immediately. This avoids the bypass-header / re-fetch
                    // loop but means we settle even if the upstream later errors.
                    // This is bad — a proper fix would be offline/async settlement
                    // with refunds on upstream failure, or a post-response hook to
                    // settle after the real status code is known.
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
