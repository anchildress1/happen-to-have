#!/usr/bin/env bash
#
# Build, push, and deploy Happen to Have? to Cloud Run.
#
# Every identifier is an overridable env var, so this never needs editing for a one-off:
#   PROJECT_ID=my-project HTH_SECRET_PREFIX=staging ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
SERVICE_NAME="${SERVICE_NAME:-happen-to-have}"
REGION="${REGION:-us-east1}"
REPOSITORY="${REPOSITORY:-$SERVICE_NAME}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"
# Deploys retained, newest first, counting the one this run creates.
KEEP_DEPLOYS="${KEEP_DEPLOYS:-3}"
# Secret Manager ids, never values. Ids are `<PREFIX>_<ENV VAR>`, matching the convention
# already in this Secret Manager (SAVE_THE_SUN_GEMINI_API_KEY). The prefix is why an
# unprefixed GEMINI_API_KEY belonging to another service cannot be picked up by accident.
HTH_SECRET_PREFIX="${HTH_SECRET_PREFIX:-HTH}"

command -v gcloud >/dev/null 2>&1 || { echo "error: gcloud CLI is required." >&2; exit 1; }

if [[ -z "${PROJECT_ID}" ]]; then
  echo "error: PROJECT_ID is not set and no default gcloud project is configured." >&2
  echo "       run 'gcloud config set project <id>' or pass PROJECT_ID=<id>." >&2
  exit 1
fi

IMAGE_REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}"
IMAGE_URI="${IMAGE_REPO}:${IMAGE_TAG}"

secret_exists() { gcloud secrets describe "$1" --project "${PROJECT_ID}" --quiet >/dev/null 2>&1; }

echo "Deploying ${SERVICE_NAME} to ${PROJECT_ID}/${REGION} as ${IMAGE_TAG}"

# Checked before the build, not after: gcloud run deploy reports a missing secret as a
# generic IAM error naming neither the secret nor the fix, by which point the image is built.
SESSION_SECRET_ID="${HTH_SECRET_PREFIX}_SESSION_SECRET"
DATABASE_URL_ID="${HTH_SECRET_PREFIX}_DATABASE_URL"
GEMINI_API_KEY_ID="${HTH_SECRET_PREFIX}_GEMINI_API_KEY"

for ID in "${SESSION_SECRET_ID}" "${DATABASE_URL_ID}"; do
  secret_exists "${ID}" || {
    echo "error: secret '${ID}' not found in project ${PROJECT_ID}." >&2
    echo "       printf %s \"\$VALUE\" | gcloud secrets create ${ID} --data-file=- --project ${PROJECT_ID}" >&2
    exit 1
  }
done

# Bound straight from Secret Manager, never --set-env-vars: a literal there is visible in
# the service description and in deploy logs, and DATABASE_URL carries a password.
SECRETS="SESSION_SECRET=${SESSION_SECRET_ID}:latest,DATABASE_URL=${DATABASE_URL_ID}:latest"
# Gemini belongs to 002/003. Bind it when it exists so those slices need no deploy change,
# but never block a deploy that does not need it.
if secret_exists "${GEMINI_API_KEY_ID}"; then
  SECRETS="${SECRETS},GEMINI_API_KEY=${GEMINI_API_KEY_ID}:latest"
fi

gcloud services enable artifactregistry.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com --project "${PROJECT_ID}" --quiet

gcloud artifacts repositories describe "${REPOSITORY}" --location "${REGION}" \
  --project "${PROJECT_ID}" --quiet >/dev/null 2>&1 ||
  gcloud artifacts repositories create "${REPOSITORY}" --repository-format docker \
    --location "${REGION}" --project "${PROJECT_ID}" \
    --description "Container images for ${SERVICE_NAME}"

# Retention is Artifact Registry's job, not this script's. A Keep rule outranks a Delete
# rule, so this is "keep the newest ${KEEP_DEPLOYS}, bin the rest", enforced by GCP on its
# own schedule. Re-applied every run because it is idempotent and a repo created before this
# existed would otherwise never get one.
#
# Cloud Run revisions have no equivalent and are deliberately left alone: an idle revision
# serves nothing and bills nothing, so only the images were ever costing anything.
POLICY=$(mktemp)
trap 'rm -f "${POLICY}"' EXIT
cat >"${POLICY}" <<JSON
[
  {"name": "keep-newest", "action": {"type": "Keep"},
   "mostRecentVersions": {"keepCount": ${KEEP_DEPLOYS}}},
  {"name": "delete-rest", "action": {"type": "Delete"},
   "condition": {"tagState": "ANY"}}
]
JSON
gcloud artifacts repositories set-cleanup-policies "${REPOSITORY}" --location "${REGION}" \
  --project "${PROJECT_ID}" --policy "${POLICY}" --quiet >/dev/null

gcloud builds submit . --tag "${IMAGE_URI}" --project "${PROJECT_ID}"

gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_URI}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --allow-unauthenticated \
  --set-secrets "${SECRETS}"

gcloud run services describe "${SERVICE_NAME}" --project "${PROJECT_ID}" \
  --region "${REGION}" --format "value(status.url)" | sed 's/^/Deployed: /'
