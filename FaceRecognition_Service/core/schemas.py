from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: str | None = None


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=72)
    role: str = "user"


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    role: str


class EnrollRequest(BaseModel):
    consent_given: bool = True


class VerificationRequest(BaseModel):
    user_id: str
    consent_given: bool = True


class IdentificationRequest(BaseModel):
    consent_given: bool = True


class LivenessCheckRequest(BaseModel):
    consent_given: bool = True


class EnrollmentResult(BaseModel):
    job_id: str


class VerificationResult(BaseModel):
    job_id: str


class IdentificationResult(BaseModel):
    job_id: str


class LivenessResult(BaseModel):
    job_id: str
