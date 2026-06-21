import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild, output } from '@angular/core';

import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-google-sign-in-button',
  templateUrl: './google-sign-in-button.component.html',
  styleUrl: './google-sign-in-button.component.scss'
})
export class GoogleSignInButtonComponent implements AfterViewInit, OnDestroy {
  @ViewChild('googleButton')
  private readonly googleButton?: ElementRef<HTMLDivElement>;

  readonly googleSignIn = output<string>();

  readonly isConfigured = Boolean(environment.googleClientId);
  private hasRendered = false;
  private retryHandle: number | undefined;

  ngAfterViewInit(): void {
    if (!this.isConfigured) return;

    this.tryRenderButton();
    this.retryHandle = window.setInterval(() => this.tryRenderButton(), 100);
  }

  ngOnDestroy(): void {
    if (this.retryHandle) {
      window.clearInterval(this.retryHandle);
    }
  }

  private tryRenderButton(): void {
    if (this.hasRendered) return;
    if (!this.googleButton) return;

    const google = (window as any).google;
    if (!google?.accounts?.id) return;

    this.hasRendered = true;
    if (this.retryHandle) {
      window.clearInterval(this.retryHandle);
    }

    google.accounts.id.initialize({
      client_id: environment.googleClientId,
      callback: (response: { credential?: string }) => {
        if (response.credential) {
          this.googleSignIn.emit(response.credential);
        }
      }
    });

    google.accounts.id.renderButton(this.googleButton.nativeElement, {
      theme: 'outline',
      size: 'large',
      shape: 'rectangular',
      text: 'continue_with',
      width: this.googleButton.nativeElement.offsetWidth || 360
    });
  }
}
