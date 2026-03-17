# FortiGate MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for FortiGate firewalls. Lets AI assistants like Claude query your firewall's status, policies, logs, VPN tunnels, and run diagnostics — all through natural language.

Built for **FortiOS 7.x** (single firewall, no VDOM).

## Features

**23 read-only tools** across 5 categories:

| Category | Tools |
|---|---|
| **System / Network** | System status, performance, interfaces, routing table, ARP table, DHCP leases |
| **Firewall Policies** | List/filter policies, policy lookup, hit counts, address objects/groups, service objects |
| **VPN** | IPsec tunnel status, SSL VPN sessions, Phase 1/2 config |
| **Logs** | Traffic, event, security, and VPN logs with filters |
| **Diagnostics** | Session table, ping, traceroute, DNS lookup, read-only CLI (REST + SSH) |

All write operations are blocked — the server will refuse any config/set/delete/reboot commands.

## Prerequisites

- A FortiGate firewall running FortiOS 7.x
- A **read-only API token** (see [Creating an API Token](#creating-an-api-token))
- Docker **or** Node.js 22+

## Creating an API Token

1. Log into the FortiGate GUI
2. Go to **System > Admin Profiles** — create a profile with read-only access
3. Go to **System > Administrators** — create a new **REST API admin**:
   - Assign the read-only profile
   - Set **Trusted Hosts** to restrict access (recommended)
4. Copy the generated API token

## Quick Start

### Option 1: Docker (recommended)

```bash
docker build -t fortigate-mcp .

docker run --rm \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
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

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `FORTIGATE_HOST` | Yes | — | FortiGate IP or hostname |
| `FORTIGATE_API_KEY` | Yes | — | REST API token |
| `FORTIGATE_PORT` | No | `443` | HTTPS port |
| `FORTIGATE_VERIFY_SSL` | No | `false` | Set to `true` if using a valid TLS certificate |
| `FORTIGATE_SSH_USER` | No | — | SSH username (enables SSH tools) |
| `FORTIGATE_SSH_PASSWORD` | No | — | SSH password |
| `FORTIGATE_SSH_KEY` | No | — | PEM private key (alternative to password) |
| `FORTIGATE_SSH_PORT` | No | `22` | SSH port |

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
3. Add the following environment variables:
   - `FORTIGATE_HOST` = your FortiGate IP (e.g. `192.168.1.1`)
   - `FORTIGATE_API_KEY` = your API token
   - `FORTIGATE_PORT` = `443` (optional)
   - `FORTIGATE_VERIFY_SSL` = `false` (optional)
4. Set **Network Type** to `Host` so the container can reach your FortiGate on the local network

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
        "fortigate-mcp"
      ]
    }
  }
}
```

Or if Claude is running directly on the Unraid server, use the standard Docker config shown below.

## Using with Claude Desktop

Add to your `claude_desktop_config.json`:

### Docker

```json
{
  "mcpServers": {
    "fortigate": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "FORTIGATE_HOST=192.168.1.1",
        "-e", "FORTIGATE_API_KEY=your-api-token",
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
        "FORTIGATE_API_KEY": "your-api-token"
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
  fortigate-mcp
```

## Usage Guide

Once the Docker container is built and your Claude Desktop or Claude Code config is pointing at it, you're ready to go. There's nothing else to start — Claude will automatically launch the container when it needs to query the firewall.

### How It Works

1. You ask Claude a question about your firewall (in plain English)
2. Claude picks the right MCP tool(s) and runs them against your FortiGate
3. The FortiGate REST API responds with live data
4. Claude interprets the results and answers your question

The container starts, runs the query, and stops — it doesn't stay running in the background.

### Verifying the Connection

After setting up the config, restart Claude Desktop (or reload Claude Code), then ask:

> "What's the system status of my firewall?"

You should see Claude call the `get_system_status` tool and return your FortiGate's hostname, serial number, firmware version, and uptime. If this works, everything is connected.

### Available Tools by Category

#### System & Network
| What you can ask | Tool used |
|---|---|
| "What's the CPU and memory usage?" | `get_system_performance` |
| "Show me all interfaces and their IPs" | `get_interfaces` |
| "What's the routing table look like?" | `get_routing_table` |
| "Show me the ARP table" | `get_arp_table` |
| "Which IPs have DHCP leases?" | `get_dhcp_leases` |

#### Firewall Policies
| What you can ask | Tool used |
|---|---|
| "List all firewall policies" | `get_policies` |
| "Show me policy #5 in detail" | `get_policy` |
| "Which policy matches traffic from 10.0.1.50 to 8.8.8.8 on port 443?" | `policy_lookup` |
| "Which policies have zero hit counts?" | `get_policy_hit_count` |
| "Show me all address objects" | `get_address_objects` |
| "List address groups" | `get_address_groups` |
| "What service objects are defined?" | `get_service_objects` |

#### VPN
| What you can ask | Tool used |
|---|---|
| "Are any IPsec tunnels down?" | `get_ipsec_tunnels` |
| "Who's connected via SSL VPN right now?" | `get_ssl_vpn_sessions` |
| "Show me the Phase 1 config for my VPN" | `get_vpn_phase1_config` |
| "What's the Phase 2 config?" | `get_vpn_phase2_config` |

#### Logs
| What you can ask | Tool used |
|---|---|
| "Show me denied traffic from the last hour" | `get_traffic_logs` |
| "Any failed login attempts today?" | `get_event_logs` |
| "Show security events with high severity" | `get_security_logs` |
| "Show VPN connection/disconnection events" | `get_vpn_event_logs` |

#### Diagnostics
| What you can ask | Tool used |
|---|---|
| "Show active sessions from 10.0.1.50" | `get_sessions` |
| "Ping 8.8.8.8 from the firewall" | `ping` |
| "Traceroute to google.com" | `traceroute` |
| "Resolve dns.google" | `dns_lookup` |
| "Run `get system status` on the CLI" | `execute_cli` (REST API, read-only) |
| "Run `diagnose sys session list`" | `execute_cli_ssh` (SSH, read-only) |

### Practical Workflows

**Troubleshooting a user who can't reach a website:**
> "Can you check if there's a firewall policy allowing traffic from 10.0.1.50 to 203.0.113.10 on port 443? Also show me any denied traffic logs from that source IP in the last 30 minutes."

Claude will run `policy_lookup` and `get_traffic_logs` together and correlate the results.

**VPN troubleshooting:**
> "My IPsec VPN to the branch office seems down. Can you check the tunnel status, show the Phase 1 and Phase 2 config, and pull any VPN error logs from the last hour?"

Claude will run multiple tools and cross-reference the config with the logs to pinpoint the issue.

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

## Example Queries

Once connected, you can ask things like:

- "What's the firewall's current CPU and memory usage?"
- "Show me all denied traffic from 10.0.1.50 in the last hour"
- "Which policy would match TCP traffic from port1 10.0.1.50 to wan1 8.8.8.8:443?"
- "Are any IPsec tunnels down?"
- "List all SSL VPN users currently connected"
- "Ping 8.8.8.8 from the firewall"
- "Show me unused firewall policies"

## Security Notes

- The server is **read-only by design** — write commands are blocked at the application level
- Always use a **read-only API profile** on the FortiGate as a second layer of protection
- Restrict the API admin's **Trusted Hosts** to only the machine running this server
- Never commit your `.env` file or API token to version control

## License

MIT
