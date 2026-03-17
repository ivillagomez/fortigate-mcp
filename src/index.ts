#!/usr/bin/env node
/**
 * FortiGate MCP Server
 * Natural language firewall troubleshooting via Model Context Protocol
 *
 * Read-only tools for: system status, interfaces, routing, firewall policies,
 * VPN tunnels, logs, sessions, and diagnostics.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { FortiGateAPI } from "./fortigate-api.js";

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------
const FG_HOST = process.env.FORTIGATE_HOST;
const FG_PORT = Number(process.env.FORTIGATE_PORT ?? "443");
const FG_API_KEY = process.env.FORTIGATE_API_KEY;
const FG_VERIFY_SSL = process.env.FORTIGATE_VERIFY_SSL === "true";

if (!FG_HOST || !FG_API_KEY) {
  console.error("Missing required env vars: FORTIGATE_HOST and FORTIGATE_API_KEY");
  process.exit(1);
}

const fg = new FortiGateAPI({
  host: FG_HOST,
  port: FG_PORT,
  apiKey: FG_API_KEY,
  verifySsl: FG_VERIFY_SSL,
});

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

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "fortigate",
  version: "1.0.0",
});

// ========================== SYSTEM / NETWORK ===============================

server.tool(
  "get_system_status",
  "Get FortiGate system status: hostname, firmware version, serial, uptime, and resource usage",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getSystemStatus()) }],
  })
);

server.tool(
  "get_system_performance",
  "Get real-time CPU, memory, and session counts",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getSystemPerformance()) }],
  })
);

server.tool(
  "get_interfaces",
  "List all network interfaces with status, IP, speed, and traffic counters",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getInterfaces()) }],
  })
);

server.tool(
  "get_interface_details",
  "Get detailed info for a specific interface (status, IP, speed, counters, VLAN)",
  { name: z.string().describe("Interface name, e.g. 'port1', 'wan1', 'internal'") },
  async ({ name }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getInterfaceDetails(name)) }],
  })
);

server.tool(
  "get_routing_table",
  "Show the IPv4 routing table (connected, static, dynamic routes)",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getRoutingTable()) }],
  })
);

server.tool(
  "get_arp_table",
  "Show the ARP table (IP-to-MAC mappings)",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getArpTable()) }],
  })
);

server.tool(
  "get_dhcp_leases",
  "List active DHCP leases issued by the firewall",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getDhcpLeases()) }],
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
  },
  async ({ filter }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getPolicies(filter)) }],
  })
);

server.tool(
  "get_policy",
  "Get a specific firewall policy by its ID",
  { id: z.number().describe("Policy ID number") },
  async ({ id }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getPolicy(id)) }],
  })
);

server.tool(
  "get_policy_hit_count",
  "Get hit counts and byte/packet counters for all policies (useful for finding unused rules)",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getPolicyHitCount()) }],
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
  },
  async (params) => ({
    content: [{ type: "text", text: await safeCall(() => fg.policyLookup(params)) }],
  })
);

server.tool(
  "get_address_objects",
  "List firewall address objects (subnets, FQDNs, IP ranges used in policies)",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getAddressObjects()) }],
  })
);

server.tool(
  "get_address_groups",
  "List firewall address groups",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getAddressGroups()) }],
  })
);

server.tool(
  "get_service_objects",
  "List custom firewall service objects (ports/protocols used in policies)",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getServiceObjects()) }],
  })
);

// ========================== VPN ============================================

server.tool(
  "get_ipsec_tunnels",
  "Show IPsec VPN tunnel status: phase1/phase2 state, uptime, bytes transferred, remote gateway",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getIpsecTunnels()) }],
  })
);

server.tool(
  "get_ssl_vpn_sessions",
  "List active SSL VPN sessions: connected users, IPs, duration, bandwidth",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getSslVpnSessions()) }],
  })
);

server.tool(
  "get_vpn_phase1_config",
  "Show IPsec Phase 1 configuration (IKE settings, authentication, peer addresses)",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getVpnPhase1Config()) }],
  })
);

server.tool(
  "get_vpn_phase2_config",
  "Show IPsec Phase 2 configuration (SA proposals, selectors, PFS settings)",
  {},
  async () => ({
    content: [{ type: "text", text: await safeCall(() => fg.getVpnPhase2Config()) }],
  })
);

// ========================== LOGS ===========================================

server.tool(
  "get_traffic_logs",
  "Query recent forward traffic logs. Use filter to narrow by IP, port, policy, action, etc.",
  {
    rows: z.number().optional().default(50).describe("Number of log rows to return (default 50, max 1000)"),
    filter: z.string().optional().describe(
      "Log filter, e.g. 'srcip==10.0.1.50', 'dstport==443', 'action==deny', 'policyid==5'. Combine with '&&'."
    ),
  },
  async ({ rows, filter }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getTrafficLogs(rows, filter)) }],
  })
);

server.tool(
  "get_event_logs",
  "Query system event logs (config changes, admin logins, HA events, interface changes)",
  {
    rows: z.number().optional().default(50).describe("Number of log rows (default 50)"),
    filter: z.string().optional().describe("Log filter string"),
  },
  async ({ rows, filter }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getEventLogs(rows, filter)) }],
  })
);

server.tool(
  "get_security_logs",
  "Query UTM/security logs (web filter, antivirus, IPS, app control events)",
  {
    rows: z.number().optional().default(50).describe("Number of log rows (default 50)"),
    filter: z.string().optional().describe("Log filter string"),
  },
  async ({ rows, filter }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getSecurityLogs(rows, filter)) }],
  })
);

server.tool(
  "get_vpn_event_logs",
  "Query VPN event logs (tunnel up/down, authentication failures, phase negotiation)",
  {
    rows: z.number().optional().default(50).describe("Number of log rows (default 50)"),
    filter: z.string().optional().describe("Log filter string"),
  },
  async ({ rows, filter }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getVpnEventLogs(rows, filter)) }],
  })
);

// ========================== DIAGNOSTICS ====================================

server.tool(
  "get_sessions",
  "Query the active session table. Use filter to search by IP, port, protocol, or policy.",
  {
    filter: z.string().optional().describe(
      "Session filter, e.g. 'src==10.0.1.50', 'dst==8.8.8.8', 'dport==443', 'proto==6'"
    ),
  },
  async ({ filter }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getSessions(filter)) }],
  })
);

server.tool(
  "ping",
  "Ping a host from the firewall (useful to test reachability from the FW perspective)",
  {
    host: z.string().describe("IP address or hostname to ping"),
    count: z.number().optional().default(4).describe("Number of ping packets (default 4)"),
  },
  async ({ host, count }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.ping(host, count)) }],
  })
);

server.tool(
  "traceroute",
  "Run a traceroute from the firewall to a destination",
  {
    host: z.string().describe("IP address or hostname to trace"),
  },
  async ({ host }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.traceroute(host)) }],
  })
);

server.tool(
  "dns_lookup",
  "Resolve a hostname using the firewall's configured DNS servers",
  {
    hostname: z.string().describe("Hostname to resolve, e.g. 'google.com'"),
  },
  async ({ hostname }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.getDnsResolve(hostname)) }],
  })
);

server.tool(
  "execute_cli",
  "Execute a read-only CLI command on the FortiGate. Blocked: config/set/delete/edit/reboot. Use for 'get', 'show', 'diagnose', 'execute' (read-only) commands.",
  {
    commands: z.array(z.string()).describe(
      "Array of CLI commands to execute sequentially, e.g. ['get system interface physical', 'get router info routing-table all']"
    ),
  },
  async ({ commands }) => ({
    content: [{ type: "text", text: await safeCall(() => fg.cli(commands)) }],
  })
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("FortiGate MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
