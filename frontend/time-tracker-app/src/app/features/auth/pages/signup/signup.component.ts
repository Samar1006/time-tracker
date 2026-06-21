import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

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

    const { confirmPassword: _, email } = this.signupForm.getRawValue();
    this.auth.login(email);
    void this.router.navigate(['/dashboard']);
  }

  onGoogleSignIn(): void {
    this.auth.login('demo@timetracker.app');
    void this.router.navigate(['/dashboard']);
  }

  get passwordsMismatch(): boolean {
    return (
      this.signupForm.hasError('passwordMismatch') &&
      this.signupForm.controls.confirmPassword.touched
    );
  }
}
