# FortiGate / FortiAnalyzer MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for **FortiGate firewalls** and **FortiAnalyzer**. Lets AI assistants like Claude query your firewall's status, policies, logs, VPN tunnels, and run diagnostics — all through natural language.

Built for **FortiOS 7.x** and **FortiAnalyzer 7.x**.

## Table of Contents

- [Deployment Modes](#deployment-modes)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Creating API Tokens](#creating-api-tokens)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Installing on Unraid](#installing-on-unraid)
- [Using with Claude Desktop](#using-with-claude-desktop)
- [Using with Claude Code](#using-with-claude-code)
- [Usage Guide](#usage-guide)
  - [How It Works](#how-it-works)
  - [Verifying the Connection](#verifying-the-connection)
  - [Available Tools by Category](#available-tools-by-category)
  - [When to Use FortiGate vs FortiAnalyzer Logs](#when-to-use-fortigate-vs-fortianalyzer-logs)
  - [Practical Workflows](#practical-workflows)
  - [SSH vs REST API CLI](#ssh-vs-rest-api-cli)
  - [Tips](#tips)
- [Example Queries](#example-queries)
- [VDOM Support](#vdom-support-multi-vdom-firewalls)
- [Security Notes](#security-notes)
- [License](#license)

## Deployment Modes

| Mode | What you need | Tools available |
|---|---|---|
| **FortiGate only** | Single firewall REST API + optional SSH | 24 tools — live status, policies, VPN, local logs, diagnostics |
| **FortiAnalyzer only** | FAZ with managed devices | 15 tools — centralized logs, device inventory, reports |
| **Both (hybrid)** | FortiGate + FortiAnalyzer | **Up to 38 tools** — FAZ for logs/analytics, FortiGate for live status/diagnostics |

The server auto-detects which backends are configured and registers only the relevant tools.

## Features

### FortiGate Tools (24)

| Category | Tools |
|---|---|
| **System / Network** | System status, performance, interfaces, routing table, ARP table, DHCP leases |
| **Firewall Policies** | List/filter policies, policy lookup, hit counts, address objects/groups, service objects |
| **VPN** | IPsec tunnel status, SSL VPN sessions, Phase 1/2 config |
| **Logs** | Traffic, event, security, and VPN logs with filters |
| **Diagnostics** | Session table, ping, traceroute, DNS lookup, read-only CLI (REST + SSH) |

### FortiAnalyzer Tools (14)

| Category | Tools |
|---|---|
| **System** | FortiAnalyzer status |
| **Device Management** | List ADOMs, list managed devices, get device details |
| **Log Search** | Generic search, traffic, event, security, VPN, IPS, web filter, app control, DNS logs |
| **Reports** | List report templates, list report layouts |

All write operations are blocked — the server will refuse any config/set/delete/reboot commands.

## Prerequisites

- **FortiGate**: FortiOS 7.x with a read-only API token
- **FortiAnalyzer** *(optional)*: FortiAnalyzer 7.x with API token or admin credentials
- **Runtime**: Docker **or** Node.js 22+

## Creating API Tokens

### FortiGate API Token

1. Log into the FortiGate GUI
2. Go to **System > Admin Profiles** — create a profile with read-only access
3. Go to **System > Administrators** — create a new **REST API admin**:
   - Assign the read-only profile
   - Set **Trusted Hosts** to restrict access (recommended)
4. Copy the generated API token

### FortiAnalyzer API Token

1. Log into the FortiAnalyzer GUI
2. Go to **System Settings > Admin > Administrators**
3. Create a new admin with type **REST API Admin**
4. Assign a read-only admin profile
5. Copy the generated API token

*Alternatively, you can use username/password authentication (session-based).*

## Quick Start

### Option 1: Docker (recommended)

```bash
docker build -t fortigate-mcp .
```

**FortiGate only:**
```bash
docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
  fortigate-mcp
```

**FortiAnalyzer only:**
```bash
docker run --rm -i \
  -e FAZ_HOST=10.0.0.50 \
  -e FAZ_API_TOKEN=your-faz-token \
  fortigate-mcp
```

**Hybrid (both):**
```bash
docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-fg-token \
  -e FAZ_HOST=10.0.0.50 \
  -e FAZ_API_TOKEN=your-faz-token \
  fortigate-mcp
```

### Option 2: Node.js

```bash
npm install
npm run build
```

Create a `.env` file (see `.env.example`), then:

```bash
FORTIGATE_HOST=192.168.1.1 FORTIGATE_API_KEY=your-api-token node build/index.js
```

## Configuration

### FortiGate Variables

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `FORTIGATE_HOST` | * | — | FortiGate IP or hostname |
| `FORTIGATE_API_KEY` | * | — | REST API token |
| `FORTIGATE_PORT` | No | `443` | HTTPS port |
| `FORTIGATE_VERIFY_SSL` | No | `false` | Set to `true` if using a valid TLS certificate |
| `FORTIGATE_VDOM` | No | `root` | VDOM name (safe on non-VDOM firewalls — FortiOS ignores it) |
| `FORTIGATE_SSH_USER` | No | — | SSH username (enables SSH tools) |
| `FORTIGATE_SSH_PASSWORD` | No | — | SSH password |
| `FORTIGATE_SSH_KEY` | No | — | PEM private key (alternative to password) |
| `FORTIGATE_SSH_PORT` | No | `22` | SSH port |

*\* Required if FortiGate mode is used*

### FortiAnalyzer Variables

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `FAZ_HOST` | * | — | FortiAnalyzer IP or hostname |
| `FAZ_API_TOKEN` | ** | — | API token (recommended) |
| `FAZ_USER` | ** | — | Admin username (session-based auth) |
| `FAZ_PASSWORD` | ** | — | Admin password (session-based auth) |
| `FAZ_PORT` | No | `443` | HTTPS port |
| `FAZ_ADOM` | No | `root` | Administrative Domain |
| `FAZ_VERIFY_SSL` | No | `false` | Set to `true` if using a valid TLS certificate |

*\* Required if FortiAnalyzer mode is used*
*\*\* Provide either `FAZ_API_TOKEN` or `FAZ_USER` + `FAZ_PASSWORD`*

## Installing on Unraid

### Option 1: Unraid Terminal

SSH into your Unraid server or open the terminal from the web UI:

```bash
# Clone and build the image
cd /mnt/user/appdata
git clone https://github.com/ivillagomez/fortigate-mcp.git
cd fortigate-mcp
docker build -t fortigate-mcp .
```

The container runs as a **stdio-based MCP server** (not a long-running service), so it doesn't need its own Unraid Docker template. It gets launched on-demand by Claude Desktop or Claude Code when a query is made.

### Option 2: Unraid Docker UI (Community Applications)

If you prefer using the Unraid GUI:

1. Go to **Docker > Add Container**
2. Set **Repository** to the path of your built image (`fortigate-mcp`) or build it first via terminal (see above)
3. Set **Network Type** to `Host` so the container can reach your FortiGate/FAZ on the local network
4. Click **Add another Path, Port, Variable, Label or Device** for each variable below and configure as follows:

#### FortiGate Variables

| Config Type | Name | Key | Value | Required |
|---|---|---|---|---|
| Variable | FortiGate Host | `FORTIGATE_HOST` | Your FortiGate IP (e.g. `192.168.1.1`) | Yes |
| Variable | FortiGate API Key | `FORTIGATE_API_KEY` | Your REST API token | Yes |
| Variable | FortiGate Port | `FORTIGATE_PORT` | `443` | No (default: 443) |
| Variable | Verify SSL | `FORTIGATE_VERIFY_SSL` | `false` | No (default: false) |
| Variable | VDOM | `FORTIGATE_VDOM` | `root` | No (default: root) |

#### FortiGate SSH Variables (optional — for `diagnose` commands)

| Config Type | Name | Key | Value | Required |
|---|---|---|---|---|
| Variable | SSH User | `FORTIGATE_SSH_USER` | SSH admin username | No |
| Variable | SSH Password | `FORTIGATE_SSH_PASSWORD` | SSH password | No |
| Variable | SSH Port | `FORTIGATE_SSH_PORT` | `22` | No (default: 22) |

#### FortiAnalyzer Variables (optional)

| Config Type | Name | Key | Value | Required |
|---|---|---|---|---|
| Variable | FAZ Host | `FAZ_HOST` | Your FortiAnalyzer IP (e.g. `10.0.0.50`) | Yes (if using FAZ) |
| Variable | FAZ API Token | `FAZ_API_TOKEN` | Your FAZ API token | Yes* |
| Variable | FAZ User | `FAZ_USER` | Admin username (alternative to token) | Yes* |
| Variable | FAZ Password | `FAZ_PASSWORD` | Admin password (alternative to token) | Yes* |
| Variable | FAZ Port | `FAZ_PORT` | `443` | No (default: 443) |
| Variable | FAZ ADOM | `FAZ_ADOM` | `root` | No (default: root) |
| Variable | FAZ Verify SSL | `FAZ_VERIFY_SSL` | `false` | No (default: false) |

*\* Provide either `FAZ_API_TOKEN` or both `FAZ_USER` + `FAZ_PASSWORD`*

> **Note:** No container path or host path is needed for these — they are all **Variable** type configs with just a Key and Value. No ports or volume mappings are required since this is a stdio-based server.

> **Note:** Since this is a stdio MCP server (not a web service), the Unraid Docker UI is mainly useful for pre-building the image. The actual container is launched by Claude Desktop/Code as needed — see the config examples below.

### Connecting Claude to the Unraid-hosted image

On the machine running Claude Desktop or Claude Code, point the MCP config at the Unraid Docker host:

```json
{
  "mcpServers": {
    "fortigate": {
      "command": "ssh",
      "args": [
        "root@YOUR_UNRAID_IP",
        "docker", "run", "--rm", "-i",
        "-e", "FORTIGATE_HOST=192.168.1.1",
        "-e", "FORTIGATE_API_KEY=your-api-token",
        "-e", "FAZ_HOST=10.0.0.50",
        "-e", "FAZ_API_TOKEN=your-faz-token",
        "fortigate-mcp"
      ]
    }
  }
}
```

Or if Claude is running directly on the Unraid server, use the standard Docker config shown below.

## Using with Claude Desktop

Add to your `claude_desktop_config.json`:

### Docker (hybrid mode example)

```json
{
  "mcpServers": {
    "fortigate": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "FORTIGATE_HOST=192.168.1.1",
        "-e", "FORTIGATE_API_KEY=your-fg-token",
        "-e", "FORTIGATE_SSH_USER=admin",
        "-e", "FORTIGATE_SSH_PASSWORD=your-ssh-password",
        "-e", "FAZ_HOST=10.0.0.50",
        "-e", "FAZ_API_TOKEN=your-faz-token",
        "fortigate-mcp"
      ]
    }
  }
}
```

### Node.js

```json
{
  "mcpServers": {
    "fortigate": {
      "command": "node",
      "args": ["path/to/fortigate-mcp/build/index.js"],
      "env": {
        "FORTIGATE_HOST": "192.168.1.1",
        "FORTIGATE_API_KEY": "your-api-token",
        "FAZ_HOST": "10.0.0.50",
        "FAZ_API_TOKEN": "your-faz-token"
      }
    }
  }
}
```

## Using with Claude Code

Add to your Claude Code settings or run:

```bash
claude mcp add fortigate -- docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
  -e FAZ_HOST=10.0.0.50 \
  -e FAZ_API_TOKEN=your-faz-token \
  fortigate-mcp
```

## Usage Guide

Once the Docker container is built and your Claude Desktop or Claude Code config is pointing at it, you're ready to go. There's nothing else to start — Claude will automatically launch the container when it needs to query the firewall.

### How It Works

1. You ask Claude a question about your firewall (in plain English)
2. Claude picks the right MCP tool(s) — FortiGate REST, SSH, or FortiAnalyzer — based on your question
3. The API responds with live data
4. Claude interprets the results and answers your question

The container starts, runs the query, and stops — it doesn't stay running in the background.

### Verifying the Connection

After setting up the config, restart Claude Desktop (or reload Claude Code), then ask:

**FortiGate:** "What's the system status of my firewall?"

**FortiAnalyzer:** "List all managed devices on my FortiAnalyzer"

### Available Tools by Category

#### FortiGate — System & Network
| What you can ask | Tool used |
|---|---|
| "What's the CPU and memory usage?" | `get_system_performance` |
| "Show me all interfaces and their IPs" | `get_interfaces` |
| "What's the routing table look like?" | `get_routing_table` |
| "Show me the ARP table" | `get_arp_table` |
| "Which IPs have DHCP leases?" | `get_dhcp_leases` |

#### FortiGate — Firewall Policies
| What you can ask | Tool used |
|---|---|
| "List all firewall policies" | `get_policies` |
| "Show me policy #5 in detail" | `get_policy` |
| "Which policy matches traffic from 10.0.1.50 to 8.8.8.8 on port 443?" | `policy_lookup` |
| "Which policies have zero hit counts?" | `get_policy_hit_count` |
| "Show me all address objects" | `get_address_objects` |
| "List address groups" | `get_address_groups` |
| "What service objects are defined?" | `get_service_objects` |

#### FortiGate — VPN
| What you can ask | Tool used |
|---|---|
| "Are any IPsec tunnels down?" | `get_ipsec_tunnels` |
| "Who's connected via SSL VPN right now?" | `get_ssl_vpn_sessions` |
| "Show me the Phase 1 config for my VPN" | `get_vpn_phase1_config` |
| "What's the Phase 2 config?" | `get_vpn_phase2_config` |

#### FortiGate — Logs (local memory)
| What you can ask | Tool used |
|---|---|
| "Show me denied traffic from the last hour" | `get_traffic_logs` |
| "Any failed login attempts today?" | `get_event_logs` |
| "Show security events with high severity" | `get_security_logs` |
| "Show VPN connection/disconnection events" | `get_vpn_event_logs` |

#### FortiGate — Diagnostics
| What you can ask | Tool used |
|---|---|
| "Show active sessions from 10.0.1.50" | `get_sessions` |
| "Ping 8.8.8.8 from the firewall" | `ping` |
| "Traceroute to google.com" | `traceroute` |
| "Resolve dns.google" | `dns_lookup` |
| "Run `get system status` on the CLI" | `execute_cli` (REST API, read-only) |
| "Run `diagnose sys session list`" | `execute_cli_ssh` (SSH, read-only) |

#### FortiAnalyzer — Device Management
| What you can ask | Tool used |
|---|---|
| "What's the FortiAnalyzer status?" | `faz_get_status` |
| "List all ADOMs" | `faz_list_adoms` |
| "Show all managed FortiGates" | `faz_list_devices` |
| "Get details for the branch office firewall" | `faz_get_device` |

#### FortiAnalyzer — Log Search (centralized, all devices)
| What you can ask | Tool used |
|---|---|
| "Search traffic logs across all firewalls for the last week" | `faz_traffic_logs` |
| "Show event logs from FW-BRANCH" | `faz_event_logs` |
| "Any malware detections across all sites?" | `faz_security_logs` |
| "Show VPN failures across all FortiGates today" | `faz_vpn_logs` |
| "IPS alerts from the last 24 hours" | `faz_ips_logs` |
| "Which URLs were blocked by web filter?" | `faz_webfilter_logs` |
| "What apps are being detected?" | `faz_appctrl_logs` |
| "Show DNS query logs" | `faz_dns_logs` |
| "Search for any log type with custom filters" | `faz_search_logs` |

#### FortiAnalyzer — Reports
| What you can ask | Tool used |
|---|---|
| "What report templates are available?" | `faz_list_report_templates` |
| "List report layouts" | `faz_list_report_layouts` |

### When to Use FortiGate vs FortiAnalyzer Logs

| Scenario | Best source | Why |
|---|---|---|
| "What happened in the last 5 minutes?" | **FortiGate** (`get_traffic_logs`) | Real-time, fastest |
| "Show me last week's denied traffic" | **FortiAnalyzer** (`faz_traffic_logs`) | Longer retention |
| "VPN failures across all firewalls" | **FortiAnalyzer** (`faz_vpn_logs`) | Cross-device search |
| "Is there a VPN tunnel down right now?" | **FortiGate** (`get_ipsec_tunnels`) | Live status |
| "Run a diagnose command" | **FortiGate SSH** (`execute_cli_ssh`) | Direct access needed |

### Practical Workflows

**Troubleshooting a user who can't reach a website:**
> "Can you check if there's a firewall policy allowing traffic from 10.0.1.50 to 203.0.113.10 on port 443? Also show me any denied traffic logs from that source IP in the last 30 minutes."

Claude will run `policy_lookup` and `get_traffic_logs` (or `faz_traffic_logs`) together and correlate the results.

**VPN troubleshooting:**
> "My IPsec VPN to the branch office seems down. Can you check the tunnel status, show the Phase 1 and Phase 2 config, and pull any VPN error logs from the last hour?"

Claude will run multiple tools and cross-reference the config with the logs to pinpoint the issue.

**Multi-site security audit (requires FortiAnalyzer):**
> "Show me all IPS alerts and malware detections across all managed firewalls from the last 7 days. Which device has the most threats?"

Claude will query `faz_ips_logs` and `faz_security_logs` across all devices and summarize.

**Daily health check:**
> "Give me a quick health check — system performance, any tunnels down, and any high-severity security events today."

Claude will gather data from several tools and give you a summary.

**Finding unused rules:**
> "Which firewall policies have zero hits? I want to clean up unused rules."

Claude will pull hit counts and flag policies with no traffic.

### SSH vs REST API CLI

The server has two CLI tools:

| Tool | Transport | Best for |
|---|---|---|
| `execute_cli` | REST API | Simple `get`, `show` commands. No SSH needed. |
| `execute_cli_ssh` | SSH | `diagnose` commands, debug output, session filters, and anything that returns richer output over SSH. |

SSH is **optional** — the server works fine with just the REST API. Add SSH credentials when you need deeper diagnostics:

```bash
docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
  -e FORTIGATE_SSH_USER=admin \
  -e FORTIGATE_SSH_PASSWORD=your-password \
  fortigate-mcp
```

**SSH example queries:**
- "Run `diagnose vpn ike log filter name my-vpn` and `diagnose debug application ike -1` over SSH"
- "Use SSH to run `diagnose sys session filter dport 443` then `diagnose sys session list`"
- "Check the IKE real-time log for my VPN tunnel via SSH"

### Tips

- **Be specific with time ranges** — "last hour", "today", "last 24 hours" help filter logs effectively
- **Combine questions** — Claude can run multiple tools in a single response, so ask everything at once
- **Use IP addresses** — when troubleshooting, give Claude the specific source/destination IPs for precise results
- **CLI tools are read-only** — you can run `get`, `show`, and `diagnose` commands, but config changes are blocked
- **SSH is optional** — only needed for `diagnose` commands that work better over SSH
- **Use FortiAnalyzer for historical searches** — FAZ has longer log retention and cross-device searching
- **Specify the device** — when using FAZ tools, mention the device name to narrow results

## Example Queries

Once connected, you can ask things like:

- "What's the firewall's current CPU and memory usage?"
- "Show me all denied traffic from 10.0.1.50 in the last hour"
- "Which policy would match TCP traffic from port1 10.0.1.50 to wan1 8.8.8.8:443?"
- "Are any IPsec tunnels down?"
- "List all SSL VPN users currently connected"
- "Ping 8.8.8.8 from the firewall"
- "Show me unused firewall policies"
- "List all managed FortiGates on the FortiAnalyzer"
- "Search traffic logs across all firewalls for blocked traffic from 10.0.1.0/24"
- "Show VPN failures from all sites in the last 7 days"
- "What IPS attacks were detected this week?"

## VDOM Support (Multi-VDOM Firewalls)

The server supports FortiGate **Virtual Domains (VDOMs)** for multi-tenant environments. Every FortiGate API call includes `?vdom=` — this is safe on both VDOM and non-VDOM firewalls.

### How it works

| Scenario | Behavior |
|---|---|
| **Non-VDOM firewall** | `?vdom=root` is silently ignored by FortiOS — everything works normally |
| **Multi-VDOM firewall** | Queries target the specified VDOM (default: `root`) |
| **Per-tool override** | Every FortiGate tool accepts an optional `vdom` parameter to target a different VDOM on-the-fly |

### Configuration

Set the default VDOM via environment variable:

```bash
docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
  -e FORTIGATE_VDOM=customer-a \
  fortigate-mcp
```

Or override per-query in Claude:
> "Show me the routing table for VDOM 'customer-b'"

Claude will pass `vdom: "customer-b"` to the `get_routing_table` tool, overriding the default.

### VDOM vs ADOM

| Concept | Where | Purpose |
|---|---|---|
| **VDOM** (Virtual Domain) | FortiGate | Partitions one firewall into multiple virtual firewalls, each with its own policies, routing, and interfaces |
| **ADOM** (Administrative Domain) | FortiAnalyzer | Groups managed FortiGates for delegation and log separation (e.g., per-customer) |

In a typical MSP setup: each customer has their own **ADOM** on FortiAnalyzer containing one or more FortiGates, and each FortiGate may use **VDOMs** to further segment traffic.

## Security Notes

- The server is **read-only by design** — write commands are blocked at the application level
- Always use a **read-only API profile** on the FortiGate and FortiAnalyzer as a second layer of protection
- Restrict the API admin's **Trusted Hosts** to only the machine running this server
- Never commit your `.env` file or API tokens to version control
- FortiAnalyzer session-based auth has a **32 concurrent session limit** per user — prefer API token auth

## License

MIT
