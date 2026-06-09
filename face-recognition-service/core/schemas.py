from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

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
    full_name: str | None = None
    role: str = "user"


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: EmailStr
    full_name: str | None = None
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


# ===== Patron Schemas =====

class PatronCreate(BaseModel):
    full_name: str
    student_code: str
    card_number: str
    membership_expiry: date
    identity_number: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    issue_date: Optional[date] = None


class PatronUpdate(BaseModel):
    full_name: Optional[str] = None
    identity_number: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    membership_expiry: Optional[date] = None
    status: Optional[str] = None


class PatronPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    full_name: str
    student_code: str
    identity_number: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    card_number: str
    issue_date: Optional[date] = None
    membership_expiry: date
    status: str
    created_at: datetime
    updated_at: datetime
    has_face: bool = False


class PatronLookupResult(BaseModel):
    exists: bool
    patron: Optional[PatronPublic] = None
    has_face: bool = False
    is_expired: bool = False


# ===== Kiosk Schemas =====

class KioskEnrollRequest(BaseModel):
    image: str
    full_name: str
    student_code: str
    card_number: str
    membership_expiry: date
    identity_number: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    issue_date: Optional[date] = None


class KioskEnterRequest(BaseModel):
    image: str
    student_code: str


class KioskResult(BaseModel):
    success: bool
    message: str
    patron: Optional[PatronPublic] = None
    job_id: Optional[str] = None


# ===== Access Schemas =====

class AccessLogPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    patron_id: Optional[str] = None
    patron_name: Optional[str] = None
    student_code: Optional[str] = None
    access_type: str
    verify_method: str
    confidence: Optional[float] = None
    camera_id: str
    access_time: datetime
    status: str


class AccessLogList(BaseModel):
    items: List[AccessLogPublic]
    total: int


class ActivePatron(BaseModel):
    id: str
    full_name: str
    student_code: str
    entered_at: datetime
    camera_id: str
    image_url: Optional[str] = None
    confidence: Optional[float] = None


class SSEAccessEvent(BaseModel):
    event: str
    data: Dict[str, Any]


class StatsResponse(BaseModel):
    total_patrons: int
    active_patrons: int
    today_entries: int
    today_exits: int


# ===== Camera Schemas =====

class CameraStatusResponse(BaseModel):
    camera_id: str
    url: str
    running: bool
    connected: bool
    frames_processed: int
    last_frame_time: Optional[str] = None
    last_error: Optional[str] = None
    retry_count: int
    next_retry_in: Optional[float] = None
