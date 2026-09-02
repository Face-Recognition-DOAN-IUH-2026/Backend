from __future__ import annotations

import importlib
import importlib.util
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
import yaml
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pydantic import ValidationError

SERVICE_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = SERVICE_ROOT.parent


@pytest.fixture
def diagnostic_app(monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    diagnostics = importlib.import_module("api.routers.diagnostics")
    dependencies = importlib.import_module("api.dependencies")

    async def fake_diagnostics() -> dict:
        return {
            "milvus_count": 1,
            "patron_faces_count": 1,
            "milvus_ids": ["patron-1"],
            "pg_ids": ["patron-1"],
            "missing_in_milvus": [],
            "orphan_in_milvus": [],
        }

    monkeypatch.setattr(
        diagnostics,
        "collect_face_collection_diagnostics",
        fake_diagnostics,
    )
    app = FastAPI()
    app.include_router(diagnostics.router)
    app.state.get_current_user_dependency = dependencies.get_current_user
    return app


@pytest.mark.asyncio
async def test_diagnostic_requires_authentication(diagnostic_app: FastAPI) -> None:
    async with AsyncClient(
        transport=ASGITransport(app=diagnostic_app), base_url="http://test"
    ) as client:
        response = await client.get("/debug/face-collections")

    assert response.status_code == 401
    assert "patron-1" not in response.text


@pytest.mark.asyncio
async def test_diagnostic_rejects_non_admin(diagnostic_app: FastAPI) -> None:
    async def staff_user() -> dict:
        return {"id": "staff-1", "email": "staff@example.com", "role": "staff"}

    diagnostic_app.dependency_overrides[
        diagnostic_app.state.get_current_user_dependency
    ] = staff_user

    async with AsyncClient(
        transport=ASGITransport(app=diagnostic_app), base_url="http://test"
    ) as client:
        response = await client.get("/debug/face-collections")

    assert response.status_code == 403
    assert response.json() == {"detail": "Insufficient permissions"}


@pytest.mark.asyncio
async def test_diagnostic_allows_admin_without_exposing_embeddings(
    diagnostic_app: FastAPI,
) -> None:
    async def admin_user() -> dict:
        return {"id": "admin-1", "email": "admin@example.com", "role": "admin"}

    diagnostic_app.dependency_overrides[
        diagnostic_app.state.get_current_user_dependency
    ] = admin_user

    async with AsyncClient(
        transport=ASGITransport(app=diagnostic_app), base_url="http://test"
    ) as client:
        response = await client.get("/debug/face-collections")

    assert response.status_code == 200
    assert response.json()["milvus_count"] == 1
    assert "embedding" not in response.text.lower()
    assert "secret" not in response.text.lower()


@pytest.mark.asyncio
async def test_diagnostic_compares_only_identifiers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    diagnostics = importlib.import_module("api.routers.diagnostics")
    database = importlib.import_module("infra.database")
    milvus_module = importlib.import_module("infra.milvus_client")

    milvus = MagicMock()
    milvus.collection_name = "face_embeddings"
    milvus.client.query.return_value = [
        {"user_id": "patron-1"},
        {"user_id": "orphan-1"},
    ]
    monkeypatch.setattr(milvus_module, "get_milvus_client", lambda: milvus)

    query_result = MagicMock()
    query_result.scalars.return_value.all.return_value = [
        SimpleNamespace(patron_id="patron-1"),
        SimpleNamespace(patron_id="patron-2"),
    ]
    session = MagicMock()
    session.execute = AsyncMock(return_value=query_result)

    @asynccontextmanager
    async def fake_session_factory():
        yield session

    monkeypatch.setattr(database, "async_session_factory", fake_session_factory)

    result = await diagnostics.collect_face_collection_diagnostics()

    assert result == {
        "milvus_count": 2,
        "patron_faces_count": 2,
        "milvus_ids": ["orphan-1", "patron-1"],
        "pg_ids": ["patron-1", "patron-2"],
        "missing_in_milvus": ["patron-2"],
        "orphan_in_milvus": ["orphan-1"],
    }
    milvus.client.query.assert_called_once_with(
        "face_embeddings",
        filter="",
        output_fields=["user_id"],
        limit=1000,
    )


def test_face_api_startup_contains_no_schema_ddl() -> None:
    app_source = (SERVICE_ROOT / "api" / "app.py").read_text(encoding="utf-8")

    assert "Base.metadata.create_all" not in app_source
    assert "ALTER TABLE" not in app_source


def _valid_settings() -> dict[str, object]:
    return {
        "env": "production",
        "cors_origins": "https://library.example.com",
        "jwt_issuer": "face-recognition",
        "jwt_audience": "face-recognition-users",
        "jwt_access_secret": "access-secret-at-least-32-characters",
        "jwt_refresh_secret": "refresh-secret-at-least-32-characters",
        "service_jwt_secret": "service-secret-at-least-32-characters",
        "redis_url": "redis://:strong-password@redis:6379/0",
        "postgres_url": "postgresql+psycopg://face:strong-password@postgres:5432/facedb",
        "minio_endpoint": "minio:9000",
        "minio_access_key": "face-service",
        "minio_secret_key": "minio-secret-at-least-32-characters",
        "minio_bucket": "face-raw-images",
        "milvus_host": "milvus",
        "data_encryption_key": "encryption-key-at-least-32-characters",
        "celery_broker_url": "amqp://face:strong-password@rabbitmq:5672",
        "rabbitmq_url": "amqp://face:strong-password@rabbitmq:5672",
    }


def test_production_settings_reject_default_credentials() -> None:
    from infra.config import Settings

    unsafe = _valid_settings()
    unsafe["celery_broker_url"] = "amqp://guest:guest@rabbitmq:5672"
    unsafe["rabbitmq_url"] = "amqp://guest:guest@rabbitmq:5672"

    with pytest.raises(ValidationError):
        Settings(_env_file=None, **unsafe)


def test_production_environment_name_is_normalized_before_validation() -> None:
    from infra.config import Settings

    unsafe = _valid_settings()
    unsafe["env"] = " production "
    unsafe["rabbitmq_url"] = "amqp://guest:guest@rabbitmq:5672"

    with pytest.raises(ValidationError):
        Settings(_env_file=None, **unsafe)


def test_production_settings_accept_external_secrets() -> None:
    from infra.config import Settings

    settings = Settings(_env_file=None, **_valid_settings())

    assert settings.env == "production"


@pytest.mark.parametrize(
    ("field", "unsafe_value"),
    [
        ("service_jwt_secret", ""),
        ("cors_origins", "*"),
    ],
)
def test_production_settings_fail_closed(
    field: str,
    unsafe_value: str,
) -> None:
    from infra.config import Settings

    unsafe = _valid_settings()
    unsafe[field] = unsafe_value

    with pytest.raises(ValidationError):
        Settings(_env_file=None, **unsafe)


def test_phase_one_does_not_require_a_new_postgres_role() -> None:
    from infra.config import Settings

    values = _valid_settings()
    values["postgres_url"] = (
        "postgresql+psycopg://postgres:external-strong-password@postgres:5432/facedb"
    )

    settings = Settings(_env_file=None, **values)

    assert settings.postgres_url.startswith("postgresql+psycopg://postgres:")


def test_production_settings_reject_default_minio_identity() -> None:
    from infra.config import Settings

    unsafe = _valid_settings()
    unsafe["minio_access_key"] = "minioadmin"

    with pytest.raises(ValidationError):
        Settings(_env_file=None, **unsafe)


def test_alembic_baseline_and_angle_revision_exist() -> None:
    alembic_ini = SERVICE_ROOT / "alembic.ini"
    revisions = sorted((SERVICE_ROOT / "alembic" / "versions").glob("*.py"))

    assert alembic_ini.is_file()
    assert revisions
    migration_source = "\n".join(path.read_text(encoding="utf-8") for path in revisions)
    assert "patron_faces" in migration_source
    assert "angle" in migration_source


def _load_baseline_revision():
    revision_path = (
        SERVICE_ROOT
        / "alembic"
        / "versions"
        / "202609020001_create_patron_faces.py"
    )
    spec = importlib.util.spec_from_file_location("face_baseline_revision", revision_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_alembic_baseline_adopts_existing_table_without_recreating_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = _load_baseline_revision()
    inspector = MagicMock()
    inspector.has_table.return_value = True
    inspector.get_columns.return_value = [{"name": "id"}, {"name": "patron_id"}]
    inspector.get_indexes.return_value = []
    monkeypatch.setattr(revision.sa, "inspect", lambda _bind: inspector)
    monkeypatch.setattr(revision.op, "get_bind", lambda: object())
    create_table = MagicMock()
    add_column = MagicMock()
    create_index = MagicMock()
    monkeypatch.setattr(revision.op, "create_table", create_table)
    monkeypatch.setattr(revision.op, "add_column", add_column)
    monkeypatch.setattr(revision.op, "create_index", create_index)

    revision.upgrade()

    create_table.assert_not_called()
    add_column.assert_called_once()
    assert add_column.call_args.args[0] == "patron_faces"
    assert add_column.call_args.args[1].name == "angle"
    create_index.assert_called_once_with(
        "ix_patron_faces_patron_id",
        "patron_faces",
        ["patron_id"],
        unique=False,
    )


def test_alembic_baseline_is_noop_when_existing_schema_is_current(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    revision = _load_baseline_revision()
    inspector = MagicMock()
    inspector.has_table.return_value = True
    inspector.get_columns.return_value = [
        {"name": "id"},
        {"name": "patron_id"},
        {"name": "angle"},
    ]
    inspector.get_indexes.return_value = [{"name": "ix_patron_faces_patron_id"}]
    monkeypatch.setattr(revision.sa, "inspect", lambda _bind: inspector)
    monkeypatch.setattr(revision.op, "get_bind", lambda: object())
    create_table = MagicMock()
    add_column = MagicMock()
    create_index = MagicMock()
    monkeypatch.setattr(revision.op, "create_table", create_table)
    monkeypatch.setattr(revision.op, "add_column", add_column)
    monkeypatch.setattr(revision.op, "create_index", create_index)

    revision.upgrade()

    create_table.assert_not_called()
    add_column.assert_not_called()
    create_index.assert_not_called()


def test_kubernetes_migration_job_and_secret_references() -> None:
    manifest_path = BACKEND_ROOT / "k8s" / "face-recognition.yaml"
    documents = list(yaml.safe_load_all(manifest_path.read_text(encoding="utf-8")))
    resources = [document for document in documents if document]

    job = next(item for item in resources if item["kind"] == "Job")
    command = job["spec"]["template"]["spec"]["containers"][0]["command"]
    assert command == ["alembic", "upgrade", "head"]
    assert job["spec"]["backoffLimit"] <= 3

    rendered = manifest_path.read_text(encoding="utf-8")
    assert "secretKeyRef" in rendered
    assert "minioadmin" not in rendered
    assert "guest:guest" not in rendered
    assert "postgres:postgres" not in rendered


def test_kubernetes_workloads_use_external_secret() -> None:
    manifest_path = BACKEND_ROOT / "k8s" / "face-recognition-workloads.yaml"
    documents = [
        document
        for document in yaml.safe_load_all(manifest_path.read_text(encoding="utf-8"))
        if document
    ]

    deployments = [item for item in documents if item["kind"] == "Deployment"]
    assert {item["metadata"]["name"] for item in deployments} == {
        "face-recognition-api",
        "face-recognition-worker",
    }
    for deployment in deployments:
        container = deployment["spec"]["template"]["spec"]["containers"][0]
        assert {source.get("secretRef", {}).get("name") for source in container["envFrom"]} >= {
            "face-recognition-secrets"
        }

    rendered = manifest_path.read_text(encoding="utf-8")
    assert "minioadmin" not in rendered
    assert "guest:guest" not in rendered
    assert "postgres:postgres" not in rendered


def test_kubernetes_secret_example_contains_placeholders_only() -> None:
    manifest_path = BACKEND_ROOT / "k8s" / "face-recognition-secrets.example.yaml"
    secret = yaml.safe_load(manifest_path.read_text(encoding="utf-8"))

    assert secret["kind"] == "Secret"
    assert set(secret["stringData"]) == {
        "POSTGRES_URL",
        "JWT_ACCESS_SECRET",
        "JWT_REFRESH_SECRET",
        "SERVICE_JWT_SECRET",
        "REDIS_URL",
        "MINIO_ACCESS_KEY",
        "MINIO_SECRET_KEY",
        "DATA_ENCRYPTION_KEY",
        "CELERY_BROKER_URL",
        "RABBITMQ_URL",
    }
    assert set(secret["stringData"].values()) == {"REPLACE_OUT_OF_BAND"}


def test_create_app_registers_the_protected_diagnostic_router() -> None:
    from api.app import create_app

    app = create_app()
    operation = app.openapi()["paths"]["/debug/face-collections"]["get"]

    assert operation["security"] == [{"HTTPBearer": []}]


def test_provider_neutral_verification_script_exists() -> None:
    script_path = BACKEND_ROOT / "scripts" / "verify-production-readiness.ps1"
    script = script_path.read_text(encoding="utf-8")

    assert "pytest" in script
    assert "alembic" in script
    assert "--env-file" in script
    assert "kubectl apply --dry-run=client" in script


def test_compose_has_no_literal_infrastructure_credentials() -> None:
    compose = (BACKEND_ROOT / "docker-compose.yml").read_text(encoding="utf-8")

    assert "POSTGRES_PASSWORD: postgres" not in compose
    assert "MINIO_ROOT_USER: minioadmin" not in compose
    assert "MINIO_ROOT_PASSWORD: minioadmin" not in compose


def test_compose_runs_face_migration_before_api_and_worker() -> None:
    compose = yaml.safe_load(
        (BACKEND_ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    )
    services = compose["services"]

    migration = services["face-recognition-migrate"]
    assert migration["command"] == ["alembic", "upgrade", "head"]
    for service_name in ("face-recognition-api", "worker"):
        dependency = services[service_name]["depends_on"]["face-recognition-migrate"]
        assert dependency["condition"] == "service_completed_successfully"
