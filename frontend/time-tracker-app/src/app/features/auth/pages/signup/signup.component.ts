import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';

import { AuthService } from '../../../../core/services/auth.service';
import { passwordMatchValidator } from '../../validators/password-match.validator';
import { AuthFormHeaderComponent } from '../../../../shared/components/auth-form-header/auth-form-header.component';
import { GoogleSignInButtonComponent } from '../../../../shared/components/google-sign-in-button/google-sign-in-button.component';
import { PasswordFieldComponent } from '../../../../shared/components/password-field/password-field.component';
import { AuthLayoutComponent } from '../../../../shared/layouts/auth-layout/auth-layout.component';

@Component({
  selector: 'app-signup',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AuthLayoutComponent,
    AuthFormHeaderComponent,
    GoogleSignInButtonComponent,
    PasswordFieldComponent
  ],
  templateUrl: './signup.component.html',
  styleUrl: './signup.component.scss'
})
export class SignupComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly signupForm = this.fb.nonNullable.group(
    {
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required]
    },
    { validators: passwordMatchValidator('password', 'confirmPassword') }
  );

  onSubmit(): void {
    if (this.signupForm.invalid) {
      this.signupForm.markAllAsTouched();
      return;
    }

    const { confirmPassword: _, ...payload } = this.signupForm.getRawValue();
    this.loading.set(true);
    this.error.set(null);

    this.auth.signup(payload).subscribe({
      next: () => void this.router.navigate(['/dashboard']),
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractErrorMessage(err));
        this.loading.set(false);
      },
      complete: () => this.loading.set(false)
    });
  }

  onGoogleSignIn(): void {
    this.loading.set(true);
    this.error.set(null);

    this.auth.loginWithDemoAccount().subscribe({
      next: () => void this.router.navigate(['/dashboard']),
      error: (err: HttpErrorResponse) => {
        this.error.set(this.extractErrorMessage(err));
        this.loading.set(false);
      },
      complete: () => this.loading.set(false)
    });
  }

  get passwordsMismatch(): boolean {
    return (
      this.signupForm.hasError('passwordMismatch') &&
      this.signupForm.controls.confirmPassword.touched
    );
  }

  private extractErrorMessage(err: HttpErrorResponse): string {
    if (typeof err.error?.error === 'string') {
      return err.error.error;
    }

    if (err.status === 0) {
      return 'Unable to reach the server. Make sure the backend is running on port 4000.';
    }

    return 'Sign up failed. Please try again.';
  }
}
