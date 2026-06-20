import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

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

    // TODO: connect to auth service
    console.log('Signup submitted', payload);
  }

  onGoogleSignIn(): void {
    // TODO: connect to Google OAuth
    console.log('Google sign-up clicked');
  }

  get passwordsMismatch(): boolean {
    return (
      this.signupForm.hasError('passwordMismatch') &&
      this.signupForm.controls.confirmPassword.touched
    );
  }
}
