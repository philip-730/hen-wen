locals {
  registry = "${var.region}-docker.pkg.dev/${var.project_id}/hen-wen"
}

resource "google_cloud_run_v2_service" "backend" {
  name     = "hen-wen-backend"
  location = var.region

  deletion_protection = false

  template {
    service_account = google_service_account.backend.email

    scaling {
      max_instance_count = 1
    }

    containers {
      # Placeholder — replaced on first `just deploy`
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic_api_key.secret_id
            version = "latest"
          }
        }
      }
    }
  }

  # Image is managed by `just deploy`, not Terraform
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_artifact_registry_repository.hen_wen,
    google_secret_manager_secret.anthropic_api_key,
  ]
}

resource "google_cloud_run_v2_service" "frontend" {
  name     = "hen-wen-frontend"
  location = var.region

  deletion_protection = false

  template {
    service_account = google_service_account.frontend.email

    scaling {
      max_instance_count = 1
    }

    containers {
      # Placeholder — replaced on first `just deploy`
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      env {
        name  = "BACKEND_URL"
        value = google_cloud_run_v2_service.backend.uri
      }
    }
  }

  # Image is managed by `just deploy`, not Terraform
  lifecycle {
    ignore_changes = [template[0].containers[0].image]
  }

  depends_on = [
    google_artifact_registry_repository.hen_wen,
    google_cloud_run_v2_service.backend,
  ]
}

# Frontend is public
resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.frontend.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
