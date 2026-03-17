/**
 * FortiGate REST API Client
 * Targets FortiOS 7.6.x — single firewall, read-only
 * Supports VDOM: pass ?vdom=name on all API calls.
 * On non-VDOM firewalls, ?vdom=root is silently ignored by FortiOS.
 */

export interface FortiGateConfig {
  host: string;       // e.g. "192.168.1.1" or "fw.example.com"
  port?: number;      // default 443
  apiKey: string;     // API token generated in FortiGate GUI
  verifySsl?: boolean; // default false (self-signed certs are common)
  vdom?: string;      // default "root" — safe on non-VDOM firewalls (FortiOS ignores it)
}

export interface ApiResponse<T = unknown> {
  status: string;
  http_status: number;
  results: T;
  vdom?: string;
  serial?: string;
  version?: string;
  build?: number;
  revision?: string;
}

/**
 * Sanitize a CLI argument to prevent command injection.
 * Only allows alphanumeric, dots, hyphens, colons, and slashes (for IPs, hostnames, CIDRs).
 */
function sanitizeCliArg(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9.\-_:\/]/g, "");
  if (sanitized.length === 0) {
    throw new Error(`Invalid CLI argument: "${input}"`);
  }
  if (sanitized !== input) {
    throw new Error(`CLI argument contains invalid characters: "${input}" (only alphanumeric, dots, hyphens, underscores, colons, slashes allowed)`);
  }
  return sanitized;
}

export class FortiGateAPI {
  private baseUrl: string;
  private headers: Record<string, string>;
  private defaultVdom: string;
  private apiKey: string;

  constructor(private config: FortiGateConfig) {
    const port = config.port ?? 443;
    this.baseUrl = `https://${config.host}:${port}`;
    this.defaultVdom = config.vdom ?? "root";
    this.apiKey = config.apiKey;
    this.headers = {
      "Content-Type": "application/json",
    };
  }

  /**
   * Get the effective VDOM name. Per-call override takes priority over config default.
   * On non-VDOM firewalls, passing ?vdom=root is harmless — FortiOS ignores it.
   */
  getVdom(override?: string): string {
    return override ?? this.defaultVdom;
  }

