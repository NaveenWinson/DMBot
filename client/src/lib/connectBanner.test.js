import { describe, it, expect } from 'vitest';
import { connectBanner } from './connectBanner.js';

describe('connectBanner', () => {
  it('reads success and errors from the query string', () => {
    expect(connectBanner('?connected=1').type).toBe('good');
    expect(connectBanner('?error=That%20login%20link%20expired.')).toEqual({ type: 'bad', text: 'That login link expired.' });
    expect(connectBanner('')).toBeNull();
    expect(connectBanner(undefined)).toBeNull();
  });

  it('caps very long error text', () => {
    expect(connectBanner('?error=' + 'x'.repeat(500)).text.length).toBe(300);
  });
});
