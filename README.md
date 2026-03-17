# FortiGate MCP Server

A read-only [Model Context Protocol](https://modelcontextprotocol.io/) (MCP) server for FortiGate firewalls. Lets AI assistants like Claude query your firewall's status, policies, logs, VPN tunnels, and run diagnostics — all through natural language.

Built for **FortiOS 7.x** (single firewall, no VDOM).

## Features

**22 read-only tools** across 5 categories:

| Category | Tools |
|---|---|
| **System / Network** | System status, performance, interfaces, routing table, ARP table, DHCP leases |
| **Firewall Policies** | List/filter policies, policy lookup, hit counts, address objects/groups, service objects |
| **VPN** | IPsec tunnel status, SSL VPN sessions, Phase 1/2 config |
| **Logs** | Traffic, event, security, and VPN logs with filters |
| **Diagnostics** | Session table, ping, traceroute, DNS lookup, read-only CLI |

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
