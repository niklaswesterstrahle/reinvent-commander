// @reinvent-commander/shared
//
// Shared TypeScript types for re:Invent Commander. Downstream packages import
// the API-derived models, client-derived models, and the Phase 1 local-API
// contracts from here (`@reinvent-commander/shared`).

export const SHARED_PACKAGE = '@reinvent-commander/shared' as const;

export * from './api.js';
export * from './client.js';
export * from './contracts.js';
