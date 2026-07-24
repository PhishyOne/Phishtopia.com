#!/bin/sh
set -eu
umask 077

PROJECT_ID='project-43a8be4b-69a7-4d52-805'
ZONE='us-east1-b'
VM_NAME='phishtopia-vm'
REPOSITORY='PhishyOne/Phishtopia.com'
REPOSITORY_ID='997939289'
OWNER_ID='123998606'
WORKFLOW_REF='PhishyOne/Phishtopia.com/.github/workflows/phishtopia-ops-controller.yml@refs/heads/main'
POOL_ID='github-phishtopia-ops'
PROVIDER_ID='phishtopia-ops'
CONTROLLER_SA_ID='phishtopia-ops-controller'
REQUEST_TOPIC='phishtopia-ops-requests'
REQUEST_SUBSCRIPTION='phishtopia-ops-vm-requests'
RESPONSE_TOPIC='phishtopia-ops-responses'
RESPONSE_SUBSCRIPTION='phishtopia-ops-github-responses'

fail() {
  printf 'BOOTSTRAP_FAILED: %s\n' "$1" >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$1"
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

usage() {
  printf 'Usage: %s --queue-issue NUMBER\n' "$0" >&2
  exit 2
}

QUEUE_ISSUE=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --queue-issue)
      [ "$#" -ge 2 ] || usage
      QUEUE_ISSUE=$2
      shift 2
      ;;
    *) usage ;;
  esac
done

case "$QUEUE_ISSUE" in
  ''|*[!0-9]*) usage ;;
esac
[ "$QUEUE_ISSUE" -gt 0 ] || usage

need gcloud
need python3

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

ACTIVE_ACCOUNT=$(gcloud auth list --filter='status:ACTIVE' --format='value(account)' 2>/dev/null | sed -n '1p')
[ -n "$ACTIVE_ACCOUNT" ] || fail 'gcloud has no active authenticated account'

step 'Preflight: verify the fixed project and VM'
gcloud projects describe "$PROJECT_ID" --format='value(projectId)' >/dev/null || fail 'fixed project is unavailable to the active account'
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
case "$PROJECT_NUMBER" in
  ''|*[!0-9]*) fail 'could not resolve the project number' ;;
esac

gcloud compute instances describe "$VM_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --format=json >"$TMP_DIR/vm.json" || fail 'fixed VM is unavailable'

VM_SERVICE_ACCOUNT=$(python3 - "$TMP_DIR/vm.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    value = json.load(handle)
accounts = value.get('serviceAccounts')
if not isinstance(accounts, list) or len(accounts) != 1:
    raise SystemExit(1)
email = accounts[0].get('email') if isinstance(accounts[0], dict) else None
if not isinstance(email, str) or not email.endswith('.iam.gserviceaccount.com'):
    raise SystemExit(1)
print(email)
PY
) || fail 'the VM must have exactly one attached Google service account'

CONTROLLER_SERVICE_ACCOUNT="${CONTROLLER_SA_ID}@${PROJECT_ID}.iam.gserviceaccount.com"
POOL_RESOURCE="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL_ID}"
PROVIDER_RESOURCE="${POOL_RESOURCE}/providers/${PROVIDER_ID}"
WIF_MEMBER="principalSet://iam.googleapis.com/${POOL_RESOURCE}/attribute.repository_id/${REPOSITORY_ID}"

ATTRIBUTE_MAPPING='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.repository=assertion.repository,attribute.workflow_ref=assertion.workflow_ref,attribute.ref=assertion.ref,attribute.event_name=assertion.event_name,attribute.actor_id=assertion.actor_id'
ATTRIBUTE_CONDITION="assertion.repository_id=='${REPOSITORY_ID}' && assertion.repository_owner_id=='${OWNER_ID}' && assertion.repository=='${REPOSITORY}' && assertion.workflow_ref=='${WORKFLOW_REF}' && assertion.ref=='refs/heads/main' && assertion.event_name=='issue_comment' && assertion.actor_id=='${OWNER_ID}'"

step 'Enable only the APIs required by the controller transport'
gcloud services enable \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  pubsub.googleapis.com \
  --project="$PROJECT_ID" \
  --quiet >/dev/null

step 'Create or verify the dedicated GitHub controller service account'
if ! gcloud iam service-accounts describe "$CONTROLLER_SERVICE_ACCOUNT" --project="$PROJECT_ID" --format='value(email)' >/dev/null 2>&1; then
  gcloud iam service-accounts create "$CONTROLLER_SA_ID" \
    --project="$PROJECT_ID" \
    --display-name='Phishtopia Ops GitHub controller' \
    --description='Publishes fixed Ops requests and consumes sanitized responses; no service-account key.' \
    --quiet >/dev/null
