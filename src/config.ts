// Default Microsoft Graph CLI app (multi-tenant public client).
// Override with TEAMS_MCP_CLIENT_ID / TEAMS_MCP_AUTHORITY to use a custom Entra app
// registration — required for tenants that block device-code flow via Conditional Access.
const DEFAULT_CLIENT_ID = "14d82eec-204b-4c2f-b7e8-296a70dab67e";
const DEFAULT_AUTHORITY = "https://login.microsoftonline.com/common";

export function getClientId(): string {
  return process.env.TEAMS_MCP_CLIENT_ID || DEFAULT_CLIENT_ID;
}

export function getAuthority(): string {
  return process.env.TEAMS_MCP_AUTHORITY || DEFAULT_AUTHORITY;
}
