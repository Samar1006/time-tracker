import { Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

import { AuthService } from '../../../../core/services/auth.service';
import { TimelineService } from '../../../../core/services/timeline.service';
import { TimelineResponse } from '../../../../core/models/timeline.model';
import { CATEGORY_COLORS } from '../../../../core/constants/categories';
import { formatDuration } from '../../../../core/utils/duration.util';
import { toDateInputValue } from '../../utils/dashboard-stats.util';

interface AppUsage {
  name: string;
  category: string;
  friendly: string;
  logo: string | null;
  durationSec: number;
}

// Friendly, relatable category names for the "what are you doing" labels.
const FRIENDLY_CATEGORY: Record<string, string> = {
  work: 'Working',
  communication: 'Communicating',
  learning: 'Studying',
  entertainment: 'Socializing',
  break: 'On a break',
  uncategorized: 'Other'
};

// Map common native app names to a domain so we can show their favicon/logo.
const APP_DOMAINS: Record<string, string> = {
  'visual studio code': 'code.visualstudio.com',
  'vs code': 'code.visualstudio.com',
  xcode: 'developer.apple.com',
  slack: 'slack.com',
  safari: 'apple.com',
  chrome: 'google.com',
  notion: 'notion.so',
  figma: 'figma.com',
  spotify: 'spotify.com',
  zoom: 'zoom.us',
  youtube: 'youtube.com',
  gmail: 'gmail.com'
};

@Component({
  selector: 'app-dashboard-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './dashboard-sidebar.component.html',
  styleUrl: './dashboard-sidebar.component.scss'
})
export class DashboardSidebarComponent {
  private readonly auth = inject(AuthService);
  private readonly timelineService = inject(TimelineService);

  readonly apps = signal<AppUsage[]>([]);

  constructor() {
    const user = this.auth.user();
    if (!user) {
      return;
    }
    this.timelineService.getTimeline(user.userId, toDateInputValue(new Date())).subscribe({
      next: (timeline) => this.apps.set(this.extractApps(timeline)),
      error: () => this.apps.set([])
    });
  }

  private extractApps(timeline: TimelineResponse | null): AppUsage[] {
    const byName = new Map<string, AppUsage>();
    for (const hour of timeline?.hours ?? []) {
      for (const block of hour.blocks ?? []) {
        const existing = byName.get(block.activity);
        if (existing) {
          existing.durationSec += block.durationSec;
        } else {
          byName.set(block.activity, {
            name: block.activity,
            category: block.category,
            friendly: FRIENDLY_CATEGORY[block.category] ?? 'Other',
            logo: this.logoFor(block.activity),
            durationSec: block.durationSec
          });
        }
      }
    }
    return [...byName.values()].sort((a, b) => b.durationSec - a.durationSec).slice(0, 8);
  }

  /** Resolve a favicon/logo URL for an app or website name, or null. */
  private logoFor(name: string): string | null {
    const domainMatch = name.match(/[a-z0-9-]+(?:\.[a-z0-9-]+)+\.[a-z]{2,}|[a-z0-9-]+\.[a-z]{2,}/i);
    let domain = domainMatch ? domainMatch[0] : null;
    if (!domain) {
      const lower = name.toLowerCase();
      for (const [key, mapped] of Object.entries(APP_DOMAINS)) {
        if (lower.includes(key)) {
          domain = mapped;
          break;
        }
      }
    }
    return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
  }

  color(category: string): string {
    return CATEGORY_COLORS[category as keyof typeof CATEGORY_COLORS] ?? CATEGORY_COLORS.uncategorized;
  }

  duration(seconds: number): string {
    return formatDuration(seconds);
  }
}
