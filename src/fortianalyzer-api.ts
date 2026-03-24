/**
 * FortiAnalyzer JSON-RPC API Client
 * Targets FortiAnalyzer 7.6.x — read-only log queries, device management, reports
 *
 * All calls go to POST /jsonrpc with session-based or API token auth.
 * Log searches are async: create task → poll progress → fetch results → cleanup.
 */

export interface FortiAnalyzerConfig {
  host: string;
  port?: number;         // default 443
  username?: string;     // for session-based auth
  password?: string;     // for session-based auth
  apiToken?: string;     // alternative: API token (no login/logout needed)
  adom?: string;         // default "root"
  verifySsl?: boolean;   // default true — set to false only for self-signed certs in isolated lab environments
}

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params: Record<string, unknown>[];
  session: string | null;
  id: number;
}

/**
 * FAZ JSON-RPC responses have two shapes:
 *   - Standard:    { result: [{ data, status, url }] }
 *   - Log search:  { result: { tid: number } }       (create task)
 * We model `result` as `unknown` and extract safely in each call site.
 */
interface JsonRpcResponse {
  result: unknown;
  session?: string;
  id: number;
  error?: { code: number; message: string };
}

/** Helper: normalise result into the standard array-of-objects shape when possible */
function resultArray(resp: JsonRpcResponse): Array<{ data?: unknown; status?: { code: number; message: string }; url?: string }> {
  if (Array.isArray(resp.result)) return resp.result as Array<{ data?: unknown; status?: { code: number; message: string }; url?: string }>;
  return [];
}

/**
 * Sanitize a path parameter to prevent path traversal in JSON-RPC URLs.
 * Only allows alphanumeric, hyphens, underscores, and dots.
 */
function sanitizePath(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9.\-_]/g, "");
  if (sanitized.length === 0) {
    throw new Error(`Invalid path parameter: "${input}"`);
  }
  if (sanitized !== input) {
    throw new Error(`Path parameter contains invalid characters: "${input}"`);
  }
  return sanitized;
}

export class FortiAnalyzerAPI {
  private baseUrl: string;
  private session: string | null = null;
  private adom: string;
  private requestId = 0;
  private unsafeAgent: unknown = null;

  constructor(private config: FortiAnalyzerConfig) {
    const port = config.port ?? 443;
    this.baseUrl = `https://${config.host}:${port}/jsonrpc`;
    this.adom = config.adom ?? "root";
  }

  // -------------------------------------------------------------------------
  // Core JSON-RPC transport
  // -------------------------------------------------------------------------

  private async rpc(method: string, params: Record<string, unknown>[]): Promise<JsonRpcResponse> {
    const request: JsonRpcRequest = {
      jsonrpc: "2.0",
      method,
      params,
      session: this.config.apiToken ? null : this.session,
      id: ++this.requestId,
    };

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.config.apiToken) {
      headers["Authorization"] = `Bearer ${this.config.apiToken}`;
    }

