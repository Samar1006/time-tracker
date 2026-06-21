import { Injectable, signal } from '@angular/core';

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
}

const SESSION_KEY = 'time-tracker-session';
const DEMO_USER_ID = 'user-demo-1';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<AuthUser | null>(this.readSession());

  isAuthenticated(): boolean {
    return this.user() !== null;
  }

  login(email: string): void {
    const displayName = email.split('@')[0] || 'User';
    const session: AuthUser = {
      userId: DEMO_USER_ID,
      email,
      displayName
    };

    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    this.user.set(session);
  }

  logout(): void {
    sessionStorage.removeItem(SESSION_KEY);
    this.user.set(null);
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

  private readSession(): AuthUser | null {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
  }
}
