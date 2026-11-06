import { describe, expect, it } from 'vitest';
import { WEB_PACKAGE, describeWeb } from './packageInfo.js';

describe('web package smoke', () => {
  it('exposes its package marker', () => {
    expect(WEB_PACKAGE).toBe('@reinvent-commander/web');
  });

  it('resolves the shared package import', () => {
    expect(describeWeb()).toContain('@reinvent-commander/shared');
  });
});
