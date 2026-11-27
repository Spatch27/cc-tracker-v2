"use client";

import { useState } from "react";
import { KeyRound, Plus, ShieldOff } from "lucide-react";
import { AGENT_SCOPES, type AgentScope } from "@/lib/agent-scopes";

export interface AgentListItem {
  id: string;
  name: string;
  description: string | null;
  tokenPrefix: string;
  scopes: string[];
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export function AdminAgentsPanel({
  initialAgents,
  dbReady,
}: {
  initialAgents: AgentListItem[];
  dbReady: boolean;
}) {
  const [agents, setAgents] = useState<AgentListItem[]>(initialAgents);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<AgentScope[]>([
    "read:context",
    "propose:research",
    "draft:message",
  ]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function toggleScope(scope: AgentScope) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNewToken(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description: description || null,
          scopes: selectedScopes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create agent token");
        return;
      }
      setNewToken(data.rawToken);
      setAgents((prev) => [data.agent, ...prev]);
      setName("");
      setDescription("");
    } catch {
      setError("Network error creating agent identity");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/agents/${id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to revoke agent");
        return;
      }
      setAgents((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, revokedAt: data.agent.revokedAt } : a,
        ),
      );
    } catch {
      setError("Network error revoking agent");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-surface p-5 space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium text-foreground">
            Tracker MCP Server (Claude &amp; External Agents)
          </h2>
          <span className="rounded-full border border-border bg-surface-elevated px-2.5 py-0.5 text-[11px] font-mono text-muted">
            JSON-RPC 2.0
          </span>
        </div>
        <p className="text-xs text-muted leading-relaxed">
          Connect Claude or external agents to{" "}
          <code className="font-mono text-foreground">/api/mcp</code> using{" "}
          <code className="font-mono text-foreground">
            Authorization: Bearer &lt;agent-token&gt;
          </code>
          . Available tools are scoped dynamically to the token&apos;s granted
          permissions:
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px] font-mono text-muted">
          <div className="rounded-lg border border-border bg-surface-elevated p-2.5">
            <span className="text-foreground font-semibold block mb-1">
              read:context
            </span>
            list_breakfasts, get_breakfast_preread_context, list_gold_accounts,
            get_gold_account_context, get_proposal_status,
            get_message_approval_status
          </div>
          <div className="rounded-lg border border-border bg-surface-elevated p-2.5">
            <span className="text-foreground font-semibold block mb-1">
              write / propose scopes
            </span>
            submit_research_proposal (propose:research), submit_message_draft
            (draft:message), report_message_execution (report:execution),
            log_outreach_activity (log:activity), manage_follow_up_action
            (manage:actions)
          </div>
        </div>
      </div>

      {!dbReady && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          Database is not yet connected/migrated. Configure{" "}
          <code className="font-mono">DATABASE_URL</code> and run{" "}
          <code className="font-mono">npm run db:push</code> to manage agent
          identities.
        </div>
      )}

      {newToken && (
        <div className="rounded-xl border border-success/40 bg-success/10 p-4 space-y-2">
          <p className="text-sm font-medium text-success">
            Agent token created — copy it now (shown only once):
          </p>
          <pre className="rounded-lg bg-background p-3 text-xs font-mono text-foreground overflow-x-auto">
            {newToken}
          </pre>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-border bg-surface p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-accent" />
          <h2 className="text-sm font-medium">Issue Scoped Agent Token</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted block">Agent Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Claude Preread Assistant"
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted block">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional purpose note"
              className="w-full rounded-lg border border-border bg-surface-elevated px-3 py-2 text-sm text-foreground focus:outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs text-muted block">Allowed Scopes</span>
          <div className="flex flex-wrap gap-2">
            {AGENT_SCOPES.map((scope) => {
              const checked = selectedScopes.includes(scope);
              return (
                <button
                  key={scope}
                  type="button"
                  onClick={() => toggleScope(scope)}
                  className={`rounded-lg border px-2.5 py-1 text-xs font-mono transition-colors ${
                    checked
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border bg-surface-elevated text-muted hover:text-foreground"
                  }`}
                >
                  {scope}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={busy || !dbReady || !name.trim() || selectedScopes.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-accent-foreground disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Agent Identity
        </button>
      </form>

      <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
        <h2 className="text-sm font-medium">Registered Agent Identities</h2>
        {agents.length === 0 ? (
          <p className="text-sm text-muted">
            No external agent identities registered yet.
          </p>
        ) : (
          <div className="space-y-2.5">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-border bg-surface-elevated p-3.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{agent.name}</span>
                    <code className="text-xs font-mono text-muted">
                      {agent.tokenPrefix}…
                    </code>
                    {agent.revokedAt ? (
                      <span className="rounded-full bg-danger/15 text-danger px-2 py-0.5 text-[11px]">
                        Revoked
                      </span>
                    ) : (
                      <span className="rounded-full bg-success/15 text-success px-2 py-0.5 text-[11px]">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-muted">
                    Scopes: {agent.scopes.join(", ")}
                  </p>
                </div>

                {!agent.revokedAt && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRevoke(agent.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger hover:bg-danger/20"
                  >
                    <ShieldOff className="h-3.5 w-3.5" />
                    Revoke
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
