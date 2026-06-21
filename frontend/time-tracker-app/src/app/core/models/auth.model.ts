export interface ApiUser {
  id: string;
  email: string;
  fullName: string;
}

export interface AuthResponse {
  token: string;
  user: ApiUser;
}

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

export interface SignupRequest {
  fullName: string;
  email: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface GoogleLoginRequest {
  credential: string;
}
