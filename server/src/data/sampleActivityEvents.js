// Mock mac/ios/domain activity matching API_CONTRACT raw event shape.

function at(date, hour, minute = 0) {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`).toISOString();
}

function durationSec(startIso, endIso) {
  return Math.round((Date.parse(endIso) - Date.parse(startIso)) / 1000);
}

/**
 * @param {string} userId
 * @param {string} date YYYY-MM-DD
 */
export function sampleActivityEvents(userId, date = '2026-06-20') {
  const rows = [
    {
      id: 'mac-vscode-morning',
      type: 'app_focus',
      app: 'Visual Studio Code',
      start: at(date, 9, 0),
      end: at(date, 10, 15),
    },
    {
      id: 'mac-safari-github',
      type: 'domain_visit',
      app: 'Safari',
      domain: 'github.com',
      start: at(date, 10, 15),
      end: at(date, 10, 45),
    },
    {
      id: 'mac-slack',
      type: 'app_focus',
      app: 'Slack',
      start: at(date, 10, 45),
      end: at(date, 11, 30),
    },
    {
      id: 'ios-instagram',
      type: 'app_focus',
      app: 'Instagram',
      start: at(date, 12, 0),
      end: at(date, 12, 25),
    },
    {
      id: 'ios-safari-youtube',
      type: 'domain_visit',
      app: 'Mobile Safari',
      domain: 'youtube.com',
      start: at(date, 12, 25),
      end: at(date, 13, 0),
    },
    {
      id: 'mac-xcode-afternoon',
      type: 'app_focus',
      app: 'Xcode',
      start: at(date, 14, 0),
      end: at(date, 16, 30),
    },
    {
      id: 'manual-gym',
      type: 'manual',
      app: 'Gym',
      start: at(date, 17, 0),
      end: at(date, 18, 0),
    },
    {
      id: 'mac-notion-evening',
      type: 'domain_visit',
      app: 'Chrome',
      domain: 'notion.so',
      title: 'Hackathon notes',
      start: at(date, 20, 0),
      end: at(date, 21, 15),
    },
  ];

  return rows.map(({ start, end, ...rest }) => ({
    ...rest,
    userId,
    timestamp: start,
    durationSec: durationSec(start, end),
  }));
}

export default { sampleActivityEvents };
