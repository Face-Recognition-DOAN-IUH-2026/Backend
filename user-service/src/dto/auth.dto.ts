import { UserPublicDto } from './user.dto';

export interface RegisterDto {
  email: string;
  password?: string;
  fullName?: string;
  role?: string;
  studentCode?: string;
  className?: string;
  course?: string;
  permanentAddress?: string;
  membershipExpiry?: string;
  phone?: string;
  skipVerification?: boolean;
  verificationToken?: string;
}

export interface LoginDto {
  email?: string;
  studentCode?: string;
  password: string;
}

export interface RefreshDto {
  refreshToken: string;
}

export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: UserPublicDto;
}

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  fullName?: string | null;
}
