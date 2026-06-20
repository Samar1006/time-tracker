import { Component, input } from '@angular/core';

@Component({
  selector: 'app-auth-form-header',
  templateUrl: './auth-form-header.component.html',
  styleUrl: './auth-form-header.component.scss'
})
export class AuthFormHeaderComponent {
  readonly title = input.required<string>();
  readonly subtitle = input.required<string>();
}
