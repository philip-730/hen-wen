resource "google_artifact_registry_repository" "hen_wen" {
  repository_id = "hen-wen"
  location      = var.region
  format        = "DOCKER"

  depends_on = [google_project_service.apis]
}
