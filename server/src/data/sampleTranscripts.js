// Sample transcripts + fake domains for developing/testing the AI pipeline
// without real tracked data. Add more here as you tune the parser.

export const sampleTranscripts = [
  {
    name: 'typical workday',
    text:
      'From 9 to 10:30 I worked on the frontend dashboard. ' +
      'Then I had a standup meeting until 11. ' +
      'After that I spent two hours debugging the API. ' +
      'After lunch around 1pm I answered emails for 30 minutes. ' +
      'At 4 I took a coffee break and browsed youtube.',
  },
  {
    name: 'study evening',
    text:
      'At 7pm I read documentation for an hour. ' +
      'Then I watched a tutorial until 9. ' +
      'After that I played a game for 45 minutes.',
  },
  {
    name: 'sparse / no times',
    text: 'I worked on code, then took a break, then replied to slack.',
  },
];

export const sampleDomains = [
  { domain: 'https://www.github.com/acme/repo', expected: 'work' },
  { domain: 'youtube.com', expected: 'entertainment' },
  { domain: 'mail.google.com', expected: 'communication' },
  { domain: 'docs.github.com', expected: 'work' }, // suffix match
  { domain: 'developer.mozilla.org', expected: 'learning' },
  { domain: 'some-random-blog.example', expected: 'uncategorized' },
];

export default { sampleTranscripts, sampleDomains };
