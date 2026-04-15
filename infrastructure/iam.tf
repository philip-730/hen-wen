resource "google_service_account" "backend" {
  account_id   = "hen-wen-backend"
  display_name = "Hen Wen Backend"
}

resource "google_service_account" "frontend" {
  account_id   = "hen-wen-frontend"
  display_name = "Hen Wen Frontend"
}

# Backend: BigQuery access
resource "google_project_iam_member" "backend_bq_viewer" {
  project = var.project_id
  role    = "roles/bigquery.dataViewer"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_bq_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# Backend: read the Anthropic key from Secret Manager
resource "google_secret_manager_secret_iam_member" "backend_secret" {
  secret_id = google_secret_manager_secret.anthropic_api_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}

# Frontend: can invoke the private backend
resource "google_cloud_run_v2_service_iam_member" "frontend_invokes_backend" {
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.backend.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.frontend.email}"
}
