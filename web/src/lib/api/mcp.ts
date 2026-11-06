// src/lib/api/mcp.ts — agent access tokens (issue #83).
//
// A token is a standing credential to the whole family, so minting and
// revoking are owner/admin actions; listing is available to any member.
import api from './client';

export interface McpToken {
  id: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export const mcpAPI = {
  listTokens: () => api.get<{ tokens: McpToken[] }>('/mcp/tokens'),
  createToken: (label?: string) =>
    api.post<{ token: string; mcpToken: McpToken }>('/mcp/tokens', label ? { label } : {}),
  revokeToken: (id: string) => api.delete<{ message: string }>(`/mcp/tokens/${id}`),
};
