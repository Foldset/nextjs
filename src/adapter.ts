import type { RequestAdapter } from "@foldset/core";
import type { NextRequest } from "next/server";

export class NextjsAdapter implements RequestAdapter {
  constructor(private request: NextRequest) { }

  getIpAddress(): string | null {
    return (
      this.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      null
    );
  }

  getHeader(name: string): string | undefined {
    return this.request.headers.get(name) ?? undefined;
  }

  getMethod(): string {
    return this.request.method;
  }

  getPath(): string {
    return this.request.nextUrl.pathname;
  }

  getUrl(): string {
    return this.request.url;
  }

  getHost(): string {
    return this.request.nextUrl.hostname;
  }

  getAcceptHeader(): string {
    return this.request.headers.get("Accept") || "";
  }

  getUserAgent(): string {
    return this.request.headers.get("User-Agent") || "";
  }

  getQueryParams(): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    this.request.nextUrl.searchParams.forEach((value, key) => {
      const existing = result[key];
      if (existing) {
        result[key] = Array.isArray(existing)
          ? [...existing, value]
          : [existing, value];
      } else {
        result[key] = value;
      }
    });
    return result;
  }

  getQueryParam(name: string): string | string[] | undefined {
    return this.getQueryParams()[name];
  }

  async getBody(): Promise<unknown> {
    try {
      return await this.request.json();
    } catch {
      return undefined;
    }
  }
}
