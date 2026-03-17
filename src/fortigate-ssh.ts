/**
 * FortiGate SSH Client
 * Executes CLI commands over SSH — useful for diagnose commands
 * and deeper troubleshooting not available via the REST API.
 *
 * Read-only: blocks the same write commands as the REST CLI tool.
 */

import { Client } from "ssh2";

export interface SshConfig {
  host: string;
  port?: number;        // default 22
  username: string;
  password?: string;
  privateKey?: string;   // PEM-encoded private key
  timeout?: number;      // connection timeout in ms (default 10000)
}

// Same blocked commands as the REST API CLI tool
const BLOCKED_PREFIXES = [
  "config ", "set ", "delete ", "edit ", "append ", "end",
  "execute shutdown", "execute reboot", "execute factoryreset",
  "execute restore", "execute batch",
];

function isBlocked(cmd: string): boolean {
  const lower = cmd.toLowerCase().trim();
  return BLOCKED_PREFIXES.some((b) => lower.startsWith(b));
}

export class FortiGateSSH {
  constructor(private config: SshConfig) {}

  /**
   * Execute one or more CLI commands over SSH.
   * Returns the combined output from all commands.
   */
  async execute(commands: string[]): Promise<string> {
    // Safety check
    for (const cmd of commands) {
      if (isBlocked(cmd)) {
        throw new Error(`Blocked: "${cmd}" is a write operation. This server is read-only.`);
      }
    }

    const timeout = this.config.timeout ?? 10000;

    return new Promise((resolve, reject) => {
      const conn = new Client();
      const outputs: string[] = [];
      let currentCmd = 0;

      const cleanup = () => {
        try { conn.end(); } catch { /* ignore */ }
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`SSH connection timed out after ${timeout}ms`));
      }, timeout + 5000); // extra buffer beyond connect timeout

      conn.on("ready", () => {
        conn.shell((err, stream) => {
          if (err) {
            clearTimeout(timer);
            cleanup();
            return reject(new Error(`SSH shell error: ${err.message}`));
          }

          let buffer = "";
          let settled = false;

          const finish = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();

            // Clean up the output: remove the command echoes and prompts
            const cleaned = cleanOutput(buffer, commands);
            resolve(cleaned);
          };

          stream.on("data", (data: Buffer) => {
            buffer += data.toString("utf8");

            // After sending all commands, look for the final prompt
            if (currentCmd >= commands.length) {
              // FortiGate prompts look like "FW-NAME # " or "FW-NAME $ "
              const lines = buffer.split("\n");
              const lastLine = lines[lines.length - 1].trim();
              if (lastLine.match(/[#$]\s*$/) && buffer.includes(commands[commands.length - 1])) {
                // Give a brief moment for any trailing output
                setTimeout(finish, 500);
              }
            }
          });

          stream.on("close", () => {
            finish();
          });

          stream.on("error", (streamErr: Error) => {
            if (!settled) {
              settled = true;
              clearTimeout(timer);
              cleanup();
              reject(new Error(`SSH stream error: ${streamErr.message}`));
            }
          });

          // Send commands sequentially with a small delay
          const sendNext = () => {
            if (currentCmd < commands.length) {
              stream.write(commands[currentCmd] + "\n");
              currentCmd++;
              setTimeout(sendNext, 300);
            } else {
              // Send an extra newline to trigger the prompt, then wait for output
              setTimeout(() => {
                stream.write("\n");
              }, 500);
            }
          };

          // Wait briefly for the initial prompt, then start sending
          setTimeout(sendNext, 500);
        });
      });

      conn.on("error", (connErr) => {
        clearTimeout(timer);
        reject(new Error(`SSH connection error: ${connErr.message}`));
      });

      // Build connection config
      const connConfig: Record<string, unknown> = {
        host: this.config.host,
        port: this.config.port ?? 22,
        username: this.config.username,
        readyTimeout: timeout,
        // FortiGate uses older algorithms
        algorithms: {
          kex: [
            "ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
            "diffie-hellman-group-exchange-sha256", "diffie-hellman-group14-sha256",
            "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1",
          ],
          cipher: [
            "aes128-ctr", "aes192-ctr", "aes256-ctr",
            "aes128-gcm", "aes128-gcm@openssh.com", "aes256-gcm", "aes256-gcm@openssh.com",
            "aes128-cbc", "aes192-cbc", "aes256-cbc",
          ],
          hmac: [
            "hmac-sha2-256", "hmac-sha2-512", "hmac-sha1",
          ],
          serverHostKey: [
            "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521",
            "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa", "ssh-ed25519",
          ],
        },
      };

      if (this.config.privateKey) {
        connConfig.privateKey = this.config.privateKey;
      } else if (this.config.password) {
        connConfig.password = this.config.password;
      } else {
        clearTimeout(timer);
        return reject(new Error("SSH requires either password or privateKey"));
      }

      conn.connect(connConfig as Parameters<typeof conn.connect>[0]);
    });
  }
}

/**
 * Clean up raw SSH output by removing command echoes, prompts, and ANSI codes
 */
function cleanOutput(raw: string, commands: string[]): string {
  // Remove ANSI escape codes
  let cleaned = raw.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
  // Remove carriage returns
  cleaned = cleaned.replace(/\r/g, "");

  const lines = cleaned.split("\n");
  const resultLines: string[] = [];
  let capturing = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines at the start
    if (!capturing && trimmed === "") continue;

    // Skip lines that are just the command being echoed
    if (commands.some((cmd) => trimmed === cmd || trimmed.endsWith(cmd))) {
      capturing = true;
      continue;
    }

    // Skip prompt-only lines (e.g. "FortiGate60F # ")
    if (trimmed.match(/^[\w-]+ [#$]\s*$/)) continue;

    if (capturing) {
      resultLines.push(line);
    }
  }

  return resultLines.join("\n").trim();
}
