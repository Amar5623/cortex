USE cortex;

-- Per-agent roles for the DIRECT connection only (the handful of UPDATEs
-- the Managed MCP Server can't do). All SELECT/INSERT traffic instead goes
-- through the Managed MCP Server as the existing cortex-mcp-agent service
-- account -- that's cluster-scoped Cloud RBAC, not a SQL grant, so it isn't
-- represented here.

CREATE ROLE IF NOT EXISTS triage_agent WITH LOGIN PASSWORD '<choose-a-password>';
CREATE ROLE IF NOT EXISTS runbook_agent WITH LOGIN PASSWORD '<choose-a-password>';
CREATE ROLE IF NOT EXISTS remediation_agent WITH LOGIN PASSWORD '<choose-a-password>';
CREATE ROLE IF NOT EXISTS postmortem_agent WITH LOGIN PASSWORD '<choose-a-password>';

GRANT SELECT ON incidents TO triage_agent, runbook_agent, remediation_agent, postmortem_agent;

GRANT CONNECT ON DATABASE cortex TO triage_agent, runbook_agent, remediation_agent, postmortem_agent;

-- triage_agent: opens the incident, flips open -> triaging
GRANT UPDATE ON incidents TO triage_agent;
GRANT INSERT ON mcp_audit_log TO triage_agent;

-- runbook_agent: pure retrieval, flips triaging -> diagnosing
GRANT UPDATE ON incidents TO runbook_agent;
GRANT INSERT ON mcp_audit_log TO runbook_agent;

-- remediation_agent: the ONLY role that can touch incident_locks at all,
-- and the only one that can move status into/out of 'remediating'
GRANT SELECT, INSERT, UPDATE ON incident_locks TO remediation_agent;
GRANT UPDATE ON incidents TO remediation_agent;
GRANT INSERT ON mcp_audit_log TO remediation_agent;

-- postmortem_agent: closes the incident out
GRANT UPDATE ON incidents TO postmortem_agent;
GRANT INSERT ON mcp_audit_log TO postmortem_agent;

-- No role has DELETE on anything. Only remediation_agent can touch
-- incident_locks -- that exclusivity is itself part of the story: even a
-- compromised or misbehaving triage/runbook/postmortem agent structurally
-- cannot forge a lock.
