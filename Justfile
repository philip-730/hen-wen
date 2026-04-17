default:
    @just --list

project      := "banzai-pipeline"
app          := "hen-wen"
region       := "us-east1"
registry     := region + "-docker.pkg.dev/" + project + "/" + app
state_bucket := project + "-" + app + "-tfstate"

# First-time bootstrap: create state bucket, provision infra, set secret, deploy
bootstrap:
    gcloud storage buckets create gs://{{state_bucket}} \
        --project={{project}} \
        --location={{region}} \
        --uniform-bucket-level-access
    cd infra && terraform init -backend-config="bucket={{state_bucket}}"
    cd infra && terraform apply
    just set-secret
    just deploy

# Re-init terraform (fresh clone or new machine)
init:
    cd infra && terraform init -backend-config="bucket={{state_bucket}}"

# Provision / update infrastructure
infra:
    cd infra && terraform apply

# Build and deploy both services
deploy: deploy-backend deploy-frontend

# Backend
build-backend:
    nix build .#backend-image -o result-backend

deploy-backend: build-backend
    ./result-backend | skopeo copy --insecure-policy \
        --dest-creds "oauth2accesstoken:$(gcloud auth print-access-token)" \
        docker-archive:/dev/stdin \
        docker://{{registry}}/backend:latest
    gcloud run services update hen-wen-backend \
        --region={{region}} \
        --image={{registry}}/backend:latest \
        --project={{project}}

# Frontend
build-frontend:
    nix build .#frontend-image -o result-frontend

deploy-frontend: build-frontend
    ./result-frontend | skopeo copy --insecure-policy \
        --dest-creds "oauth2accesstoken:$(gcloud auth print-access-token)" \
        docker-archive:/dev/stdin \
        docker://{{registry}}/frontend:latest
    gcloud run services update hen-wen-frontend \
        --region={{region}} \
        --image={{registry}}/frontend:latest \
        --project={{project}}

# Set the Anthropic API key in Secret Manager (run once after bootstrap)
set-secret:
    grep ANTHROPIC_API_KEY backend/.env | cut -d= -f2 | tr -d '\n' | \
        gcloud secrets versions add anthropic-api-key \
            --data-file=- \
            --project={{project}}

# Tear down all infrastructure then delete the state bucket
destroy:
    cd infra && terraform destroy
    gcloud storage rm -r gs://{{state_bucket}} --project={{project}}

# Print deployed URLs
urls:
    cd infra && terraform output
