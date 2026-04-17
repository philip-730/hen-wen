resource "google_secret_manager_secret" "anthropic_api_key" {
  secret_id = "anthropic-api-key"

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# Placeholder version so Cloud Run can reference the secret during bootstrap.
# Run `just set-secret` after `terraform apply` to add the real key.
resource "google_secret_manager_secret_version" "anthropic_api_key_placeholder" {
  secret      = google_secret_manager_secret.anthropic_api_key.id
  secret_data = "placeholder"

  lifecycle {
    ignore_changes = [secret_data]
  }
}
