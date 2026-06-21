import { ActivityCategory } from '../models/timeline.model';

export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  work: '#6366f1',
  communication: '#3b82f6',
  learning: '#22c55e',
  entertainment: '#ec4899',
  break: '#f97316',
  uncategorized: '#9ca3af'
};

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  work: 'Work',
  communication: 'Communication',
  learning: 'Learning',
  entertainment: 'Entertainment',
  break: 'Break',
  uncategorized: 'Uncategorized'
};

export const CATEGORY_LEGEND: ActivityCategory[] = [
  'work',
  'communication',
  'learning',
  'entertainment',
  'break'
];
