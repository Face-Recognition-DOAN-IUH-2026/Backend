from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.schemas import (
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    UserCreate,
    UserPublic,
)
from core.security import create_access_token, create_refresh_token, decode_token
from infra.config import settings
from infra.database import async_session_factory
from infra.user_repository import PostgresUserRepository, pwd_context
from worker.celery_app import celery_app

router = APIRouter(prefix="/auth", tags=["auth"])


async def _get_db() -> AsyncSession:
    async with async_session_factory() as session:
        yield session


@router.post("/register", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
async def register(body: UserCreate, db: AsyncSession = Depends(_get_db)):
    repo = PostgresUserRepository(db)
    existing = await repo.get_user_by_email(body.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Email already registered"
        )
    password_hash = pwd_context.hash(body.password)
    user_id = await repo.create_user(body.email, password_hash, body.role, body.full_name)
    return UserPublic(id=user_id, email=body.email, full_name=body.full_name, role=body.role)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(_get_db)):
    repo = PostgresUserRepository(db)
    user = await repo.get_user_by_email(body.email)
    if not user or not pwd_context.verify(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
        )
    access_token = create_access_token(
        subject=str(user.id),
        secret=settings.jwt_access_secret,
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        expires_minutes=settings.jwt_access_expires_minutes,
        roles=[user.role],
    )
    refresh_token = create_refresh_token(
        subject=str(user.id),
        secret=settings.jwt_refresh_secret,
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        expires_days=settings.jwt_refresh_expires_days,
        roles=[user.role],
    )
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, db: AsyncSession = Depends(_get_db)):
    try:
        payload = decode_token(
            token=body.refresh_token,
            secret=settings.jwt_refresh_secret,
            issuer=settings.jwt_issuer,
            audience=settings.jwt_audience,
            expected_type="refresh",
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token"
        )
    repo = PostgresUserRepository(db)
    user = await repo.get_user_by_id(payload["sub"])
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    access_token = create_access_token(
        subject=str(user.id),
        secret=settings.jwt_access_secret,
        issuer=settings.jwt_issuer,
        audience=settings.jwt_audience,
        expires_minutes=settings.jwt_access_expires_minutes,
        roles=[user.role],
    )
    return TokenResponse(access_token=access_token)


@router.post("/face-login", status_code=status.HTTP_202_ACCEPTED)
async def face_login(
    email: str = Form(...),
    file: UploadFile = File(...),
):
    image_b64 = base64.b64encode(file.file.read()).decode("ascii")
    task = celery_app.send_task("worker.tasks.face_login_task", kwargs={"email": email, "image_b64": image_b64})
    return {"job_id": task.id}
