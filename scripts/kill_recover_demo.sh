#!/usr/bin/env bash
# kill_recover_demo.sh — Section 6 / Step 13, matching your kickoff doc's own
# Step 6 (smoke test) + Step 7 (kill-and-recover) exactly.
#
# IMPORTANT: this only produces a real lock steal if ingest_node has been
# patched to be idempotent-on-fingerprint (see the ingest_node patch —
# without it, WEST creates a second unlocked incident instead of contending
# for EAST's lock, and the demo won't show what it's supposed to show).
#
# Requires: aws cli configured for both regions, jq, and the SAM stacks
# named cortex-us-east-1 / cortex-us-west-2 (per your template.yaml).
#
# Run from repo root:  ./scripts/kill_recover_demo.sh [fingerprint]

set -euo pipefail

FINGERPRINT="${1:-demo-kill-$(date +%s)}"
EAST_FN="cortex-agent-us-east-1"
WEST_FN="cortex-agent-us-west-2"

pause() { echo; read -rp "▶ Press Enter when ready for this beat... " _; }
banner() { echo; echo "════════════════════════════════════════════════════════"; echo "  $1"; echo "════════════════════════════════════════════════════════"; }

banner "STEP 0 — Resolve Function URLs from CloudFormation"
EAST_URL=$(aws cloudformation describe-stacks --region us-east-1 \
  --stack-name cortex-us-east-1 \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text)
WEST_URL=$(aws cloudformation describe-stacks --region us-west-2 \
  --stack-name cortex-us-west-2 \
  --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text)
echo "EAST_URL=${EAST_URL}"
echo "WEST_URL=${WEST_URL}"

banner "Pre-flight health check"
curl -sf "${EAST_URL}/health" && echo || echo "⚠ us-east-1 health check failed"
curl -sf "${WEST_URL}/health" && echo || echo "⚠ us-west-2 health check failed"

pause
banner "STEP 1 — Trigger incident on us-east-1 (fingerprint=${FINGERPRINT})"
curl -X POST "${EAST_URL}/incidents" -H "Content-Type: application/json" \
  -d "{\"fingerprint\":\"${FINGERPRINT}\",\"title\":\"Payment gateway timeout spike\",\"service_name\":\"checkout\",\"severity\":\"sev2\",\"origin_region\":\"us-east-1\"}" &
echo "Fired in background — giving remediation_agent time to acquire the lock..."
sleep 6

banner "STEP 2 — Kill us-east-1 mid-incident (reserved concurrency → 0)"
echo "Watch the dashboard: the us-east-1 pill should flip to UNREACHABLE now."
aws lambda put-function-concurrency \
  --region us-east-1 --function-name "${EAST_FN}" --reserved-concurrent-executions 0
echo "us-east-1 throttled."

pause
banner "STEP 3 — Trigger the SAME fingerprint on us-west-2"
echo "Requires the ingest_node fingerprint-dedupe patch — otherwise this creates"
echo "a second, unrelated incident instead of stealing the lock."
curl -X POST "${WEST_URL}/incidents" -H "Content-Type: application/json" \
  -d "{\"fingerprint\":\"${FINGERPRINT}\",\"title\":\"Payment gateway timeout spike\",\"service_name\":\"checkout\",\"severity\":\"sev2\",\"origin_region\":\"us-east-1\"}"
echo
echo "Check the dashboard: mcp_audit_log should show acquire_or_steal_lock succeeding"
echo "twice for this incident_id, from two different agent_instance_id values."

pause
banner "STEP 4 — Restore us-east-1 concurrency"
aws lambda delete-function-concurrency --region us-east-1 --function-name "${EAST_FN}"
sleep 3
curl -sf "${EAST_URL}/health" && echo || echo "⚠ still recovering, give it a few seconds"

banner "DONE — fingerprint ${FINGERPRINT}: check the dashboard's Mission Log for the full timeline"