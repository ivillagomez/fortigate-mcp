/**
 * FortiGate REST API Client
 * Targets FortiOS 7.6.x — single firewall, no VDOM, read-only
 */

export interface FortiGateConfig {
  host: string;       // e.g. "192.168.1.1" or "fw.example.com"
  port?: number;      // default 443
  apiKey: string;     // API token generated in FortiGate GUI
  verifySsl?: boolean; // default false (self-signed certs are common)
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

  constructor(private config: FortiGateConfig) {
    const port = config.port ?? 443;
    this.baseUrl = `https://${config.host}:${port}`;
    this.headers = {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Generic GET request to the FortiGate API
   */
  async get<T = unknown>(
    path: string,
    params?: Record<string, string | number | boolean>
  ): Promise<T> {
    const url = new URL(path, this.baseUrl);
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
  async cli(commands: string[]): Promise<string> {
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
  async getSystemStatus() {
    return this.get("/api/v2/monitor/system/status");
  }

  async getSystemPerformance() {
    return this.get("/api/v2/monitor/system/performance/status");
  }

  async getInterfaces() {
    return this.get("/api/v2/monitor/system/interface");
  }

  async getInterfaceDetails(name: string) {
    return this.get(`/api/v2/monitor/system/interface`, {
      "interface": name,
      include_vlan: true,
    });
  }

  async getRoutingTable() {
    return this.get("/api/v2/monitor/router/ipv4");
  }

  async getArpTable() {
    return this.get("/api/v2/monitor/system/arp");
  }

  async getDhcpLeases() {
    return this.get("/api/v2/monitor/system/dhcp");
  }

  // --- Firewall Policies ---
  async getPolicies(filter?: string) {
    const params: Record<string, string | number | boolean> = {};
    if (filter) params.filter = filter;
    return this.get("/api/v2/cmdb/firewall/policy", params);
  }

  async getPolicy(id: number) {
    return this.get(`/api/v2/cmdb/firewall/policy/${id}`);
  }

  async getPolicyHitCount() {
    return this.get("/api/v2/monitor/firewall/policy");
  }

  async policyLookup(params: {
    srcintf: string;
    dstintf: string;
    sourceip: string;
    destip: string;
    protocol: number;
    destport?: number;
  }) {
    return this.get("/api/v2/monitor/firewall/policy-lookup", params as Record<string, string | number | boolean>);
  }

  async getAddressObjects() {
    return this.get("/api/v2/cmdb/firewall/address");
  }

  async getAddressGroups() {
    return this.get("/api/v2/cmdb/firewall/addrgrp");
  }

  async getServiceObjects() {
    return this.get("/api/v2/cmdb/firewall.service/custom");
  }

  // --- VPN ---
  async getIpsecTunnels() {
    return this.get("/api/v2/monitor/vpn/ipsec");
  }

  async getSslVpnSessions() {
    return this.get("/api/v2/monitor/vpn/ssl");
  }

  async getVpnPhase1Config() {
    return this.get("/api/v2/cmdb/vpn.ipsec/phase1-interface");
  }

  async getVpnPhase2Config() {
    return this.get("/api/v2/cmdb/vpn.ipsec/phase2-interface");
  }

  // --- Logs ---
  async getLogs(params: {
    type: "traffic" | "event" | "utm";
    subtype: string;
    rows?: number;
    filter?: string;
  }) {
    const { type, subtype, rows, filter } = params;
    const queryParams: Record<string, string | number | boolean> = {};
    if (rows) queryParams.rows = rows;
    if (filter) queryParams.filter = filter;
    return this.get(`/api/v2/log/memory/${type}/${subtype}`, queryParams);
  }

  async getTrafficLogs(rows = 50, filter?: string) {
    return this.getLogs({ type: "traffic", subtype: "forward", rows, filter });
  }

  async getEventLogs(rows = 50, filter?: string) {
    return this.getLogs({ type: "event", subtype: "system", rows, filter });
  }

  async getSecurityLogs(rows = 50, filter?: string) {
    return this.getLogs({ type: "utm", subtype: "webfilter", rows, filter });
  }

  async getVpnEventLogs(rows = 50, filter?: string) {
    return this.getLogs({ type: "event", subtype: "vpn", rows, filter });
  }

  // --- Diagnostics ---
  async getSessions(filter?: string) {
    const params: Record<string, string | number | boolean> = {};
    if (filter) params.filter = filter;
    params.count = 50;
    return this.get("/api/v2/monitor/firewall/session", params);
  }

  async ping(host: string, count = 4) {
    const safeHost = sanitizeCliArg(host);
    const safeCount = Math.max(1, Math.min(count, 20)); // clamp 1-20
    return this.cli([`execute ping-options repeat-count ${safeCount}`, `execute ping ${safeHost}`]);
  }

  async traceroute(host: string) {
    return this.cli([`execute traceroute ${sanitizeCliArg(host)}`]);
  }

  async getDnsResolve(hostname: string) {
    return this.cli([`execute nslookup ${sanitizeCliArg(hostname)}`]);
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
