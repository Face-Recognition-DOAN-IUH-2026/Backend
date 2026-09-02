"""Create the Face service patron_faces schema baseline.

Revision ID: 202609020001
Revises:
Create Date: 2026-09-02
"""

from typing import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "202609020001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("patron_faces"):
        op.create_table(
            "patron_faces",
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("patron_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column(
                "angle",
                sa.String(length=20),
                nullable=False,
                server_default=sa.text("'frontal'"),
            ),
            sa.Column("milvus_id", sa.String(length=100), nullable=True),
            sa.Column("image_url", sa.Text(), nullable=True),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_patron_faces_patron_id",
            "patron_faces",
            ["patron_id"],
            unique=False,
        )
        return

    existing_columns = {column["name"] for column in inspector.get_columns("patron_faces")}
    if "angle" not in existing_columns:
        op.add_column(
            "patron_faces",
            sa.Column(
                "angle",
                sa.String(length=20),
                nullable=False,
                server_default=sa.text("'frontal'"),
            ),
        )

    existing_indexes = {index["name"] for index in inspector.get_indexes("patron_faces")}
    if "ix_patron_faces_patron_id" not in existing_indexes:
        op.create_index(
            "ix_patron_faces_patron_id",
            "patron_faces",
            ["patron_id"],
            unique=False,
        )


def downgrade() -> None:
    op.drop_index("ix_patron_faces_patron_id", table_name="patron_faces")
    op.drop_table("patron_faces")
