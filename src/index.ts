#!/usr/bin/env node
/**
 * FortiGate / FortiAnalyzer MCP Server
 * Natural language firewall troubleshooting via Model Context Protocol
 *
 * Supports three deployment modes:
 *   1. FortiGate only  — single firewall (REST API + optional SSH)
 *   2. FortiAnalyzer only — centralized logs, device mgmt, reports
 *   3. Both — FAZ for logs/analytics, FortiGate for live status/diagnostics
 *
 * Read-only tools for: system status, interfaces, routing, firewall policies,
 * VPN tunnels, logs, sessions, reports, and diagnostics.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer, IncomingMessage } from "node:http";
import { z } from "zod";
import { FortiGateAPI } from "./fortigate-api.js";
import { FortiGateSSH } from "./fortigate-ssh.js";
import { FortiAnalyzerAPI } from "./fortianalyzer-api.js";

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

// FortiGate config (optional when using FAZ-only mode)
const FG_HOST = process.env.FORTIGATE_HOST;
const FG_PORT = Number(process.env.FORTIGATE_PORT ?? "443");
const FG_API_KEY = process.env.FORTIGATE_API_KEY;
const FG_VERIFY_SSL = process.env.FORTIGATE_VERIFY_SSL === "true";
const FG_VDOM = process.env.FORTIGATE_VDOM ?? "root"; // safe on non-VDOM firewalls

// SSH config (optional)
const FG_SSH_USER = process.env.FORTIGATE_SSH_USER;
const FG_SSH_PASSWORD = process.env.FORTIGATE_SSH_PASSWORD;
const FG_SSH_KEY = process.env.FORTIGATE_SSH_KEY;
const FG_SSH_PORT = Number(process.env.FORTIGATE_SSH_PORT ?? "22");

// FortiAnalyzer config (optional)
const FAZ_HOST = process.env.FAZ_HOST;
const FAZ_PORT = Number(process.env.FAZ_PORT ?? "443");
const FAZ_USER = process.env.FAZ_USER;
const FAZ_PASSWORD = process.env.FAZ_PASSWORD;
const FAZ_API_TOKEN = process.env.FAZ_API_TOKEN;
const FAZ_ADOM = process.env.FAZ_ADOM ?? "root";
const FAZ_VERIFY_SSL = process.env.FAZ_VERIFY_SSL === "true";

// Validate: need at least one of FortiGate or FortiAnalyzer
const hasFG = !!(FG_HOST && FG_API_KEY);
const hasFAZ = !!(FAZ_HOST && (FAZ_API_TOKEN || (FAZ_USER && FAZ_PASSWORD)));

if (!hasFG && !hasFAZ) {
  console.error("Missing config: set FORTIGATE_HOST + FORTIGATE_API_KEY and/or FAZ_HOST + FAZ_API_TOKEN (or FAZ_USER + FAZ_PASSWORD)");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Initialize clients
// ---------------------------------------------------------------------------

let fg: FortiGateAPI | null = null;
if (hasFG) {
  fg = new FortiGateAPI({
    host: FG_HOST!,
    port: FG_PORT,
    apiKey: FG_API_KEY!,
    verifySsl: FG_VERIFY_SSL,
    vdom: FG_VDOM,
  });
  console.error(`FortiGate REST API: ${FG_HOST}:${FG_PORT} (VDOM: ${FG_VDOM})`);
}

let fgSsh: FortiGateSSH | null = null;
if (FG_SSH_USER && (FG_SSH_PASSWORD || FG_SSH_KEY)) {
  fgSsh = new FortiGateSSH({
    host: FG_HOST ?? FAZ_HOST!,  // SSH to FortiGate host, or FAZ host as fallback
    port: FG_SSH_PORT,
    username: FG_SSH_USER,
    password: FG_SSH_PASSWORD,
    privateKey: FG_SSH_KEY,
  });
  console.error(`SSH enabled for ${FG_SSH_USER}@${FG_HOST ?? FAZ_HOST}:${FG_SSH_PORT}`);
}

let faz: FortiAnalyzerAPI | null = null;
if (hasFAZ) {
  faz = new FortiAnalyzerAPI({
    host: FAZ_HOST!,
    port: FAZ_PORT,
    username: FAZ_USER,
    password: FAZ_PASSWORD,
    apiToken: FAZ_API_TOKEN,
    adom: FAZ_ADOM,
    verifySsl: FAZ_VERIFY_SSL,
  });
  console.error(`FortiAnalyzer: ${FAZ_HOST}:${FAZ_PORT} (ADOM: ${FAZ_ADOM})`);
}

// Log the mode
if (hasFG && hasFAZ) {
  console.error("Mode: FortiGate + FortiAnalyzer (hybrid)");
} else if (hasFAZ) {
  console.error("Mode: FortiAnalyzer only");
} else {
  console.error("Mode: FortiGate only");
}

// ---------------------------------------------------------------------------
// Helper: format API results as readable text
// ---------------------------------------------------------------------------
function formatResult(data: unknown): string {
  if (typeof data === "string") return data;
  return JSON.stringify(data, null, 2);
}

async function safeCall<T>(fn: () => Promise<T>): Promise<string> {
  try {
    const result = await fn();
    return formatResult(result);
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function requireFG(toolName: string): FortiGateAPI {
  if (!fg) throw new Error(`${toolName} requires FortiGate REST API (set FORTIGATE_HOST + FORTIGATE_API_KEY)`);
  return fg;
}

function requireFAZ(toolName: string): FortiAnalyzerAPI {
  if (!faz) throw new Error(`${toolName} requires FortiAnalyzer (set FAZ_HOST + FAZ_API_TOKEN or FAZ_USER/FAZ_PASSWORD)`);
  return faz;
}

// ---------------------------------------------------------------------------
// MCP Server factory — one instance per connection (required for SSE multi-user)
// ---------------------------------------------------------------------------
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "fortigate",
    version: "2.0.0",
  });

  // ========================== SYSTEM / NETWORK ===============================
  // (FortiGate REST API tools — registered only if FG is configured)

  // Helper: VDOM description for tool parameters
  const vdomDesc = `VDOM name to query (default: "${FG_VDOM}"). On non-VDOM firewalls, this is safely ignored.`;

if (hasFG) {
  server.tool(
    "get_system_status",
    "Get FortiGate system status: hostname, firmware version, serial, uptime, and resource usage",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_system_status").getSystemStatus(vdom)) }],
    })
  );

  server.tool(
    "get_system_performance",
    "Get real-time CPU, memory, and session counts",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_system_performance").getSystemPerformance(vdom)) }],
    })
  );

  server.tool(
    "get_interfaces",
    "List all network interfaces with status, IP, speed, and traffic counters",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_interfaces").getInterfaces(vdom)) }],
    })
  );

  server.tool(
    "get_interface_details",
    "Get detailed info for a specific interface (status, IP, speed, counters, VLAN)",
    {
      name: z.string().describe("Interface name, e.g. 'port1', 'wan1', 'internal'"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ name, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_interface_details").getInterfaceDetails(name, vdom)) }],
    })
  );

  server.tool(
    "get_routing_table",
    "Show the IPv4 routing table (connected, static, dynamic routes)",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_routing_table").getRoutingTable(vdom)) }],
    })
  );

  server.tool(
    "get_arp_table",
    "Show the ARP table (IP-to-MAC mappings)",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_arp_table").getArpTable(vdom)) }],
    })
  );

  server.tool(
    "get_dhcp_leases",
    "List active DHCP leases issued by the firewall",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_dhcp_leases").getDhcpLeases(vdom)) }],
    })
  );

  // ========================== FIREWALL POLICIES ==============================

  server.tool(
    "get_policies",
    "List firewall policies. Optionally filter by field (e.g. name, srcintf, dstintf, action)",
    {
      filter: z.string().optional().describe(
        "API filter string, e.g. 'name==@VPN' or 'srcintf==port1'. Use @ for contains match."
      ),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ filter, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_policies").getPolicies(filter, vdom)) }],
    })
  );

  server.tool(
    "get_policy",
    "Get a specific firewall policy by its ID",
    {
      id: z.number().describe("Policy ID number"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ id, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_policy").getPolicy(id, vdom)) }],
    })
  );

  server.tool(
    "get_policy_hit_count",
    "Get hit counts and byte/packet counters for all policies (useful for finding unused rules)",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_policy_hit_count").getPolicyHitCount(vdom)) }],
    })
  );

  server.tool(
    "policy_lookup",
    "Find which policy matches specific traffic (source/dest IP, port, protocol). Essential for troubleshooting blocked traffic.",
    {
      srcintf: z.string().describe("Source interface, e.g. 'port1', 'internal'"),
      dstintf: z.string().describe("Destination interface, e.g. 'wan1', 'port2'"),
      sourceip: z.string().describe("Source IP address, e.g. '10.0.1.50'"),
      destip: z.string().describe("Destination IP address, e.g. '8.8.8.8'"),
      protocol: z.number().describe("IP protocol number: 6=TCP, 17=UDP, 1=ICMP"),
      destport: z.number().optional().describe("Destination port (for TCP/UDP), e.g. 443"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom, ...params }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("policy_lookup").policyLookup(params, vdom)) }],
    })
  );

  server.tool(
    "get_address_objects",
    "List firewall address objects (subnets, FQDNs, IP ranges used in policies)",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_address_objects").getAddressObjects(vdom)) }],
    })
  );

  server.tool(
    "get_address_groups",
    "List firewall address groups",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_address_groups").getAddressGroups(vdom)) }],
    })
  );

  server.tool(
    "get_service_objects",
    "List custom firewall service objects (ports/protocols used in policies)",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_service_objects").getServiceObjects(vdom)) }],
    })
  );

  // ========================== VPN ============================================

  server.tool(
    "get_ipsec_tunnels",
    "Show IPsec VPN tunnel status: phase1/phase2 state, uptime, bytes transferred, remote gateway",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_ipsec_tunnels").getIpsecTunnels(vdom)) }],
    })
  );

  server.tool(
    "get_ssl_vpn_sessions",
    "List active SSL VPN sessions: connected users, IPs, duration, bandwidth",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_ssl_vpn_sessions").getSslVpnSessions(vdom)) }],
    })
  );

  server.tool(
    "get_vpn_phase1_config",
    "Show IPsec Phase 1 configuration (IKE settings, authentication, peer addresses)",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_vpn_phase1_config").getVpnPhase1Config(vdom)) }],
    })
  );

  server.tool(
    "get_vpn_phase2_config",
    "Show IPsec Phase 2 configuration (SA proposals, selectors, PFS settings)",
    {
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_vpn_phase2_config").getVpnPhase2Config(vdom)) }],
    })
  );

  // ========================== FORTIGATE LOGS =================================

  server.tool(
    "get_traffic_logs",
    "Query recent forward traffic logs from FortiGate local memory. Use filter to narrow by IP, port, policy, action.",
    {
      rows: z.number().optional().default(50).describe("Number of log rows to return (default 50, max 1000)"),
      filter: z.string().optional().describe(
        "Log filter, e.g. 'srcip==10.0.1.50', 'dstport==443', 'action==deny', 'policyid==5'. Combine with '&&'."
      ),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ rows, filter, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_traffic_logs").getTrafficLogs(rows, filter, vdom)) }],
    })
  );

  server.tool(
    "get_event_logs",
    "Query system event logs from FortiGate (config changes, admin logins, HA events)",
    {
      rows: z.number().optional().default(50).describe("Number of log rows (default 50)"),
      filter: z.string().optional().describe("Log filter string"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ rows, filter, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_event_logs").getEventLogs(rows, filter, vdom)) }],
    })
  );

  server.tool(
    "get_security_logs",
    "Query UTM/security logs from FortiGate (web filter, antivirus, IPS, app control)",
    {
      rows: z.number().optional().default(50).describe("Number of log rows (default 50)"),
      filter: z.string().optional().describe("Log filter string"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ rows, filter, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_security_logs").getSecurityLogs(rows, filter, vdom)) }],
    })
  );

  server.tool(
    "get_vpn_event_logs",
    "Query VPN event logs from FortiGate (tunnel up/down, auth failures, phase negotiation)",
    {
      rows: z.number().optional().default(50).describe("Number of log rows (default 50)"),
      filter: z.string().optional().describe("Log filter string"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ rows, filter, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_vpn_event_logs").getVpnEventLogs(rows, filter, vdom)) }],
    })
  );

  // ========================== FORTIGATE DIAGNOSTICS ==========================

  server.tool(
    "get_sessions",
    "Query the active session table. Use filter to search by IP, port, protocol, or policy.",
    {
      filter: z.string().optional().describe(
        "Session filter, e.g. 'src==10.0.1.50', 'dst==8.8.8.8', 'dport==443', 'proto==6'"
      ),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ filter, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("get_sessions").getSessions(filter, vdom)) }],
    })
  );

  server.tool(
    "ping",
    "Ping a host from the firewall (useful to test reachability from the FW perspective)",
    {
      host: z.string().describe("IP address or hostname to ping"),
      count: z.number().optional().default(4).describe("Number of ping packets (default 4)"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ host, count, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("ping").ping(host, count, vdom)) }],
    })
  );

  server.tool(
    "traceroute",
    "Run a traceroute from the firewall to a destination",
    {
      host: z.string().describe("IP address or hostname to trace"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ host, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("traceroute").traceroute(host, vdom)) }],
    })
  );

  server.tool(
    "dns_lookup",
    "Resolve a hostname using the firewall's configured DNS servers",
    {
      hostname: z.string().describe("Hostname to resolve, e.g. 'google.com'"),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ hostname, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("dns_lookup").getDnsResolve(hostname, vdom)) }],
    })
  );

  server.tool(
    "execute_cli",
    "Execute a read-only CLI command on the FortiGate via REST API. Blocked: config/set/delete/edit/reboot.",
    {
      commands: z.array(z.string()).describe(
        "Array of CLI commands to execute sequentially, e.g. ['get system interface physical', 'get router info routing-table all']"
      ),
      vdom: z.string().optional().describe(vdomDesc),
    },
    async ({ commands, vdom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFG("execute_cli").cli(commands, vdom)) }],
    })
  );
}

// ========================== SSH CLI (available if SSH configured) ===========

server.tool(
  "execute_cli_ssh",
  "Execute read-only CLI commands over SSH directly on a FortiGate. Better for 'diagnose' commands and debug output. Blocked: config/set/delete/edit/reboot.",
  {
    commands: z.array(z.string()).describe(
      "Array of CLI commands to execute, e.g. ['diagnose sys session filter clear', 'diagnose sys session filter dport 443', 'diagnose sys session list']"
    ),
  },
  async ({ commands }) => {
    if (!fgSsh) {
      return {
        content: [{
          type: "text",
          text: "Error: SSH is not configured. Set FORTIGATE_SSH_USER and FORTIGATE_SSH_PASSWORD (or FORTIGATE_SSH_KEY) environment variables to enable SSH.",
        }],
      };
    }
    return {
      content: [{ type: "text", text: await safeCall(() => fgSsh!.execute(commands)) }],
    };
  }
);

// ========================== FORTIANALYZER ===================================
// (Registered only when FAZ is configured)

if (hasFAZ) {

  // --- FAZ System ---

  server.tool(
    "faz_get_status",
    "Get FortiAnalyzer system status: hostname, firmware version, serial number",
    {},
    async () => ({
      content: [{ type: "text", text: await safeCall(() => requireFAZ("faz_get_status").getSystemStatus()) }],
    })
  );

  // --- FAZ Device Management ---

  server.tool(
    "faz_list_adoms",
    "List all ADOMs (Administrative Domains) on the FortiAnalyzer",
    {},
    async () => ({
      content: [{ type: "text", text: await safeCall(() => requireFAZ("faz_list_adoms").listAdoms()) }],
    })
  );

  server.tool(
    "faz_list_devices",
    "List all managed FortiGate devices registered on the FortiAnalyzer. Shows name, serial, IP, platform, firmware, and connection status.",
    {
      adom: z.string().optional().describe(`ADOM name (default: "${FAZ_ADOM}")`),
    },
    async ({ adom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFAZ("faz_list_devices").listDevices(adom)) }],
    })
  );

  server.tool(
    "faz_get_device",
    "Get detailed info for a specific managed FortiGate device",
    {
      device: z.string().describe("Device name as registered in FortiAnalyzer"),
      adom: z.string().optional().describe(`ADOM name (default: "${FAZ_ADOM}")`),
    },
    async ({ device, adom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFAZ("faz_get_device").getDevice(device, adom)) }],
    })
  );

  // --- FAZ Log Search ---

  server.tool(
    "faz_search_logs",
    "Search logs on FortiAnalyzer with powerful filtering. Supports all log types across all managed devices. Use this for historical log analysis, cross-device searches, and longer time ranges than FortiGate local logs.",
    {
      logtype: z.enum([
        "traffic", "event", "virus", "webfilter", "attack", "spam",
        "anomaly", "dlp", "app-ctrl", "waf", "dns", "ssh", "ssl",
        "file-filter", "icap", "virtual-patch", "ztna",
      ]).describe("Log type to search"),
      filter: z.string().optional().describe(
        "FAZ filter syntax: 'srcip=10.0.1.50', 'dstport=443', 'action=deny'. Use AND/OR. Contains: msg~\"VPN\". Not: srcip!=10.0.0.1"
      ),
      device: z.string().optional().describe("Device name or serial to filter by (default: all devices)"),
      time_start: z.string().optional().describe("Start time in ISO 8601 format, e.g. '2026-03-17T00:00:00'"),
      time_end: z.string().optional().describe("End time in ISO 8601 format, e.g. '2026-03-17T23:59:59'"),
      limit: z.number().optional().default(100).describe("Max results to return (default 100)"),
      adom: z.string().optional().describe(`ADOM name (default: "${FAZ_ADOM}")`),
    },
    async ({ logtype, filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_search_logs").searchLogs({
          logtype,
          filter,
          device,
          timeStart: time_start,
          timeEnd: time_end,
          limit,
          adom,
        })),
      }],
    })
  );

  server.tool(
    "faz_traffic_logs",
    "Search traffic logs on FortiAnalyzer across all managed FortiGates. Better than FortiGate local logs for historical searches and cross-device analysis.",
    {
      filter: z.string().optional().describe("Filter: 'srcip=10.0.1.50 AND dstport=443 AND action=deny'"),
      device: z.string().optional().describe("Device name/serial (default: all)"),
      time_start: z.string().optional().describe("Start time ISO 8601"),
      time_end: z.string().optional().describe("End time ISO 8601"),
      limit: z.number().optional().default(100).describe("Max results (default 100)"),
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_traffic_logs").getTrafficLogs({
          filter, device, timeStart: time_start, timeEnd: time_end, limit, adom,
        })),
      }],
    })
  );

  server.tool(
    "faz_event_logs",
    "Search event logs on FortiAnalyzer (config changes, admin logins, system events across all FortiGates)",
    {
      filter: z.string().optional().describe("Filter string"),
      device: z.string().optional().describe("Device name/serial (default: all)"),
      time_start: z.string().optional().describe("Start time ISO 8601"),
      time_end: z.string().optional().describe("End time ISO 8601"),
      limit: z.number().optional().default(100).describe("Max results (default 100)"),
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_event_logs").getEventLogs({
          filter, device, timeStart: time_start, timeEnd: time_end, limit, adom,
        })),
      }],
    })
  );

  server.tool(
    "faz_security_logs",
    "Search antivirus/malware logs on FortiAnalyzer across all managed devices",
    {
      filter: z.string().optional().describe("Filter string"),
      device: z.string().optional().describe("Device name/serial (default: all)"),
      time_start: z.string().optional().describe("Start time ISO 8601"),
      time_end: z.string().optional().describe("End time ISO 8601"),
      limit: z.number().optional().default(100).describe("Max results (default 100)"),
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_security_logs").getSecurityLogs({
          filter, device, timeStart: time_start, timeEnd: time_end, limit, adom,
        })),
      }],
    })
  );

  server.tool(
    "faz_vpn_logs",
    "Search VPN event logs on FortiAnalyzer (tunnel up/down, auth failures across all FortiGates)",
    {
      filter: z.string().optional().describe("Additional filter (already filtered to VPN subtype)"),
      device: z.string().optional().describe("Device name/serial (default: all)"),
      time_start: z.string().optional().describe("Start time ISO 8601"),
      time_end: z.string().optional().describe("End time ISO 8601"),
      limit: z.number().optional().default(100).describe("Max results (default 100)"),
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_vpn_logs").getVpnLogs({
          filter, device, timeStart: time_start, timeEnd: time_end, limit, adom,
        })),
      }],
    })
  );

  server.tool(
    "faz_ips_logs",
    "Search IPS/intrusion detection logs on FortiAnalyzer",
    {
      filter: z.string().optional().describe("Filter string"),
      device: z.string().optional().describe("Device name/serial (default: all)"),
      time_start: z.string().optional().describe("Start time ISO 8601"),
      time_end: z.string().optional().describe("End time ISO 8601"),
      limit: z.number().optional().default(100).describe("Max results (default 100)"),
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_ips_logs").getIpsLogs({
          filter, device, timeStart: time_start, timeEnd: time_end, limit, adom,
        })),
      }],
    })
  );

  server.tool(
    "faz_webfilter_logs",
    "Search web filter logs on FortiAnalyzer (blocked URLs, categories, across all FortiGates)",
    {
      filter: z.string().optional().describe("Filter string"),
      device: z.string().optional().describe("Device name/serial (default: all)"),
      time_start: z.string().optional().describe("Start time ISO 8601"),
      time_end: z.string().optional().describe("End time ISO 8601"),
      limit: z.number().optional().default(100).describe("Max results (default 100)"),
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_webfilter_logs").getWebfilterLogs({
          filter, device, timeStart: time_start, timeEnd: time_end, limit, adom,
        })),
      }],
    })
  );

  server.tool(
    "faz_appctrl_logs",
    "Search application control logs on FortiAnalyzer (app detection, blocking across all FortiGates)",
    {
      filter: z.string().optional().describe("Filter string"),
      device: z.string().optional().describe("Device name/serial (default: all)"),
      time_start: z.string().optional().describe("Start time ISO 8601"),
      time_end: z.string().optional().describe("End time ISO 8601"),
      limit: z.number().optional().default(100).describe("Max results (default 100)"),
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_appctrl_logs").getAppCtrlLogs({
          filter, device, timeStart: time_start, timeEnd: time_end, limit, adom,
        })),
      }],
    })
  );

  server.tool(
    "faz_dns_logs",
    "Search DNS logs on FortiAnalyzer",
    {
      filter: z.string().optional().describe("Filter string"),
      device: z.string().optional().describe("Device name/serial (default: all)"),
      time_start: z.string().optional().describe("Start time ISO 8601"),
      time_end: z.string().optional().describe("End time ISO 8601"),
      limit: z.number().optional().default(100).describe("Max results (default 100)"),
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ filter, device, time_start, time_end, limit, adom }) => ({
      content: [{
        type: "text",
        text: await safeCall(() => requireFAZ("faz_dns_logs").getDnsLogs({
          filter, device, timeStart: time_start, timeEnd: time_end, limit, adom,
        })),
      }],
    })
  );

  // --- FAZ Reports ---

  server.tool(
    "faz_list_report_templates",
    "List available report templates on FortiAnalyzer",
    {
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ adom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFAZ("faz_list_report_templates").listReportTemplates(adom)) }],
    })
  );

  server.tool(
    "faz_list_report_layouts",
    "List available report layouts on FortiAnalyzer",
    {
      adom: z.string().optional().describe(`ADOM (default: "${FAZ_ADOM}")`),
    },
    async ({ adom }) => ({
      content: [{ type: "text", text: await safeCall(() => requireFAZ("faz_list_report_layouts").listReportLayouts(adom)) }],
    })
  );
}

  return server;
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  const toolCount = (hasFG ? 23 : 0) + 1 + (hasFAZ ? 14 : 0);
  const mcpTransport = process.env.MCP_TRANSPORT ?? "stdio";
  const mcpPort = Number(process.env.MCP_PORT ?? "3000");

  if (mcpTransport === "sse") {
    const SSE_AUTH_TOKEN   = process.env.MCP_AUTH_TOKEN ?? "";
    const SSE_MAX_SESSIONS = Number(process.env.MCP_MAX_SESSIONS ?? "10");
    const SSE_SESSION_TTL  = Number(process.env.MCP_SESSION_TTL_MS ?? String(30 * 60 * 1000));
    const SSE_RATE_LIMIT   = Number(process.env.MCP_RATE_LIMIT ?? "60"); // requests/min/session

    if (!SSE_AUTH_TOKEN) {
      console.error("WARNING: MCP_AUTH_TOKEN is not set — SSE endpoint is unauthenticated. Set MCP_AUTH_TOKEN for production use.");
    }

    interface SessionEntry {
      transport: SSEServerTransport;
      timer: ReturnType<typeof setTimeout>;
      rateCount: number;
      rateReset: number;
    }
    const sessions = new Map<string, SessionEntry>();

    function deleteSession(sessionId: string) {
      const entry = sessions.get(sessionId);
      if (entry) {
        clearTimeout(entry.timer);
        sessions.delete(sessionId);
        console.error(`SSE session removed (session: ${sessionId}, active: ${sessions.size})`);
      }
    }

    function checkAuth(req: IncomingMessage): boolean {
      if (!SSE_AUTH_TOKEN) return true; // no token configured — open (warned above)
      const header = (req.headers["authorization"] ?? "").trim();
      return header === `Bearer ${SSE_AUTH_TOKEN}`;
    }

    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");

      // Auth check on all non-health endpoints
      if (url.pathname !== "/health" && !checkAuth(req)) {
        res.writeHead(401, { "Content-Type": "text/plain", "WWW-Authenticate": "Bearer" });
        res.end("Unauthorized");
        return;
      }

      if (req.method === "GET" && url.pathname === "/sse") {
        // Session cap
        if (sessions.size >= SSE_MAX_SESSIONS) {
          res.writeHead(503, { "Content-Type": "text/plain" });
          res.end("Too many active sessions");
          return;
        }

        res.setHeader("Access-Control-Allow-Origin", "*");
        const server = createMcpServer();
        const transport = new SSEServerTransport("/message", res);
        const sessionId = transport.sessionId;

        // Session TTL — auto-expire idle/orphaned sessions
        const timer = setTimeout(() => {
          console.error(`SSE session expired (session: ${sessionId})`);
          deleteSession(sessionId);
        }, SSE_SESSION_TTL);

        sessions.set(sessionId, { transport, timer, rateCount: 0, rateReset: Date.now() + 60_000 });

        req.on("close", () => {
          deleteSession(sessionId);
          console.error(`SSE client disconnected (session: ${sessionId})`);
        });

        console.error(`SSE client connected (session: ${sessionId}, active: ${sessions.size})`);
        await server.connect(transport);

      } else if (req.method === "POST" && url.pathname === "/message") {
        const sessionId = url.searchParams.get("sessionId") ?? "";
        const entry = sessions.get(sessionId);
        if (!entry) {
          res.writeHead(400, { "Content-Type": "text/plain" });
          res.end("Unknown or expired session");
          return;
        }

        // Rate limiting — sliding window per session
        const now = Date.now();
        if (now > entry.rateReset) {
          entry.rateCount = 0;
          entry.rateReset = now + 60_000;
        }
        if (++entry.rateCount > SSE_RATE_LIMIT) {
          res.writeHead(429, { "Content-Type": "text/plain" });
          res.end("Rate limit exceeded — try again in a moment");
          return;
        }

        // Reset TTL on activity
        clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          console.error(`SSE session expired (session: ${sessionId})`);
          deleteSession(sessionId);
        }, SSE_SESSION_TTL);

        await entry.transport.handlePostMessage(req, res);

      } else if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));

      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    httpServer.listen(mcpPort, "0.0.0.0", () => {
      console.error(`FortiGate MCP server running on http://0.0.0.0:${mcpPort}/sse (${toolCount} tools, max sessions: ${SSE_MAX_SESSIONS}, session TTL: ${SSE_SESSION_TTL / 1000}s, rate limit: ${SSE_RATE_LIMIT} req/min)`);
    });

  } else {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(`FortiGate MCP server running on stdio (${toolCount} tools registered)`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
