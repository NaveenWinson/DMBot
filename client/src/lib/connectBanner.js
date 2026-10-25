// Reads the result Instagram login leaves on the Settings URL: #/settings?connected=1 or ?error=...
export function connectBanner(search) {
  const q = new URLSearchParams(search || '');
  if (q.get('connected') === '1') return { type: 'good', text: 'Instagram connected. Comment notifications are switched on.' };
  const error = q.get('error');
  if (error) return { type: 'bad', text: error.slice(0, 300) };
  return null;
}
