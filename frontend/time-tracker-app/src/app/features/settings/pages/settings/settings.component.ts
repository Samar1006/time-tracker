import { LowerCasePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { AuthService } from '../../../../core/services/auth.service';
import {
  CategoryContextService,
  CategoryPreference
} from '../../../../core/services/category-context.service';
import { SentryService } from '../../../../core/services/sentry.service';
import { CATEGORY_COLORS } from '../../../../core/constants/categories';
import { AppShellComponent } from '../../../../shared/layouts/app-shell/app-shell.component';

@Component({
  selector: 'app-settings',
  imports: [AppShellComponent, FormsModule, LowerCasePipe],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  private readonly auth = inject(AuthService);
  private readonly categoryContext = inject(CategoryContextService);
  private readonly sentry = inject(SentryService);

  readonly userId = this.auth.user;
  readonly categoryColors = CATEGORY_COLORS;
  readonly preferences = signal<CategoryPreference[]>(this.categoryContext.load());
  readonly saved = signal(false);
  readonly testSent = signal(false);
  readonly sending = signal(false);

  save(): void {
    this.categoryContext.save(this.preferences());
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2500);
  }

  reset(): void {
    this.preferences.set(this.categoryContext.getDefaults());
    this.categoryContext.save(this.preferences());
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2500);
  }

  updateDescription(index: number, value: string): void {
    this.preferences.update((prefs) =>
      prefs.map((pref, i) => (i === index ? { ...pref, description: value } : pref))
    );
  }

  updateKeywords(index: number, value: string): void {
    this.preferences.update((prefs) =>
      prefs.map((pref, i) => (i === index ? { ...pref, keywords: value } : pref))
    );
  }

  async sendTestError(): Promise<void> {
    this.sending.set(true);
    try {
      await this.sentry.sendTestError();
      this.testSent.set(true);
    } finally {
      this.sending.set(false);
    }
  }
}