fi
[ "$(gcloud iam service-accounts describe "$CONTROLLER_SERVICE_ACCOUNT" --project="$PROJECT_ID" --format='value(email)')" = "$CONTROLLER_SERVICE_ACCOUNT" ] || fail 'controller service account verification failed'

ensure_topic() {
  topic=$1
  if ! gcloud pubsub topics describe "$topic" --project="$PROJECT_ID" --format='value(name)' >/dev/null 2>&1; then
    gcloud pubsub topics create "$topic" --project="$PROJECT_ID" --quiet >/dev/null
  fi
  actual=$(gcloud pubsub topics describe "$topic" --project="$PROJECT_ID" --format='value(name)')
  [ "$actual" = "projects/${PROJECT_ID}/topics/${topic}" ] || fail "topic verification failed: $topic"
}

ensure_subscription() {
  subscription=$1
  topic=$2
  if ! gcloud pubsub subscriptions describe "$subscription" --project="$PROJECT_ID" --format='value(name)' >/dev/null 2>&1; then
    gcloud pubsub subscriptions create "$subscription" \
      --project="$PROJECT_ID" \
      --topic="$topic" \
      --ack-deadline=60 \
      --message-retention-duration=1d \
      --expiration-period=never \
      --quiet >/dev/null
  fi
  actual=$(gcloud pubsub subscriptions describe "$subscription" --project="$PROJECT_ID" --format='value(topic)')
  [ "$actual" = "projects/${PROJECT_ID}/topics/${topic}" ] || fail "subscription points to an unexpected topic: $subscription"
}

step 'Create or verify the four fixed Pub/Sub resources'
ensure_topic "$REQUEST_TOPIC"
ensure_topic "$RESPONSE_TOPIC"
ensure_subscription "$REQUEST_SUBSCRIPTION" "$REQUEST_TOPIC"
ensure_subscription "$RESPONSE_SUBSCRIPTION" "$RESPONSE_TOPIC"

step 'Apply resource-level Pub/Sub permissions only'
gcloud pubsub topics add-iam-policy-binding "$REQUEST_TOPIC" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${CONTROLLER_SERVICE_ACCOUNT}" \
  --role='roles/pubsub.publisher' \
  --quiet >/dev/null

gcloud pubsub subscriptions add-iam-policy-binding "$RESPONSE_SUBSCRIPTION" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${CONTROLLER_SERVICE_ACCOUNT}" \
  --role='roles/pubsub.subscriber' \
  --quiet >/dev/null

gcloud pubsub subscriptions add-iam-policy-binding "$REQUEST_SUBSCRIPTION" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${VM_SERVICE_ACCOUNT}" \
  --role='roles/pubsub.subscriber' \
  --quiet >/dev/null

gcloud pubsub topics add-iam-policy-binding "$RESPONSE_TOPIC" \
  --project="$PROJECT_ID" \
  --member="serviceAccount:${VM_SERVICE_ACCOUNT}" \
  --role='roles/pubsub.publisher' \
  --quiet >/dev/null

step 'Create or verify the GitHub Workload Identity pool'
if ! gcloud iam workload-identity-pools describe "$POOL_ID" --location=global --project="$PROJECT_ID" --format='value(name)' >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --display-name='GitHub Phishtopia Ops' \
    --description='Trust boundary for the fixed Phishtopia Ops controller workflow.' \
    --quiet >/dev/null
fi
[ "$(gcloud iam workload-identity-pools describe "$POOL_ID" --location=global --project="$PROJECT_ID" --format='value(name)')" = "$POOL_RESOURCE" ] || fail 'workload identity pool verification failed'

step 'Create or strictly verify the GitHub OIDC provider'
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" --location=global --workload-identity-pool="$POOL_ID" --project="$PROJECT_ID" --format='value(name)' >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
    --project="$PROJECT_ID" \
    --location=global \
    --workload-identity-pool="$POOL_ID" \
    --display-name='Phishtopia Ops workflow' \
    --description='Only the owner-triggered main-branch issue-comment controller workflow.' \
    --issuer-uri='https://token.actions.githubusercontent.com' \
    --attribute-mapping="$ATTRIBUTE_MAPPING" \
    --attribute-condition="$ATTRIBUTE_CONDITION" \
    --quiet >/dev/null
fi

gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project="$PROJECT_ID" \
  --location=global \
  --workload-identity-pool="$POOL_ID" \
  --format=json >"$TMP_DIR/provider.json"

EXPECTED_PROVIDER_RESOURCE=$PROVIDER_RESOURCE EXPECTED_MAPPING=$ATTRIBUTE_MAPPING EXPECTED_CONDITION=$ATTRIBUTE_CONDITION python3 - "$TMP_DIR/provider.json" <<'PY' || fail 'existing OIDC provider does not exactly match the locked policy'
import json
import os
import sys

