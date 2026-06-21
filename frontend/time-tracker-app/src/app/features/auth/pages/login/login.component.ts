import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { AuthService } from '../../../../core/services/auth.service';
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
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly loginForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  onSubmit(): void {
    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    const { email } = this.loginForm.getRawValue();
    this.auth.login(email);
    void this.router.navigate(['/dashboard']);
  }

  onGoogleSignIn(): void {
    this.auth.login('demo@timetracker.app');
    void this.router.navigate(['/dashboard']);
  }
}
