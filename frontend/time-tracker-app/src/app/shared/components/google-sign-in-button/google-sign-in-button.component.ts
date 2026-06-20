import { Component, output } from '@angular/core';

@Component({
  selector: 'app-google-sign-in-button',
  templateUrl: './google-sign-in-button.component.html',
  styleUrl: './google-sign-in-button.component.scss'
})
export class GoogleSignInButtonComponent {
  readonly googleSignIn = output<void>();

  onClick(): void {
    this.googleSignIn.emit();
  }
}
