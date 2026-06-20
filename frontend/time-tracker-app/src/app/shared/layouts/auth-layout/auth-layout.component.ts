import { Component, input } from '@angular/core';

@Component({
  selector: 'app-auth-layout',
  templateUrl: './auth-layout.component.html',
  styleUrl: './auth-layout.component.scss'
})
export class AuthLayoutComponent {
  readonly headline = input.required<string>();
  readonly highlight = input.required<string>();
  readonly subtext = input.required<string>();
  readonly illustrationSrc = input.required<string>();
  readonly illustrationAlt = input.required<string>();
}
