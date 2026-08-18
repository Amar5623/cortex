# Cortex — Deploy to two regions with SAM

Prereqs: `sam` CLI and Docker installed locally (Docker is only used by
`sam build --use-container` to build against a real Lambda-compatible
environment — no ECR, no pushing images, this is unrelated to the
container-image deployment path we ruled out).

```bash
pip install --user aws-sam-cli
sam --version
```

Make sure your AWS CLI is using the `cortex-deploy` IAM user, not root, for
all of this. SAM deploy needs more than single-Lambda permissions —
CloudFormation, Lambda, IAM role creation (`iam:PassRole` in particular), and
SSM read. If any command below fails with `AccessDenied`, that's the first
thing to check — attach `AdministratorAccess` temporarily if you're blocked
with days left, then narrow it later, don't burn hours hand-tuning an IAM
policy mid-hackathon.

```bash
aws configure --profile cortex-deploy
export AWS_PROFILE=cortex-deploy
```

## Step 1 — Create SSM parameters, in BOTH regions

SSM Parameter Store is regional. The template pulls these in at deploy time
from whichever region you're deploying to, so each region needs its own copy.

Replace the placeholder values below with your real credentials from `.env`.

```bash
for REGION in us-east-1 us-west-2; do
  aws ssm put-parameter --region $REGION --name /cortex/groq_api_key \
    --type SecureString --value "YOUR_GROQ_KEY" --overwrite

  aws ssm put-parameter --region $REGION --name /cortex/crdb_host \
    --type SecureString --value "YOUR_CRDB_HOST" --overwrite

  aws ssm put-parameter --region $REGION --name /cortex/triage_agent_password \
    --type SecureString --value "YOUR_TRIAGE_PASSWORD" --overwrite

  aws ssm put-parameter --region $REGION --name /cortex/runbook_agent_password \
    --type SecureString --value "YOUR_RUNBOOK_PASSWORD" --overwrite

  aws ssm put-parameter --region $REGION --name /cortex/remediation_agent_password \
    --type SecureString --value "YOUR_REMEDIATION_PASSWORD" --overwrite

  aws ssm put-parameter --region $REGION --name /cortex/postmortem_agent_password \
    --type SecureString --value "YOUR_POSTMORTEM_PASSWORD" --overwrite

  aws ssm put-parameter --region $REGION --name /cortex/crdb_cluster_id \
    --type String --value "YOUR_CLUSTER_ID" --overwrite

  aws ssm put-parameter --region $REGION --name /cortex/crdb_mcp_api_key \
    --type SecureString --value "YOUR_MCP_API_KEY" --overwrite

  aws ssm put-parameter --region $REGION --name /cortex/crdb_mcp_endpoint \
    --type String --value "https://cockroachlabs.cloud/mcp" --overwrite
done
```

Note: `SecureString` params need `Type: AWS::SSM::Parameter::Value<String>`
in the template to actually work at the CFN level — CloudFormation resolves
SecureString the same way as String for this parameter type, no extra config
needed on the template side.

## Step 2 — Re-embed existing data (once, before anything touches fastembed in prod)

```bash
cd cortex
pip install fastembed asyncpg --break-system-packages
DATABASE_URL="postgresql://..." python agents/reembed_runbooks.py
```

Read the script's final printed instruction and actually run that sanity
`SELECT` before moving on — this is the one step that silently corrupts
retrieval quality if skipped, and it won't throw an error if skipped.

## Step 3 — Build once, check the real size

```bash
sam build --use-container
du -sh .aws-sam/build/CortexFunction/
```

Expect roughly 100–180MB unzipped. If it's near or over 250MB, stop and tell
me — don't try to deploy anyway and see what breaks. Most likely culprit
would be an accidental `torch` import still reachable somewhere in the
codebase pulling it back in as a transitive dependency.

## Step 4 — Deploy to us-east-1 (primary)

```bash
sam deploy --guided --region us-east-1 --stack-name cortex-us-east-1
```

`--guided` will ask for stack name, region, confirm changeset, and whether to
save these answers — say yes, it writes `samconfig.toml` so you don't retype
this. Note the `FunctionUrl` output at the end; that's your primary endpoint.

## Step 5 — Deploy to us-west-2 (secondary), same template, no retyping

```bash
sam deploy --guided --region us-west-2 --stack-name cortex-us-west-2 \
  --config-env west
```

`--config-env west` saves this as a separate named section in the same
`samconfig.toml`, so from here on:

```bash
sam build --use-container
sam deploy --config-env default   # re-deploy east after a code change
sam deploy --config-env west      # re-deploy west after a code change
```

Both regions always come from the same build artifact — no drift possible
between them, which is the whole point of using SAM over raw CLI here.

## Step 6 — Smoke test both

```bash
EAST_URL=$(aws cloudformation describe-stacks --region us-east-1 \
  --stack-name cortex-us-east-1 --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text)

WEST_URL=$(aws cloudformation describe-stacks --region us-west-2 \
  --stack-name cortex-us-west-2 --query "Stacks[0].Outputs[?OutputKey=='FunctionUrl'].OutputValue" --output text)

curl -X POST "$EAST_URL/incidents" -H "Content-Type: application/json" \
  -d '{"fingerprint":"test-deploy-1","title":"Deploy smoke test","service_name":"test","severity":"sev3","origin_region":"us-east-1"}'

curl "$WEST_URL/health"
```

## Step 7 — The actual kill-and-recover demo

```bash
# 1. Start an incident against EAST, note it's mid-remediation
curl -X POST "$EAST_URL/incidents" -H "Content-Type: application/json" \
  -d '{"fingerprint":"demo-kill-1","title":"Payment gateway timeout spike","service_name":"checkout","severity":"sev2","origin_region":"us-east-1"}' &

# 2. While it's running, kill EAST's ability to respond -- either works,
#    pick whichever is cleaner on camera:
aws lambda put-function-concurrency --region us-east-1 \
  --function-name cortex-agent-us-east-1 --reserved-concurrent-executions 0
# (sets EAST to accept zero concurrent invocations -- instant, reversible,
# and visibly "this region is down" without destroying the stack)

# 3. Hit WEST with the SAME incident payload and show it resume from CockroachDB
#    (the runbook-retrieval agent will find context from the partially-completed
#    east run, remediation_agent will steal the expired lock)
curl -X POST "$WEST_URL/incidents" -H "Content-Type: application/json" \
  -d '{"fingerprint":"demo-kill-1","title":"Payment gateway timeout spike","service_name":"checkout","severity":"sev2","origin_region":"us-east-1"}'

# 4. Undo the throttle afterward
aws lambda delete-function-concurrency --region us-east-1 \
  --function-name cortex-agent-us-east-1
```

`put-function-concurrency ... 0` is worth using over actually deleting the
function — it's instant and instantly reversible, so if the first take of
the video isn't clean you can retry immediately instead of re-running Step 4.

## Cleanup, when you're done

```bash
sam delete --stack-name cortex-us-east-1 --region us-east-1
sam delete --stack-name cortex-us-west-2 --region us-west-2
```