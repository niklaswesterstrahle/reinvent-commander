import { describe, expect, it } from 'vitest';
import type { ApiError } from '@reinvent-commander/shared';
import { ApiClientError } from '../api/client.js';
import { CatalogWalkError } from '../catalog/catalogWalk.js';
import { isReauthSignal, nextAuthState } from './reauth.js';

/** Build an ApiClientError with the same envelope shape api/client.ts uses. */
function apiError(partial: Partial<ApiError>): ApiClientError {
  return new ApiClientError({
    status: 400,
    code: 'ValidationException',
    message: 'boom',
    ...partial,
  });
}

describe('isReauthSignal', () => {
  it('is true for a 401 ApiClientError', () => {
    expect(isReauthSignal(apiError({ status: 401, code: 'Unauthorized' }))).toBe(true);
  });

  it('is true for AuthenticationRequiredException at any status', () => {
    expect(isReauthSignal(apiError({ status: 200, code: 'AuthenticationRequiredException' }))).toBe(
      true,
    );
  });

  it('is true for EventAuthRequiredException', () => {
    expect(isReauthSignal(apiError({ status: 403, code: 'EventAuthRequiredException' }))).toBe(
      true,
    );
  });

  it('is false for 404 / 429 / 500 errors without a re-auth code', () => {
    expect(isReauthSignal(apiError({ status: 404, code: 'NotFound' }))).toBe(false);
    expect(isReauthSignal(apiError({ status: 429, code: 'ThrottlingException' }))).toBe(false);
    expect(isReauthSignal(apiError({ status: 500, code: 'UpstreamError' }))).toBe(false);
  });

  it('is false for a transport NetworkError (status 0)', () => {
    expect(isReauthSignal(apiError({ status: 0, code: 'NetworkError' }))).toBe(false);
  });

  it('is true for a CatalogWalkError wrapping a 401 (the real walk-failure shape)', () => {
    // walkCatalog fails a page by throwing CatalogWalkError with the underlying
    // ApiClientError in .cause; catalogStore.refresh surfaces that as result.error.
    const wrapped = new CatalogWalkError(
      'catalog page request failed after 4 attempts',
      apiError({ status: 401, code: 'Unauthorized' }),
    );
    expect(isReauthSignal(wrapped)).toBe(true);
  });

  it('is true for a CatalogWalkError wrapping AuthenticationRequiredException', () => {
    const wrapped = new CatalogWalkError(
      'catalog page request failed after 4 attempts',
      apiError({ status: 200, code: 'AuthenticationRequiredException' }),
    );
    expect(isReauthSignal(wrapped)).toBe(true);
  });

  it('is false for a CatalogWalkError wrapping a non-reauth error', () => {
    const wrapped = new CatalogWalkError(
      'catalog page request failed after 4 attempts',
      apiError({ status: 500, code: 'UpstreamError' }),
    );
    expect(isReauthSignal(wrapped)).toBe(false);
  });

  it('is false for a plain Error and non-error values', () => {
    expect(isReauthSignal(new Error('nope'))).toBe(false);
    expect(isReauthSignal('401')).toBe(false);
    expect(isReauthSignal(null)).toBe(false);
    expect(isReauthSignal(undefined)).toBe(false);
  });
});

describe('nextAuthState', () => {
  it('a 401 from a catalog walk page or GetSchedule drives the UI signed-out', () => {
    const prev = { signedIn: true };
    expect(nextAuthState(prev, apiError({ status: 401, code: 'Unauthorized' }))).toEqual({
      signedIn: false,
    });
    expect(
      nextAuthState(prev, apiError({ status: 200, code: 'AuthenticationRequiredException' })),
    ).toEqual({ signedIn: false });
  });

  it('leaves the state unchanged for a non-reauth error', () => {
    const prev = { signedIn: true };
    expect(nextAuthState(prev, apiError({ status: 404, code: 'NotFound' }))).toBe(prev);
    expect(nextAuthState(prev, new Error('network'))).toBe(prev);
  });
});
