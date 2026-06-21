// Mirrors frontend voice-block.util.ts — one event per block with full span duration.

export function parseClock(label) {
  if (!label) return null;
  const trimmed = String(label).trim();
  const withMinutes = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (withMinutes) {
    return toMinutesSinceMidnight(
      parseInt(withMinutes[1], 10),
      parseInt(withMinutes[2], 10),
      withMinutes[3],
    );
  }
  const withoutMinutes = trimmed.match(/^(\d{1,2})\s*(AM|PM)$/i);
  if (withoutMinutes) {
    return toMinutesSinceMidnight(parseInt(withoutMinutes[1], 10), 0, withoutMinutes[2]);
  }
  return null;
}

function toMinutesSinceMidnight(hour12, minute, period) {
  let h = hour12;
  const p = period.toUpperCase();
  if (p === 'PM' && h < 12) h += 12;
  if (p === 'AM' && h === 12) h = 0;
  return h * 60 + minute;
}

export function localTimestamp(date, minutesSinceMidnight) {
  const [year, month, day] = date.split('-').map(Number);
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  return new Date(year, month - 1, day, hour, minute, 0, 0).toISOString();
}

function totalDurationSec(startDate, endDate, startMin, endMin, durationMin) {
  if (durationMin != null && durationMin > 0) {
    return Math.max(60, Math.round(durationMin * 60));
  }
  if (endMin != null) {
    if (endDate !== startDate) {
      return Math.max(60, ((24 * 60 - startMin) + endMin) * 60);
    }
    return Math.max(60, (endMin - startMin) * 60);
  }
  return 30 * 60;
}

export function blockToEvents(block, fallbackDate) {
  const startMin = parseClock(block.start);
  if (startMin == null) return [];

  const startDate = block.date || fallbackDate;
  const endMin = parseClock(block.end);
  const endDate =
    block.endDate && block.endDate !== startDate ? block.endDate : startDate;

  const durationSec = totalDurationSec(startDate, endDate, startMin, endMin, block.durationMin);

  const metadata = {
    category: block.category,
    sourceClient: 'dashboard-voice',
    localDate: startDate,
  };
  if (endDate !== startDate) {
    metadata.endLocalDate = endDate;
  }

  return [{
    timestamp: localTimestamp(startDate, startMin),
    type: 'voice',
    title: block.activity?.trim() || 'Activity',
    durationSec,
    metadata,
  }];
}

export function scheduleBlocksToEvents(blocks, fallbackDate) {
  return blocks.flatMap((block) => blockToEvents(block, fallbackDate));
}
