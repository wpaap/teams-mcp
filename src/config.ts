import { homedir } from "node:os";
import { join } from "node:path";

// Default Microsoft Graph CLI app (multi-tenant public client).
// Override with TEAMS_MCP_CLIENT_ID / TEAMS_MCP_TENANT_ID to use a custom Entra app
// registration — required for tenants that block device-code flow via Conditional Access.
const DEFAULT_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
const DEFAULT_TOKEN_CACHE_PATH = join(homedir(), ".teams-mcp-token-cache.json");

/** Entra app (client) ID — env override or Graph CLI default. */
export function getClientId(): string {
  return process.env.TEAMS_MCP_CLIENT_ID || DEFAULT_CLIENT_ID;
}

/**
 * OAuth authority URL. Upstream configures it with TEAMS_MCP_TENANT_ID; the
 * summit-only TEAMS_MCP_AUTHORITY (a full URL) still wins so existing configs keep working.
 */
export function getAuthority(): string {
  return (
    process.env.TEAMS_MCP_AUTHORITY ||
    `https://login.microsoftonline.com/${process.env.TEAMS_MCP_TENANT_ID || "common"}`
  );
}

/**
 * MSAL token cache location — env override or `~/.teams-mcp-token-cache.json`.
 * A separate path gives an isolated runtime its own sign-in, instead of sharing
 * (and contending over) the cache of every other teams-mcp process on the machine.
 */
export function getTokenCachePath(): string {
  return process.env.TEAMS_MCP_CACHE_PATH || DEFAULT_TOKEN_CACHE_PATH;
}
