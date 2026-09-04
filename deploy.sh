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
# Secret Manager secret ID, not a value — SESSION_SECRET itself never appears here
# or in any log line this script produces.
SESSION_SECRET_NAME="${SESSION_SECRET_NAME:-session-secret}"

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

echo "Deploying ${SERVICE_NAME} to Cloud Run in ${REGION}..."
# FIREBASE_PROJECT_ID is not sensitive; SESSION_SECRET is bound straight from
# Secret Manager and is never passed as a literal env var.
gcloud run deploy "${SERVICE_NAME}" \
  --image "${IMAGE_URI}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --platform managed \
  --port 8080 \
  --allow-unauthenticated \
  --set-env-vars "FIREBASE_PROJECT_ID=${PROJECT_ID}" \
  --set-secrets "SESSION_SECRET=${SESSION_SECRET_NAME}:latest"

SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --format "value(status.url)")

echo "${SEPARATOR}"
echo "Deployed: ${SERVICE_URL}"
echo "${SEPARATOR}"