with open(sys.argv[1], encoding='utf-8') as handle:
    value = json.load(handle)
expected_mapping = {}
for item in os.environ['EXPECTED_MAPPING'].split(','):
    key, expression = item.split('=', 1)
    expected_mapping[key] = expression
checks = (
    value.get('name') == os.environ['EXPECTED_PROVIDER_RESOURCE'],
    value.get('disabled') is not True,
    isinstance(value.get('oidc'), dict),
    value.get('oidc', {}).get('issuerUri') == 'https://token.actions.githubusercontent.com',
    value.get('attributeMapping') == expected_mapping,
    value.get('attributeCondition') == os.environ['EXPECTED_CONDITION'],
)
if not all(checks):
    raise SystemExit(1)
PY

step 'Allow only the locked provider identity to impersonate the controller account'
gcloud iam service-accounts add-iam-policy-binding "$CONTROLLER_SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" \
  --member="$WIF_MEMBER" \
  --role='roles/iam.workloadIdentityUser' \
  --quiet >/dev/null

assert_binding() {
  policy_file=$1
  member=$2
  role=$3
  MEMBER=$member ROLE=$role python3 - "$policy_file" <<'PY'
import json
import os
import sys
with open(sys.argv[1], encoding='utf-8') as handle:
    policy = json.load(handle)
for binding in policy.get('bindings', []):
    if binding.get('role') == os.environ['ROLE'] and os.environ['MEMBER'] in binding.get('members', []):
        raise SystemExit(0)
raise SystemExit(1)
PY
}

step 'Verification pass'
gcloud pubsub topics get-iam-policy "$REQUEST_TOPIC" --project="$PROJECT_ID" --format=json >"$TMP_DIR/request-topic-policy.json"
gcloud pubsub subscriptions get-iam-policy "$RESPONSE_SUBSCRIPTION" --project="$PROJECT_ID" --format=json >"$TMP_DIR/response-sub-policy.json"
gcloud pubsub subscriptions get-iam-policy "$REQUEST_SUBSCRIPTION" --project="$PROJECT_ID" --format=json >"$TMP_DIR/request-sub-policy.json"
gcloud pubsub topics get-iam-policy "$RESPONSE_TOPIC" --project="$PROJECT_ID" --format=json >"$TMP_DIR/response-topic-policy.json"
gcloud iam service-accounts get-iam-policy "$CONTROLLER_SERVICE_ACCOUNT" --project="$PROJECT_ID" --format=json >"$TMP_DIR/controller-sa-policy.json"

assert_binding "$TMP_DIR/request-topic-policy.json" "serviceAccount:${CONTROLLER_SERVICE_ACCOUNT}" 'roles/pubsub.publisher' || fail 'controller publisher binding missing'
assert_binding "$TMP_DIR/response-sub-policy.json" "serviceAccount:${CONTROLLER_SERVICE_ACCOUNT}" 'roles/pubsub.subscriber' || fail 'controller subscriber binding missing'
assert_binding "$TMP_DIR/request-sub-policy.json" "serviceAccount:${VM_SERVICE_ACCOUNT}" 'roles/pubsub.subscriber' || fail 'VM subscriber binding missing'
assert_binding "$TMP_DIR/response-topic-policy.json" "serviceAccount:${VM_SERVICE_ACCOUNT}" 'roles/pubsub.publisher' || fail 'VM publisher binding missing'
assert_binding "$TMP_DIR/controller-sa-policy.json" "$WIF_MEMBER" 'roles/iam.workloadIdentityUser' || fail 'WIF impersonation binding missing'

printf '\nPHISHTOPIA_OPS_BOOTSTRAP=success\n'
printf 'PHISHTOPIA_OPS_QUEUE_ISSUE=%s\n' "$QUEUE_ISSUE"
printf 'PHISHTOPIA_OPS_WIF_PROVIDER=%s\n' "$PROVIDER_RESOURCE"
printf 'PHISHTOPIA_OPS_CONTROLLER_SERVICE_ACCOUNT=%s\n' "$CONTROLLER_SERVICE_ACCOUNT"
printf 'PHISHTOPIA_OPS_VM_SERVICE_ACCOUNT=%s\n' "$VM_SERVICE_ACCOUNT"
printf 'PHISHTOPIA_OPS_PROJECT_NUMBER=%s\n' "$PROJECT_NUMBER"
printf 'ACTIVE_GCLOUD_ACCOUNT=%s\n' "$ACTIVE_ACCOUNT"
printf '\nBootstrap complete. No deployment, VM restart, DNS change, secret access, or production mutation was performed.\n'
