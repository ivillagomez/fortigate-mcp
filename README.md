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

- **FortiGate**: FortiOS 7.x with a read-only API token ([how to create one](#fortigate-api-token))
- **FortiAnalyzer** *(optional)*: FortiAnalyzer 7.x with API token or admin credentials ([how to create one](#fortianalyzer-api-token))
- **Runtime** — pick one:
  - **Docker** (recommended) — [Install Docker Desktop](https://docs.docker.com/get-docker/) for Windows/macOS, or `apt install docker.io` on Linux
  - **Node.js 22+** — [Download from nodejs.org](https://nodejs.org/) (use the LTS version)

## Creating API Tokens

### FortiGate API Token

You need an API token so the MCP server can read data from your FortiGate. The token should be **read-only** — the MCP server never makes changes.

1. Log into your FortiGate web GUI (e.g., `https://192.168.1.1`)
2. Go to **System > Admin Profiles**
   - Click **Create New**
   - Name it something like `readonly-api`
   - Set **all permissions to Read** (or Read-Only) — no Write access needed
   - Click **OK**
3. Go to **System > Administrators**
   - Click **Create New > REST API Admin**
   - Set a username (e.g., `mcp-reader`)
   - Assign the `readonly-api` profile you just created
   - Under **Trusted Hosts**, add the IP of the machine that will run the MCP server (e.g., `192.168.1.100/32`). This restricts who can use the token.
   - Click **OK**
4. **Copy the API token** that appears — you won't be able to see it again!

> **Important:** Save this token somewhere safe. You'll paste it as the `FORTIGATE_API_KEY` value in your config.

### FortiAnalyzer API Token

If you have a FortiAnalyzer and want centralized log search capabilities:

1. Log into your FortiAnalyzer web GUI (e.g., `https://10.0.0.50`)
2. Go to **System Settings > Admin > Administrators**
3. Click **Create New**
   - Set type to **REST API Admin**
   - Set a username (e.g., `mcp-reader`)
   - Assign a read-only admin profile
4. **Copy the generated API token**

> **Alternative:** If you can't create an API token, you can use username/password authentication instead. Set `FAZ_USER` and `FAZ_PASSWORD` in your config instead of `FAZ_API_TOKEN`. Note: session-based auth has a limit of 32 concurrent sessions per user.

## Quick Start

### Option 1: Docker (recommended)

> **What is Docker?** Docker runs the server inside an isolated container. You don't need to install Node.js — Docker handles everything. If you already have Docker installed, this is the easiest option.

**Step 1 — Clone the repo and build the Docker image:**

```bash
# Clone the repo (pick any folder you like)
git clone https://github.com/ivillagomez/fortigate-mcp.git

# Go into the folder
cd fortigate-mcp

# Build the Docker image (this only needs to be done once)
docker build -t fortigate-mcp .
```

**Step 2 — Test that it works:**

Replace the placeholder values with your actual FortiGate IP and API token, then run:

```bash
# FortiGate only (minimum setup):
docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
  fortigate-mcp
```

> **What do the flags mean?**
> - `-e FORTIGATE_HOST=...` sets an environment variable inside the container
> - `--rm` removes the container after it stops (cleanup)
> - `-i` keeps the input stream open (required for MCP stdio)

You should see `FortiGate MCP Server running on stdio` — press `Ctrl+C` to stop.

<details>
<summary><strong>FortiAnalyzer only</strong></summary>

```bash
docker run --rm -i \
  -e FAZ_HOST=10.0.0.50 \
  -e FAZ_API_TOKEN=your-faz-token \
  fortigate-mcp
```

Replace `10.0.0.50` with your FortiAnalyzer IP and `your-faz-token` with your API token.

</details>

<details>
<summary><strong>Hybrid (FortiGate + FortiAnalyzer + SSH)</strong></summary>

```bash
docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-fg-token \
  -e FORTIGATE_SSH_USER=admin \
  -e FORTIGATE_SSH_PASSWORD=your-ssh-password \
  -e FAZ_HOST=10.0.0.50 \
  -e FAZ_API_TOKEN=your-faz-token \
  fortigate-mcp
```

Replace all placeholder values with your actual credentials.

</details>

### Option 2: Node.js

> **When to use this:** If you don't have Docker, or prefer running Node.js directly. Requires [Node.js 22+](https://nodejs.org/) installed on your machine.

**Step 1 — Clone and build:**

```bash
# Clone the repo
git clone https://github.com/ivillagomez/fortigate-mcp.git
cd fortigate-mcp

# Install dependencies
npm install

# Compile TypeScript to JavaScript
npm run build
```

**Step 2 — Create a `.env` file** with your credentials:

```bash
# Copy the example file
cp .env.example .env
```

Open `.env` in any text editor and fill in your FortiGate IP and API token:

```bash
FORTIGATE_HOST=192.168.1.1
FORTIGATE_API_KEY=your-api-token
```

**Step 3 — Test that it works:**

```bash
npm start
```

You should see `FortiGate MCP Server running on stdio` — press `Ctrl+C` to stop.

> **Note:** You don't run `npm start` manually in day-to-day use. Claude Desktop/Code launches the server automatically when it needs it. This test just confirms the build worked.

## Configuration

> **What are environment variables?** They're settings you pass to the server. In Docker, you use `-e VAR=value`. In Node.js, you put them in a `.env` file. See the examples in [Quick Start](#quick-start) and [Using with Claude Desktop](#using-with-claude-desktop).

### FortiGate Variables

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `FORTIGATE_HOST` | **Yes** | — | Your FortiGate's IP address (e.g., `192.168.1.1`) |
| `FORTIGATE_API_KEY` | **Yes** | — | The API token you created ([see above](#fortigate-api-token)) |
| `FORTIGATE_PORT` | No | `443` | HTTPS port — only change if your FortiGate uses a non-standard port |
| `FORTIGATE_VERIFY_SSL` | No | `false` | Set to `true` if your FortiGate has a real (non-self-signed) TLS certificate |
| `FORTIGATE_VDOM` | No | `root` | VDOM name — safe to ignore if you don't use VDOMs |
| `FORTIGATE_SSH_USER` | No | — | SSH username — set this to enable `diagnose` commands over SSH |
| `FORTIGATE_SSH_PASSWORD` | No | — | SSH password for the user above |
| `FORTIGATE_SSH_KEY` | No | — | PEM private key (alternative to password for SSH) |
| `FORTIGATE_SSH_PORT` | No | `22` | SSH port — only change if you use a non-standard port |

> **Minimum to get started:** Just `FORTIGATE_HOST` and `FORTIGATE_API_KEY`. Everything else is optional.

### FortiAnalyzer Variables

| Environment Variable | Required | Default | Description |
|---|---|---|---|
| `FAZ_HOST` | **Yes** | — | Your FortiAnalyzer's IP address (e.g., `10.0.0.50`) |
| `FAZ_API_TOKEN` | **Yes**\* | — | API token (recommended — [see above](#fortianalyzer-api-token)) |
| `FAZ_USER` | **Yes**\* | — | Admin username (alternative to API token) |
| `FAZ_PASSWORD` | **Yes**\* | — | Admin password (use with `FAZ_USER`) |
| `FAZ_PORT` | No | `443` | HTTPS port |
| `FAZ_ADOM` | No | `root` | Administrative Domain — change if your devices are in a different ADOM |
| `FAZ_VERIFY_SSL` | No | `false` | Set to `true` if your FAZ has a real TLS certificate |

> \* **Authentication:** Use **either** `FAZ_API_TOKEN` (recommended) **or** `FAZ_USER` + `FAZ_PASSWORD`. You don't need both.

## Installing on Unraid

> **How this works:** This is an MCP server (not a web app). It doesn't run 24/7 as a container in Unraid's Docker tab. When you ask Claude a firewall question, Claude Desktop connects to Unraid's Docker daemon remotely and runs `docker run` — the container starts, answers the query, and stops automatically. All you need on Unraid is the Docker **image** built and the Docker TCP socket enabled.

### Step 1 — Build the Docker Image

SSH into your Unraid server (or use the **Terminal** button in the Unraid web UI):

```bash
# Go to your appdata folder (or wherever you keep projects)
cd /mnt/user/appdata

# Clone the repo
git clone https://github.com/ivillagomez/fortigate-mcp.git

# Go into the folder
cd fortigate-mcp

# Build the Docker image
docker build -t fortigate-mcp .
```

### Step 2 — Enable Docker TCP Socket on Unraid

Claude Desktop needs to reach Unraid's Docker daemon over the network. Enable this once by appending a line to Unraid's Docker config:

```bash
echo 'DOCKER_OPTS="-H tcp://0.0.0.0:2375 -H unix:///var/run/docker.sock"' >> /boot/config/docker.cfg
/etc/rc.d/rc.docker restart
```

Verify it's working:

```bash
docker -H tcp://YOUR_UNRAID_IP:2375 info
```

> **This persists across reboots** — `/boot/config/docker.cfg` is on the flash drive and survives restarts.

> **Security note:** Port 2375 is unencrypted. This is fine on a trusted local network. Do not expose this port to the internet.

### Step 3 — Connect Claude Desktop

On the machine where you use Claude Desktop (your laptop/PC), add this to your `claude_desktop_config.json`:

> **Replace these values:**
> - `YOUR_UNRAID_IP` — your Unraid server's IP address (e.g., `192.168.1.100`)
> - `192.168.1.1` — your FortiGate's IP address
> - `your-api-token` — the FortiGate API token you created

<details>
<summary><strong>FortiGate only</strong></summary>

```json
{
  "mcpServers": {
    "fortigate": {
      "command": "docker",
      "args": [
        "-H", "tcp://YOUR_UNRAID_IP:2375",
        "run", "--rm", "-i", "--name", "fortigate-mcp",
        "-e", "FORTIGATE_HOST=192.168.1.1",
        "-e", "FORTIGATE_API_KEY=your-api-token",
        "fortigate-mcp"
      ]
    }
  }
}
```

</details>

<details>
<summary><strong>Hybrid (FortiGate + FortiAnalyzer + SSH)</strong></summary>

```json
{
  "mcpServers": {
    "fortigate": {
      "command": "docker",
      "args": [
        "-H", "tcp://YOUR_UNRAID_IP:2375",
        "run", "--rm", "-i", "--name", "fortigate-mcp",
        "-e", "FORTIGATE_HOST=192.168.1.1",
        "-e", "FORTIGATE_API_KEY=your-api-token",
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

</details>

> **How it works:** Claude Desktop uses the Docker CLI on your local machine with `-H tcp://YOUR_UNRAID_IP:2375` to run the container on Unraid. The FortiGate/FAZ queries happen from Unraid's network, so your firewall only needs to be reachable from Unraid — not from your laptop.

> **Prerequisite:** Docker must be installed on the machine running Claude Desktop (Docker Desktop for Windows/macOS). The Docker CLI is used to connect remotely — nothing runs locally.

### Alternative: SSH approach

If you cannot or prefer not to expose the Docker TCP socket, the original SSH method still works. It requires a passwordless SSH key from your laptop to Unraid.

<details>
<summary><strong>SSH config example</strong></summary>

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

**SSH key setup (one-time):**

macOS / Linux:
```bash
ssh-keygen -t ed25519
ssh-copy-id root@YOUR_UNRAID_IP
ssh root@YOUR_UNRAID_IP echo "SSH key works!"
```

Windows (PowerShell):
```powershell
ssh-keygen -t ed25519
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh root@YOUR_UNRAID_IP "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"
ssh root@YOUR_UNRAID_IP echo "SSH key works!"
```

</details>

### Unraid Docker UI

<details>
<summary><strong>Unraid Docker UI variable reference</strong></summary>

If you want to configure variables through the Unraid GUI, click **Add another Path, Port, Variable, Label or Device** for each:

| Config Type | Name | Key | Example Value | Required |
|---|---|---|---|---|
| Variable | FortiGate Host | `FORTIGATE_HOST` | `192.168.1.1` | Yes |
| Variable | FortiGate API Key | `FORTIGATE_API_KEY` | `your-api-token` | Yes |
| Variable | FortiGate Port | `FORTIGATE_PORT` | `443` | No |
| Variable | Verify SSL | `FORTIGATE_VERIFY_SSL` | `false` | No |
| Variable | VDOM | `FORTIGATE_VDOM` | `root` | No |
| Variable | SSH User | `FORTIGATE_SSH_USER` | `admin` | No |
| Variable | SSH Password | `FORTIGATE_SSH_PASSWORD` | `your-password` | No |
| Variable | SSH Port | `FORTIGATE_SSH_PORT` | `22` | No |
| Variable | FAZ Host | `FAZ_HOST` | `10.0.0.50` | If using FAZ |
| Variable | FAZ API Token | `FAZ_API_TOKEN` | `your-faz-token` | If using FAZ |
| Variable | FAZ User | `FAZ_USER` | `admin` | Alt to token |
| Variable | FAZ Password | `FAZ_PASSWORD` | `your-password` | Alt to token |
| Variable | FAZ Port | `FAZ_PORT` | `443` | No |
| Variable | FAZ ADOM | `FAZ_ADOM` | `root` | No |
| Variable | FAZ Verify SSL | `FAZ_VERIFY_SSL` | `false` | No |

> No ports or volume mappings are needed — these are all **Variable** type configs with just a Key and Value.

</details>

## Using with Claude Desktop

Claude Desktop uses a JSON config file to know which MCP servers to launch. You need to edit this file once, then restart Claude Desktop.

> **Where is `claude_desktop_config.json`?**
> - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
>   - Usually: `C:\Users\YourName\AppData\Roaming\Claude\claude_desktop_config.json`
>   - Quick access: press `Win+R`, type `%APPDATA%\Claude`, hit Enter
> - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
>   - In Finder: Go > Go to Folder > paste the path above
> - **Linux:** `~/.config/Claude/claude_desktop_config.json`
>
> If the file doesn't exist yet, create it. After editing, **restart Claude Desktop** for changes to take effect.

### Docker

Pick the example that matches your setup. Replace the placeholder IPs and tokens with your real values.

<details>
<summary><strong>FortiGate only (simplest setup)</strong></summary>

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

> Replace `192.168.1.1` with your FortiGate's IP address and `your-api-token` with the API token you created.

</details>

<details>
<summary><strong>FortiGate + SSH (adds diagnose commands)</strong></summary>

```json
{
  "mcpServers": {
    "fortigate": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "FORTIGATE_HOST=192.168.1.1",
        "-e", "FORTIGATE_API_KEY=your-api-token",
        "-e", "FORTIGATE_SSH_USER=admin",
        "-e", "FORTIGATE_SSH_PASSWORD=your-ssh-password",
        "fortigate-mcp"
      ]
    }
  }
}
```

> SSH enables the `execute_cli_ssh` tool for `diagnose` commands. The SSH user should be a read-only admin on the FortiGate.

</details>

<details>
<summary><strong>FortiAnalyzer only</strong></summary>

```json
{
  "mcpServers": {
    "fortigate": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "-e", "FAZ_HOST=10.0.0.50",
        "-e", "FAZ_API_TOKEN=your-faz-token",
        "fortigate-mcp"
      ]
    }
  }
}
```

> Replace `10.0.0.50` with your FortiAnalyzer's IP address.

</details>

<details>
<summary><strong>Hybrid — FortiGate + FortiAnalyzer + SSH (all features)</strong></summary>

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

> This gives you all 38 tools — live FortiGate status, SSH diagnostics, and FortiAnalyzer centralized log search.

</details>

### Node.js

The `"args"` field must contain the **full absolute path** to the `build/index.js` file on your machine. This depends on where you cloned or downloaded the repo.

<details>
<summary><strong>Windows examples</strong></summary>

If you cloned the repo to your Desktop:
```json
{
  "mcpServers": {
    "fortigate": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\Desktop\\fortigate-mcp\\build\\index.js"],
      "env": {
        "FORTIGATE_HOST": "192.168.1.1",
        "FORTIGATE_API_KEY": "your-api-token"
      }
    }
  }
}
```

If you cloned it to a project folder:
```json
{
  "mcpServers": {
    "fortigate": {
      "command": "node",
      "args": ["C:\\Projects\\fortigate-mcp\\build\\index.js"],
      "env": {
        "FORTIGATE_HOST": "192.168.1.1",
        "FORTIGATE_API_KEY": "your-api-token"
      }
    }
  }
}
```

> **Tip:** On Windows, use double backslashes (`\\`) in JSON paths, or forward slashes (`/`) — both work with Node.js.

</details>

<details>
<summary><strong>macOS examples</strong></summary>

If you cloned the repo to your home folder:
```json
{
  "mcpServers": {
    "fortigate": {
      "command": "node",
      "args": ["/Users/yourname/fortigate-mcp/build/index.js"],
      "env": {
        "FORTIGATE_HOST": "192.168.1.1",
        "FORTIGATE_API_KEY": "your-api-token"
      }
    }
  }
}
```

If you cloned it to your Documents folder:
```json
{
  "mcpServers": {
    "fortigate": {
      "command": "node",
      "args": ["/Users/yourname/Documents/fortigate-mcp/build/index.js"],
      "env": {
        "FORTIGATE_HOST": "192.168.1.1",
        "FORTIGATE_API_KEY": "your-api-token"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Linux examples</strong></summary>

If you cloned the repo to your home folder:
```json
{
  "mcpServers": {
    "fortigate": {
      "command": "node",
      "args": ["/home/yourname/fortigate-mcp/build/index.js"],
      "env": {
        "FORTIGATE_HOST": "192.168.1.1",
        "FORTIGATE_API_KEY": "your-api-token"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>Hybrid mode (FortiGate + FortiAnalyzer + SSH)</strong></summary>

The path works the same way — just add more env vars:
```json
{
  "mcpServers": {
    "fortigate": {
      "command": "node",
      "args": ["C:\\Users\\YourName\\Desktop\\fortigate-mcp\\build\\index.js"],
      "env": {
        "FORTIGATE_HOST": "192.168.1.1",
        "FORTIGATE_API_KEY": "your-fg-api-token",
        "FORTIGATE_SSH_USER": "admin",
        "FORTIGATE_SSH_PASSWORD": "your-ssh-password",
        "FAZ_HOST": "10.0.0.50",
        "FAZ_API_TOKEN": "your-faz-api-token"
      }
    }
  }
}
```

</details>

> **How to find the right path:** Open a terminal, `cd` into your `fortigate-mcp` folder, and run:
> - **Windows (PowerShell):** `echo "$PWD\build\index.js"`
> - **macOS / Linux:** `echo "$(pwd)/build/index.js"`
>
> Copy the output and paste it into the `"args"` field.

> **Where is `claude_desktop_config.json`?**
> - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
> - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
> - **Linux:** `~/.config/Claude/claude_desktop_config.json`
>
> If the file doesn't exist, create it. After editing, **restart Claude Desktop** for changes to take effect.

## Using with Claude Code

[Claude Code](https://docs.anthropic.com/en/docs/claude-code) is the CLI version of Claude. You register MCP servers using the `claude mcp add` command.

### Docker

Open a terminal and run **one** of the following commands (pick the one that matches your setup):

<details>
<summary><strong>FortiGate only</strong></summary>

```bash
claude mcp add fortigate -- docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
  fortigate-mcp
```

</details>

<details>
<summary><strong>FortiGate + SSH</strong></summary>

```bash
claude mcp add fortigate -- docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
  -e FORTIGATE_SSH_USER=admin \
  -e FORTIGATE_SSH_PASSWORD=your-ssh-password \
  fortigate-mcp
```

</details>

<details>
<summary><strong>FortiAnalyzer only</strong></summary>

```bash
claude mcp add fortigate -- docker run --rm -i \
  -e FAZ_HOST=10.0.0.50 \
  -e FAZ_API_TOKEN=your-faz-token \
  fortigate-mcp
```

</details>

<details>
<summary><strong>Hybrid (all features)</strong></summary>

```bash
claude mcp add fortigate -- docker run --rm -i \
  -e FORTIGATE_HOST=192.168.1.1 \
  -e FORTIGATE_API_KEY=your-api-token \
  -e FORTIGATE_SSH_USER=admin \
  -e FORTIGATE_SSH_PASSWORD=your-ssh-password \
  -e FAZ_HOST=10.0.0.50 \
  -e FAZ_API_TOKEN=your-faz-token \
  fortigate-mcp
```

</details>

### Node.js

If you're not using Docker, point Claude Code at the `build/index.js` file directly. Use the **full absolute path** to where you cloned the repo:

```bash
# Windows example (PowerShell):
claude mcp add fortigate -- node "C:\Users\YourName\Desktop\fortigate-mcp\build\index.js"

# macOS / Linux example:
claude mcp add fortigate -- node /home/yourname/fortigate-mcp/build/index.js
```

> **Note:** When using Node.js with Claude Code, set your environment variables in a `.env` file inside the repo folder (see [Quick Start](#quick-start)), or export them in your shell before running `claude`.

### Verifying

After adding, run `claude mcp list` to confirm the server is registered. Then start a Claude Code session and ask something like "What's the system status of my firewall?"

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
