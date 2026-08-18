"""initial schema: users, stores, products, transactions, files

Revision ID: 0001_initial
Revises:
Create Date: 2026-02-18

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_owner_id", "users", ["owner_id"], unique=False)

    op.create_table(
        "stores",
        sa.Column("owner_id", sa.String(), primary_key=True),
        sa.Column("shop_name", sa.String(), nullable=True, server_default=""),
        sa.Column("address", sa.String(), nullable=True, server_default=""),
        sa.Column("owner_wa", sa.String(), nullable=True, server_default=""),
        sa.Column("qris_image_path", sa.String(), nullable=True),
        sa.Column("receipt_footer", sa.String(), nullable=True, server_default="Terima kasih!"),
        sa.Column("onboarded", sa.Boolean(), nullable=True, server_default=sa.false()),
    )

    op.create_table(
        "products",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("price", sa.Float(), nullable=True, server_default="0"),
        sa.Column("hpp", sa.Float(), nullable=True, server_default="0"),
        sa.Column("stock", sa.Float(), nullable=True, server_default="0"),
        sa.Column("unit", sa.String(), nullable=True, server_default="pcs"),
        sa.Column("low_stock_threshold", sa.Float(), nullable=True, server_default="5"),
        sa.Column("category", sa.String(), nullable=True, server_default="Umum"),
        sa.Column("image_path", sa.String(), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_products_owner_id", "products", ["owner_id"], unique=False)
    op.create_index("ix_products_is_deleted", "products", ["is_deleted"], unique=False)

    op.create_table(
        "transactions",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("cashier_id", sa.String(), nullable=False),
        sa.Column("cashier_name", sa.String(), nullable=False),
        sa.Column("items", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("total", sa.Float(), nullable=True, server_default="0"),
        sa.Column("payment_method", sa.String(), nullable=True),
        sa.Column("cash_received", sa.Float(), nullable=True),
        sa.Column("change", sa.Float(), nullable=True),
        sa.Column("profit", sa.Float(), nullable=True, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_transactions_owner_id", "transactions", ["owner_id"], unique=False)
    op.create_index("ix_transactions_created_at", "transactions", ["created_at"], unique=False)

    op.create_table(
        "files",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("owner_id", sa.String(), nullable=False),
        sa.Column("storage_path", sa.String(), nullable=False),
        sa.Column("original_filename", sa.String(), nullable=True),
        sa.Column("content_type", sa.String(), nullable=True),
        sa.Column("size", sa.Float(), nullable=True, server_default="0"),
        sa.Column("is_deleted", sa.Boolean(), nullable=True, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_files_owner_id", "files", ["owner_id"], unique=False)
    op.create_index("ix_files_storage_path", "files", ["storage_path"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_files_storage_path", table_name="files")
    op.drop_index("ix_files_owner_id", table_name="files")
    op.drop_table("files")

    op.drop_index("ix_transactions_created_at", table_name="transactions")
    op.drop_index("ix_transactions_owner_id", table_name="transactions")
    op.drop_table("transactions")

    op.drop_index("ix_products_is_deleted", table_name="products")
    op.drop_index("ix_products_owner_id", table_name="products")
    op.drop_table("products")

    op.drop_table("stores")

    op.drop_index("ix_users_owner_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
