import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, tap } from 'rxjs';

import { environment } from '../../../environments/environment';
import {
  ApiUser,
  AuthResponse,
  AuthUser,
  GoogleLoginRequest,
  LoginRequest,
  SignupRequest
} from '../models/auth.model';
import { SentryService } from './sentry.service';

const TOKEN_KEY = 'time-tracker-token';
const USER_KEY = 'time-tracker-user';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly sentry = inject(SentryService);

  readonly user = signal<AuthUser | null>(this.readStoredUser());

  isAuthenticated(): boolean {
    return !!this.getToken() && this.user() !== null;
  }

  getToken(): string | null {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  login(email: string, password: string): Observable<AuthUser> {
    const body: LoginRequest = { email, password };
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/api/auth/login`, body)
      .pipe(map((response) => this.applyAuthResponse(response)));
  }

  signup(payload: SignupRequest): Observable<AuthUser> {
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/api/auth/signup`, payload)
      .pipe(map((response) => this.applyAuthResponse(response)));
  }

  loginWithGoogle(credential: string): Observable<AuthUser> {
    const body: GoogleLoginRequest = { credential };
    return this.http
      .post<AuthResponse>(`${environment.apiUrl}/api/auth/google`, body)
      .pipe(map((response) => this.applyAuthResponse(response)));
  }

  restoreSession(): Observable<void> {
    const token = this.getToken();
    if (!token) {
      this.sentry.syncUser(null);
      return of(undefined);
    }

    return this.http.get<{ user: ApiUser }>(`${environment.apiUrl}/api/auth/me`).pipe(
      tap(({ user }) => {
        const mapped = this.mapUser(user);
        sessionStorage.setItem(USER_KEY, JSON.stringify(mapped));
        this.user.set(mapped);
        this.sentry.syncUser(mapped);
      }),
      catchError(() => {
        this.clearSession();
        return of(undefined);
      }),
      map(() => undefined)
    );
  }

  logout(): void {
    this.http.post(`${environment.apiUrl}/api/auth/logout`, {}).subscribe({
      complete: () => this.clearSession(),
      error: () => this.clearSession()
    });
  }

  initials(): string {
    const current = this.user();
    if (!current) {
      return '?';
    }

    const parts = current.displayName.trim().split(/\s+/);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    }

    return current.displayName.slice(0, 2).toUpperCase();
  }

  private applyAuthResponse(response: AuthResponse): AuthUser {
    const mapped = this.mapUser(response.user);
    sessionStorage.setItem(TOKEN_KEY, response.token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(mapped));
    this.user.set(mapped);
    this.sentry.syncUser(mapped);
    return mapped;
  }

  private mapUser(apiUser: ApiUser): AuthUser {
    return {
      userId: apiUser.id,
      email: apiUser.email,
      displayName: apiUser.fullName
    };
  }

  private readStoredUser(): AuthUser | null {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      sessionStorage.removeItem(USER_KEY);
      return null;
    }
  }

  private clearSession(): void {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    this.user.set(null);
    this.sentry.syncUser(null);
  }
}
