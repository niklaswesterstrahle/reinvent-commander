import { describe, expect, it } from 'vitest';
import { SHARED_PACKAGE } from './index.js';

describe('shared package smoke', () => {
  it('exposes its package marker', () => {
    expect(SHARED_PACKAGE).toBe('@reinvent-commander/shared');
  });
});
