import { expect, test } from '@playwright/test';

// Placeholder e2e smoke test. Full keyboard-navigation and schedule-action
// flows against mocked Event Catalog and OAuth endpoints land in later tasks.
// This asserts the harness itself is wired up and does not require a server.
test('playwright harness is configured', () => {
  expect(1 + 1).toBe(2);
});
