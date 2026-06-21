import { Injectable, inject } from '@angular/core';

import { CATEGORY_LABELS, CATEGORY_LEGEND } from '../constants/categories';
import { ActivityCategory } from '../models/timeline.model';
import { AuthService } from './auth.service';

export interface CategoryPreference {
  category: ActivityCategory;
  label: string;
  description: string;
  keywords: string;
}

export interface CategoryContextItem {
  label: string;
  description: string;
}

const STORAGE_PREFIX = 'time-tracker-category-context';

const DEFAULT_DESCRIPTIONS: Record<ActivityCategory, string> = {
  work: 'Coding, development, project work, and professional tasks',
  communication: 'Meetings, email, Slack, calls, and messaging',
  learning: 'Studying, courses, reading documentation, and research',
  entertainment: 'Games, videos, streaming, and leisure browsing',
  break: 'Meals, rest, exercise, and personal breaks',
  uncategorized: 'Activities that do not fit other categories'
};

@Injectable({ providedIn: 'root' })
export class CategoryContextService {
  private readonly auth = inject(AuthService);

  getDefaults(): CategoryPreference[] {
    return CATEGORY_LEGEND.map((category) => ({
      category,
      label: CATEGORY_LABELS[category],
      description: DEFAULT_DESCRIPTIONS[category],
      keywords: ''
    }));
  }

  load(): CategoryPreference[] {
    const userId = this.auth.user()?.userId;
    if (!userId) {
      return this.getDefaults();
    }

    const raw = localStorage.getItem(`${STORAGE_PREFIX}:${userId}`);
    if (!raw) {
      return this.getDefaults();
    }

    try {
      const parsed = JSON.parse(raw) as Partial<CategoryPreference>[];
      if (!Array.isArray(parsed)) {
        return this.getDefaults();
      }

      const byCategory = new Map(parsed.map((item) => [item.category, item]));
      return this.getDefaults().map((defaults) => {
        const saved = byCategory.get(defaults.category);
        if (!saved) {
          return defaults;
        }
        return {
          ...defaults,
          description: saved.description ?? defaults.description,
          keywords: saved.keywords ?? ''
        };
      });
    } catch {
      return this.getDefaults();
    }
  }

  save(preferences: CategoryPreference[]): void {
    const userId = this.auth.user()?.userId;
    if (!userId) {
      return;
    }

    localStorage.setItem(`${STORAGE_PREFIX}:${userId}`, JSON.stringify(preferences));
  }

  toApiContext(): CategoryContextItem[] {
    return this.load()
      .filter((pref) => pref.description.trim())
      .map((pref) => {
        const description = pref.keywords.trim()
          ? `${pref.description.trim()}. Keywords: ${pref.keywords.trim()}`
          : pref.description.trim();
        return { label: pref.label, description };
      });
  }
}
