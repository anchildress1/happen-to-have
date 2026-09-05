#!/usr/bin/env bash
#
# Build, push, and deploy Happen to Have? to Cloud Run.
#
# All identifiers are overridable env vars with sensible defaults, so this script
# never needs editing for a one-off deploy to a different project or service name:
#   PROJECT_ID=my-project SERVICE_NAME=my-service ./deploy.sh
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
SERVICE_NAME="${SERVICE_NAME:-happen-to-have}"
REGION="${REGION:-us-east1}"
REPOSITORY="${REPOSITORY:-$SERVICE_NAME}"
IMAGE_TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"
# Secret Manager secret IDs, never values — no secret appears here or in any log line
# this script produces. Prefixed because this Secret Manager is shared with other
# services, where a bare `session-secret` would collide.
SESSION_SECRET_NAME="${SESSION_SECRET_NAME:-hth-session-secret}"
DATABASE_URL_SECRET_NAME="${DATABASE_URL_SECRET_NAME:-hth-database-url}"
GEMINI_API_KEY_SECRET_NAME="${GEMINI_API_KEY_SECRET_NAME:-hth-gemini-api-key}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "error: gcloud CLI is required." >&2
  exit 1
fi

if [[ -z "${PROJECT_ID}" ]]; then
  echo "error: PROJECT_ID is not set and no default gcloud project is configured." >&2
  echo "       run 'gcloud config set project <id>' or pass PROJECT_ID=<id>." >&2
  exit 1
fi

IMAGE_URI="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPOSITORY}/${SERVICE_NAME}:${IMAGE_TAG}"
SEPARATOR="=================================================="

echo "${SEPARATOR}"
echo "Project:    ${PROJECT_ID}"
echo "Service:    ${SERVICE_NAME}"
echo "Region:     ${REGION}"
echo "Repository: ${REPOSITORY}"
echo "Image:      ${IMAGE_URI}"
echo "${SEPARATOR}"

echo "Enabling required Google Cloud APIs..."
gcloud services enable \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  --project "${PROJECT_ID}" --quiet

if ! gcloud artifacts repositories describe "${REPOSITORY}" \
    --location "${REGION}" --project "${PROJECT_ID}" --quiet >/dev/null 2>&1; then
  echo "Creating Artifact Registry repository ${REPOSITORY}..."
  gcloud artifacts repositories create "${REPOSITORY}" \
    --repository-format docker \
    --location "${REGION}" \
    --project "${PROJECT_ID}" \
    --description "Container images for ${SERVICE_NAME}"
fi

echo "Building and pushing ${IMAGE_URI}..."
gcloud builds submit . \
  --tag "${IMAGE_URI}" \
  --project "${PROJECT_ID}"

# Fail here rather than inside `gcloud run deploy`, which reports a missing secret as a
# generic IAM error naming neither the secret nor the fix.
MISSING=()
for NAME in "${SESSION_SECRET_NAME}" "${DATABASE_URL_SECRET_NAME}"; do
  gcloud secrets describe "${NAME}" --project "${PROJECT_ID}" --quiet >/dev/null 2>&1 \
    || MISSING+=("${NAME}")
done
if (( ${#MISSING[@]} )); then
  echo "error: required secrets not found in project ${PROJECT_ID}:" >&2
  printf '       %s\n' "${MISSING[@]}" >&2
  echo "       create with: printf %s \"\$VALUE\" | gcloud secrets create <name> --data-file=- --project ${PROJECT_ID}" >&2
  exit 1
fi

# Gemini belongs to 002/003 and nothing in this feature reads it. Bind it when it exists
# so those slices need no deploy change, but never block a deploy that does not need it.
SECRETS="SESSION_SECRET=${SESSION_SECRET_NAME}:latest,DATABASE_URL=${DATABASE_URL_SECRET_NAME}:latest"
if gcloud secrets describe "${GEMINI_API_KEY_SECRET_NAME}" --project "${PROJECT_ID}" --quiet >/dev/null 2>&1; then
  SECRETS="${SECRETS},GEMINI_API_KEY=${GEMINI_API_KEY_SECRET_NAME}:latest"
  echo "Binding ${GEMINI_API_KEY_SECRET_NAME}."
else
  echo "Skipping ${GEMINI_API_KEY_SECRET_NAME}: not created yet (only 002/003 need it)."
fi

echo "Deploying ${SERVICE_NAME} to Cloud Run in ${REGION}..."
# Secrets bind straight from Secret Manager, never as literal env vars — a --set-env-vars
# value is visible in the service description and in deploy logs, and DATABASE_URL carries
# a password.
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_URI}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --allow-unauthenticated \
  --set-secrets "${SECRETS}"

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format "value(status.url)")

echo "${SEPARATOR}"
echo "Deployed: ${SERVICE_URL}"
echo "${SEPARATOR}"
