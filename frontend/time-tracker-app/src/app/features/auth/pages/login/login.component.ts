import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { AuthFormHeaderComponent } from '../../../../shared/components/auth-form-header/auth-form-header.component';
import { GoogleSignInButtonComponent } from '../../../../shared/components/google-sign-in-button/google-sign-in-button.component';
import { AuthLayoutComponent } from '../../../../shared/layouts/auth-layout/auth-layout.component';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    AuthLayoutComponent,
    AuthFormHeaderComponent,
    GoogleSignInButtonComponent
  ],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);

  readonly loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    // TODO: connect to auth service
    console.log('Login submitted', this.loginForm.getRawValue());
  }

  onGoogleSignIn(): void {
    // TODO: connect to Google OAuth
    console.log('Google sign-in clicked');
  }
}
