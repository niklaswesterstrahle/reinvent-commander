import { describe, expect, it } from 'vitest';
import { BACKEND_PACKAGE, BACKEND_PORT_RANGE, describeBackend } from './index.js';

describe('backend package smoke', () => {
  it('exposes its package marker', () => {
    expect(BACKEND_PACKAGE).toBe('@reinvent-commander/backend');
  });

  it('reserves the six loopback OAuth ports', () => {
    expect(BACKEND_PORT_RANGE).toEqual([8484, 8485, 8486, 8487, 8488, 8489]);
  });

  it('resolves the shared package import', () => {
    expect(describeBackend()).toContain('@reinvent-commander/shared');
  });
});
