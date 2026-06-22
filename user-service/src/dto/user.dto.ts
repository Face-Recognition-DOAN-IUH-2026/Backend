export interface UserPublicDto {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  studentCode?: string | null;
  className?: string | null;
  course?: string | null;
  permanentAddress?: string | null;
  identityNumber?: string | null;
  phone?: string | null;
  cardNumber?: string | null;
  issueDate?: string | null;
  membershipExpiry?: string | null;
  status?: string;
  currentStatus?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  avatarUrl?: string | null;
}

export interface CreateUserDto {
  email: string;
  password: string;
  fullName?: string;
  role?: string;
}

export interface UpdateUserDto {
  fullName?: string;
  role?: string;
}
