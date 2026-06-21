import { ActivityCategory } from '../models/timeline.model';

export const CATEGORY_COLORS: Record<ActivityCategory, string> = {
  work: '#4c6ef5',
  communication: '#14b8a6',
  learning: '#10b981',
  entertainment: '#e879f9',
  break: '#f59e0b',
  uncategorized: '#94a3b8'
};

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  work: 'Work',
  communication: 'Communication',
  learning: 'Learning',
  entertainment: 'Entertainment',
  break: 'Break',
  uncategorized: 'Miscellaneous'
};

export const CATEGORY_LEGEND: ActivityCategory[] = [
  'work',
  'communication',
  'learning',
  'entertainment',
  'break',
  'uncategorized'
];
