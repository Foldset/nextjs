export class ProxyAdapter {
    request;
    constructor(request) {
        this.request = request;
    }
    getIpAddress() {
        return (this.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            null);
    }
    getHeader(name) {
        return this.request.headers.get(name) ?? undefined;
    }
    getMethod() {
        return this.request.method;
    }
    getPath() {
        return this.request.nextUrl.pathname;
    }
    getUrl() {
        return this.request.url;
    }
    getAcceptHeader() {
        return this.request.headers.get("Accept") || "";
    }
    getUserAgent() {
        return this.request.headers.get("User-Agent") || "";
    }
    getQueryParams() {
        const result = {};
        this.request.nextUrl.searchParams.forEach((value, key) => {
            const existing = result[key];
            if (existing) {
                result[key] = Array.isArray(existing)
                    ? [...existing, value]
                    : [existing, value];
            }
            else {
                result[key] = value;
            }
        });
        return result;
    }
    getQueryParam(name) {
        return this.getQueryParams()[name];
    }
    async getBody() {
        try {
            return await this.request.json();
        }
        catch {
            return undefined;
        }
    }
}
