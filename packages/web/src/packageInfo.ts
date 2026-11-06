import { SHARED_PACKAGE } from '@reinvent-commander/shared';

export const WEB_PACKAGE = '@reinvent-commander/web' as const;

export function describeWeb(): string {
  return `${WEB_PACKAGE} built on ${SHARED_PACKAGE}`;
}
