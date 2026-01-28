import type { RequestAdapter } from "@foldset/core";
import type { NextRequest } from "next/server";
export declare class ProxyAdapter implements RequestAdapter {
    private request;
    constructor(request: NextRequest);
    getIpAddress(): string | null;
    getHeader(name: string): string | undefined;
    getMethod(): string;
    getPath(): string;
    getUrl(): string;
    getAcceptHeader(): string;
    getUserAgent(): string;
    getQueryParams(): Record<string, string | string[]>;
    getQueryParam(name: string): string | string[] | undefined;
    getBody(): Promise<unknown>;
}
//# sourceMappingURL=adapter.d.ts.map