    const resp = await fetch(this.baseUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      // @ts-expect-error — Node 22 fetch supports dispatcher for self-signed certs
      dispatcher: this.config.verifySsl === false ? await this.getUnsafeAgent() : undefined,
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`FortiAnalyzer HTTP error ${resp.status}: ${body}`);
    }

    const data = await resp.json() as JsonRpcResponse;

    // Check for JSON-RPC-level errors (e.g. invalid params)
    if (data.error) {
      throw new Error(`FortiAnalyzer RPC error ${data.error.code}: ${data.error.message}`);
    }

    // Check for API-level errors (standard array response shape)
    const arr = resultArray(data);
    if (arr.length > 0 && arr[0].status && arr[0].status.code !== 0) {
      const status = arr[0].status;
      throw new Error(`FortiAnalyzer API error ${status.code}: ${status.message}`);
    }

    return data;
  }

  // -------------------------------------------------------------------------
  // Authentication (session-based — only needed if no API token)
  // -------------------------------------------------------------------------

  async login(): Promise<void> {
    if (this.config.apiToken) return; // token auth, no login needed

    if (!this.config.username || !this.config.password) {
      throw new Error("FortiAnalyzer requires username/password or apiToken");
    }

    const resp = await this.rpc("exec", [{
      url: "/sys/login/user",
      data: {
        user: this.config.username,
        passwd: this.config.password,
      },
    }]);

    if (resp.session) {
      this.session = resp.session;
    } else {
      throw new Error("FortiAnalyzer login failed: no session token returned");
    }
  }

  async logout(): Promise<void> {
    if (this.config.apiToken) return; // token auth, no logout needed
    if (!this.session) return;

    try {
      await this.rpc("exec", [{ url: "/sys/logout" }]);
    } catch {
      // Ignore logout errors
    }
    this.session = null;
  }

  /**
   * Ensure we have an active session, login if needed
   */
  private async ensureSession(): Promise<void> {
    if (!this.session) {
      await this.login();
    }
  }

  /**
   * Execute an operation with automatic session management.
   * For session-based auth, logs in if needed and handles session expiry.
   */
  async withSession<T>(fn: () => Promise<T>): Promise<T> {
    await this.ensureSession();
    try {
      return await fn();
    } catch (err) {
      // If session expired, retry once with a fresh login
      if (err instanceof Error && err.message.includes("-11")) {
        this.session = null;
        await this.ensureSession();
        return await fn();
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Device & ADOM Management
  // -------------------------------------------------------------------------

  async listAdoms(): Promise<unknown> {
    return this.withSession(async () => {
      const resp = await this.rpc("get", [{
        url: "/dvmdb/adom",
      }]);
      return resultArray(resp)[0]?.data;
    });
  }

  async listDevices(adom?: string): Promise<unknown> {
    const targetAdom = sanitizePath(adom ?? this.adom);
    return this.withSession(async () => {
      const resp = await this.rpc("get", [{
        url: `/dvmdb/adom/${targetAdom}/device`,
        option: ["no loadsub"],
      }]);
      return resultArray(resp)[0]?.data;
    });
  }

  async getDevice(deviceName: string, adom?: string): Promise<unknown> {
    const targetAdom = sanitizePath(adom ?? this.adom);
    const safeDevice = sanitizePath(deviceName);
    return this.withSession(async () => {
      const resp = await this.rpc("get", [{
        url: `/dvmdb/adom/${targetAdom}/device/${safeDevice}`,
      }]);
      return resultArray(resp)[0]?.data;
    });
  }

  // -------------------------------------------------------------------------
  // Log Search (async: create → poll → fetch → cleanup)
  // -------------------------------------------------------------------------

  async searchLogs(params: {
    logtype: string;
    filter?: string;
    device?: string;
    timeStart?: string;  // ISO 8601
    timeEnd?: string;    // ISO 8601
    limit?: number;
    adom?: string;
  }): Promise<unknown> {
    const targetAdom = sanitizePath(params.adom ?? this.adom);
    const limit = Math.max(1, Math.min(params.limit ?? 100, 1000)); // clamp 1-1000

    return this.withSession(async () => {
      // Step 1: Create search task
      const searchParams: Record<string, unknown> = {
        apiver: 3,
        url: `/logview/adom/${targetAdom}/logsearch`,
        "logtype": params.logtype,
        "time-order": "desc",
        "case-sensitive": false,
      };

      if (params.device) {
        searchParams.device = [{ devid: params.device }];
      } else {
        searchParams.device = [{ devid: "All_FortiGate" }];
      }

      if (params.filter) {
        searchParams.filter = params.filter;
      }

      // time-range is REQUIRED by FAZ — default to last 24 hours if not specified
      if (params.timeStart && params.timeEnd) {
        searchParams["time-range"] = {
          start: params.timeStart,
          end: params.timeEnd,
        };
      } else {
        const now = new Date();
        const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        const fmt = (d: Date) => d.toISOString().replace("T", " ").substring(0, 19);
        searchParams["time-range"] = {
          start: fmt(dayAgo),
          end: fmt(now),
        };
      }

      const createResp = await this.rpc("add", [searchParams]);

      // FAZ returns { result: { tid: number } } for search creation (not the standard array shape)
      const tid = (createResp.result as { tid?: number })?.tid
        ?? (resultArray(createResp)[0]?.data as { tid?: number })?.tid;

      if (!tid) {
        throw new Error("FortiAnalyzer log search failed: no task ID returned");
      }

      try {
        // Step 2: Poll until complete (max 90 seconds — large searches can take over 60s)
        let progress = 0;
        const maxWait = 90000;
        const startTime = Date.now();

        while (progress < 100 && (Date.now() - startTime) < maxWait) {
          await new Promise((resolve) => setTimeout(resolve, 2000));

          const countResp = await this.rpc("get", [{
            apiver: 3,
            url: `/logview/adom/${targetAdom}/logsearch/count/${tid}`,
          }]);

          // Poll response shape: { result: { progress-percent, matched-logs, ... } }
          // FAZ returns result as a plain object (not array) for log search operations
          const countData = (countResp.result ?? {}) as {
            "progress-percent"?: number;
            "matched-logs"?: number;
          };
          progress = countData["progress-percent"] ?? 0;
        }

        // Step 3: Fetch results
        // Fetch response: { result: { data: [...logs], total-count, percentage, ... } }
        const fetchResp = await this.rpc("get", [{
          apiver: 3,
          url: `/logview/adom/${targetAdom}/logsearch/${tid}`,
          limit,
          offset: 0,
        }]);

        // Extract log entries — FAZ returns fetch results as:
        //   { result: { data: [...logs], total-count, percentage, ... } }
        // The result is a plain object (not array) with logs nested in .data
        const fetchResult = fetchResp.result as {
          data?: unknown[];
          "total-count"?: number;
          percentage?: number;
        } | undefined;

        if (fetchResult && Array.isArray(fetchResult.data)) {
          return fetchResult.data;
        }

        // Fallback: try standard array shape (result[0].data)
        const arrResult = resultArray(fetchResp)[0]?.data;
        if (arrResult) return arrResult;

        return fetchResult ?? [];
      } finally {
        // Step 4: Cleanup — always delete the search task
        try {
          await this.rpc("delete", [{
            apiver: 3,
            url: `/logview/adom/${targetAdom}/logsearch/${tid}`,
          }]);
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  }

  // Convenience methods for common log types

  async getTrafficLogs(params: {
    filter?: string;
    device?: string;
    timeStart?: string;
    timeEnd?: string;
    limit?: number;
    adom?: string;
  } = {}): Promise<unknown> {
    return this.searchLogs({ logtype: "traffic", ...params });
  }

  async getEventLogs(params: {
    filter?: string;
    device?: string;
    timeStart?: string;
    timeEnd?: string;
    limit?: number;
    adom?: string;
  } = {}): Promise<unknown> {
    return this.searchLogs({ logtype: "event", ...params });
  }

  async getSecurityLogs(params: {
    filter?: string;
    device?: string;
    timeStart?: string;
    timeEnd?: string;
    limit?: number;
    adom?: string;
  } = {}): Promise<unknown> {
    return this.searchLogs({ logtype: "virus", ...params });
  }

  async getIpsLogs(params: {
    filter?: string;
    device?: string;
    timeStart?: string;
    timeEnd?: string;
    limit?: number;
    adom?: string;
  } = {}): Promise<unknown> {
    return this.searchLogs({ logtype: "attack", ...params });
  }

  async getWebfilterLogs(params: {
    filter?: string;
    device?: string;
    timeStart?: string;
    timeEnd?: string;
    limit?: number;
    adom?: string;
  } = {}): Promise<unknown> {
    return this.searchLogs({ logtype: "webfilter", ...params });
  }

  async getAppCtrlLogs(params: {
    filter?: string;
    device?: string;
    timeStart?: string;
    timeEnd?: string;
    limit?: number;
    adom?: string;
  } = {}): Promise<unknown> {
    return this.searchLogs({ logtype: "app-ctrl", ...params });
  }

  async getVpnLogs(params: {
    filter?: string;
    device?: string;
    timeStart?: string;
    timeEnd?: string;
    limit?: number;
    adom?: string;
  } = {}): Promise<unknown> {
    return this.searchLogs({ logtype: "event", filter: params.filter ? `subtype=vpn AND ${params.filter}` : "subtype=vpn", ...params });
  }

  async getDnsLogs(params: {
    filter?: string;
    device?: string;
    timeStart?: string;
    timeEnd?: string;
    limit?: number;
    adom?: string;
  } = {}): Promise<unknown> {
    return this.searchLogs({ logtype: "dns", ...params });
  }

  // -------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------

  async listReportTemplates(adom?: string): Promise<unknown> {
    const targetAdom = sanitizePath(adom ?? this.adom);
    return this.withSession(async () => {
      const resp = await this.rpc("get", [{
        url: `/report/adom/${targetAdom}/template/list`,
      }]);
      return resultArray(resp)[0]?.data;
    });
  }

  async listReportLayouts(adom?: string): Promise<unknown> {
    const targetAdom = sanitizePath(adom ?? this.adom);
    return this.withSession(async () => {
      const resp = await this.rpc("get", [{
        url: `/report/adom/${targetAdom}/layout/list`,
      }]);
      return resultArray(resp)[0]?.data;
    });
  }

  // -------------------------------------------------------------------------
  // System Info
  // -------------------------------------------------------------------------

  async getSystemStatus(): Promise<unknown> {
    return this.withSession(async () => {
      const resp = await this.rpc("get", [{
        url: "/sys/status",
      }]);
      return resultArray(resp)[0]?.data;
    });
  }

  // -------------------------------------------------------------------------
  // TLS bypass for self-signed certs
  // -------------------------------------------------------------------------

  private async getUnsafeAgent() {
    if (this.unsafeAgent) return this.unsafeAgent;
    try {
      const undici = await import("undici");
      this.unsafeAgent = new undici.Agent({
        connect: { rejectUnauthorized: false },
      });
    } catch {
      console.error("Warning: Could not create TLS-bypass agent. Self-signed certs may fail. Install 'undici' or set FAZ_VERIFY_SSL=true with a valid certificate.");
    }
    return this.unsafeAgent;
  }
}