  /**
   * Generic GET request to the FortiGate API.
   * Automatically injects ?vdom= on every request.
   */
  async get<T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean>,
    vdom?: string,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);

    // Auth via query parameter (FortiOS 7.6.x requires this over Bearer header)
    url.searchParams.set("access_token", this.apiKey);

    // Always inject VDOM — safe on non-VDOM firewalls
    url.searchParams.set("vdom", this.getVdom(vdom));

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, String(value));
      }
    }

    const resp = await fetch(url.toString(), {
      method: "GET",
      headers: this.headers,
      // @ts-expect-error — Node 22 fetch supports this for self-signed certs
      dispatcher: this.config.verifySsl === true ? undefined : await this.getUnsafeAgent(),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`FortiGate API error ${resp.status}: ${body}`);
    }

    return resp.json() as Promise<T>;
  }

  /**
   * Execute a read-only CLI command via the API
   */
  async cli(commands: string[], vdom?: string): Promise<string> {
    // Safety: block any write/config/destructive commands
    const blocked = [
      "config ", "set ", "delete ", "edit ", "append ", "end",
      "execute shutdown", "execute reboot", "execute factoryreset",
      "execute restore", "execute batch", "execute backup",
      "execute format", "execute disk",
    ];
    for (const cmd of commands) {
      const lower = cmd.toLowerCase().trim();
      for (const b of blocked) {
        if (lower.startsWith(b)) {
          throw new Error(`Blocked: "${cmd}" is a write operation. This server is read-only.`);
        }
      }
    }

    const url = new URL("/api/v2/monitor/system/cli", this.baseUrl);
    url.searchParams.set("access_token", this.apiKey);
    url.searchParams.set("vdom", this.getVdom(vdom));
    const resp = await fetch(url.toString(), {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ commands }),
      // @ts-expect-error — Node 22 fetch
      dispatcher: this.config.verifySsl === true ? undefined : await this.getUnsafeAgent(),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`FortiGate CLI error ${resp.status}: ${body}`);
    }

    const data = await resp.json() as ApiResponse<Array<{ response: string }>>;
    return data.results.map((r) => r.response).join("\n");
  }

  // --- System ---
  async getSystemStatus(vdom?: string) {
    return this.get("/api/v2/monitor/system/status", undefined, vdom);
  }

  async getSystemPerformance(vdom?: string) {
    return this.get("/api/v2/monitor/system/performance/status", undefined, vdom);
  }

  async getInterfaces(vdom?: string) {
    return this.get("/api/v2/monitor/system/interface", undefined, vdom);
  }

  async getInterfaceDetails(name: string, vdom?: string) {
    return this.get(`/api/v2/monitor/system/interface`, {
      "interface": name,
      include_vlan: true,
    }, vdom);
  }

  async getRoutingTable(vdom?: string) {
    return this.get("/api/v2/monitor/router/ipv4", undefined, vdom);
  }

  async getArpTable(vdom?: string) {
    return this.get("/api/v2/monitor/system/arp", undefined, vdom);
  }

  async getDhcpLeases(vdom?: string) {
    return this.get("/api/v2/monitor/system/dhcp", undefined, vdom);
  }

  // --- Firewall Policies ---
  async getPolicies(filter?: string, vdom?: string) {
    const params: Record<string, string | number | boolean> = {};
    if (filter) params.filter = filter;
    return this.get("/api/v2/cmdb/firewall/policy", params, vdom);
  }

  async getPolicy(id: number, vdom?: string) {
    return this.get(`/api/v2/cmdb/firewall/policy/${id}`, undefined, vdom);
  }

  async getPolicyHitCount(vdom?: string) {
    return this.get("/api/v2/monitor/firewall/policy", undefined, vdom);
  }

  async policyLookup(params: {
    srcintf: string;
    dstintf: string;
    sourceip: string;
    destip: string;
    protocol: number;
    destport?: number;
  }, vdom?: string) {
    return this.get("/api/v2/monitor/firewall/policy-lookup", params as Record<string, string | number | boolean>, vdom);
  }

  async getAddressObjects(vdom?: string) {
    return this.get("/api/v2/cmdb/firewall/address", undefined, vdom);
  }

  async getAddressGroups(vdom?: string) {
    return this.get("/api/v2/cmdb/firewall/addrgrp", undefined, vdom);
  }

  async getServiceObjects(vdom?: string) {
    return this.get("/api/v2/cmdb/firewall.service/custom", undefined, vdom);
  }

  // --- VPN ---
  async getIpsecTunnels(vdom?: string) {
    return this.get("/api/v2/monitor/vpn/ipsec", undefined, vdom);
  }

  async getSslVpnSessions(vdom?: string) {
    return this.get("/api/v2/monitor/vpn/ssl", undefined, vdom);
  }

  async getVpnPhase1Config(vdom?: string) {
    return this.get("/api/v2/cmdb/vpn.ipsec/phase1-interface", undefined, vdom);
  }

  async getVpnPhase2Config(vdom?: string) {
    return this.get("/api/v2/cmdb/vpn.ipsec/phase2-interface", undefined, vdom);
  }

  // --- Logs ---
  async getLogs(params: {
    type: "traffic" | "event" | "utm";
    subtype: string;
    rows?: number;
    filter?: string;
    vdom?: string;
  }) {
    const { type, subtype, rows, filter, vdom } = params;
    const queryParams: Record<string, string | number | boolean> = {};
    if (rows) queryParams.rows = rows;
    if (filter) queryParams.filter = filter;
    return this.get(`/api/v2/log/memory/${type}/${subtype}`, queryParams, vdom);
  }

  async getTrafficLogs(rows = 50, filter?: string, vdom?: string) {
    return this.getLogs({ type: "traffic", subtype: "forward", rows, filter, vdom });
  }

  async getEventLogs(rows = 50, filter?: string, vdom?: string) {
    return this.getLogs({ type: "event", subtype: "system", rows, filter, vdom });
  }

  async getSecurityLogs(rows = 50, filter?: string, vdom?: string) {
    return this.getLogs({ type: "utm", subtype: "webfilter", rows, filter, vdom });
  }

  async getVpnEventLogs(rows = 50, filter?: string, vdom?: string) {
    return this.getLogs({ type: "event", subtype: "vpn", rows, filter, vdom });
  }

  // --- Diagnostics ---
  async getSessions(filter?: string, vdom?: string) {
    const params: Record<string, string | number | boolean> = {};
    if (filter) params.filter = filter;
    params.count = 50;
    return this.get("/api/v2/monitor/firewall/session", params, vdom);
  }

  async ping(host: string, count = 4, vdom?: string) {
    const safeHost = sanitizeCliArg(host);
    const safeCount = Math.max(1, Math.min(count, 20)); // clamp 1-20
    return this.cli([`execute ping-options repeat-count ${safeCount}`, `execute ping ${safeHost}`], vdom);
  }

  async traceroute(host: string, vdom?: string) {
    return this.cli([`execute traceroute ${sanitizeCliArg(host)}`], vdom);
  }

  async getDnsResolve(hostname: string, vdom?: string) {
    return this.cli([`execute nslookup ${sanitizeCliArg(hostname)}`], vdom);
  }

  // --- TLS bypass for self-signed certs (per-client, not global) ---
  private unsafeAgent: unknown = null;

  private async getUnsafeAgent() {
    if (this.unsafeAgent) return this.unsafeAgent;
    try {
      const undici = await import("undici");
      this.unsafeAgent = new undici.Agent({
        connect: { rejectUnauthorized: false },
      });
    } catch {
      // If undici is unavailable, warn but don't disable TLS globally
      console.error("Warning: Could not create TLS-bypass agent. Self-signed certs may fail. Install 'undici' or set FORTIGATE_VERIFY_SSL=true with a valid certificate.");
    }
    return this.unsafeAgent;
  }
}
