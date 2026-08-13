CREATE DATABASE IF NOT EXISTS cortex;

USE cortex;

CREATE TABLE incidents (
    incident_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fingerprint     STRING NOT NULL,
    title           STRING NOT NULL,
    service_name    STRING NOT NULL,
    severity        STRING NOT NULL CHECK (severity IN ('sev1','sev2','sev3','sev4')),
    status          STRING NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','triaging','diagnosing','remediating','resolved','closed')),
    origin_region   STRING NOT NULL,
    raw_alert       JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX idx_incidents_fingerprint ON incidents (fingerprint);
CREATE INDEX idx_incidents_status ON incidents (status) WHERE status != 'closed';

CREATE TABLE incident_events (
    event_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id         UUID NOT NULL REFERENCES incidents(incident_id),
    seq                 INT8 NOT NULL DEFAULT unique_rowid(),
    agent_name          STRING NOT NULL,
    agent_instance_id   STRING NOT NULL,
    agent_region        STRING NOT NULL,
    event_type          STRING NOT NULL,
    payload              JSONB NOT NULL DEFAULT '{}',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_events_timeline ON incident_events (incident_id, seq);

CREATE TABLE incident_locks (
    incident_id        UUID PRIMARY KEY REFERENCES incidents(incident_id),
    locked_by_agent     STRING,
    locked_by_instance  STRING,
    locked_by_region    STRING,
    lock_token          UUID,
    acquired_at          TIMESTAMPTZ,
    lease_expires_at     TIMESTAMPTZ,
    released_at          TIMESTAMPTZ
);

CREATE TABLE runbooks (
    runbook_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title           STRING NOT NULL,
    service_name    STRING NOT NULL,
    content         STRING NOT NULL,
    embedding       VECTOR(384) NOT NULL,
    source_s3_key   STRING,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VECTOR INDEX idx_runbooks_embedding ON runbooks (embedding);
CREATE INDEX idx_runbooks_service ON runbooks (service_name);

CREATE TABLE postmortems (
    postmortem_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    incident_id          UUID NOT NULL REFERENCES incidents(incident_id),
    summary               STRING NOT NULL,
    root_cause            STRING NOT NULL,
    remediation_taken     STRING NOT NULL,
    content               STRING NOT NULL,
    embedding             VECTOR(384) NOT NULL,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE VECTOR INDEX idx_postmortems_embedding ON postmortems (embedding);

CREATE TABLE mcp_audit_log (
    audit_id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    mcp_tool_name        STRING NOT NULL,
    agent_name           STRING NOT NULL,
    agent_instance_id    STRING NOT NULL,
    incident_id          UUID,
    request_summary      JSONB,
    success               BOOL NOT NULL,
    error_message         STRING
);

CREATE INDEX idx_audit_incident ON mcp_audit_log (incident_id, occurred_at);
CREATE INDEX idx_audit_agent ON mcp_audit_log (agent_name, occurred_at);
