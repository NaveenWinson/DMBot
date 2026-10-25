// The Catalyst Web SDK is loaded globally in index.html.
export function getAuth() {
  return typeof window !== 'undefined' && window.catalyst ? window.catalyst.auth : null;
}
