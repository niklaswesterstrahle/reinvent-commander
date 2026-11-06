import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// A repo-text guard: no user-facing string in the shell's rendered sources may
// reference a build phase ("phase 1" / "phase 2"). Source-code comments (`//`)
// are allowed to mention phases — they are not shown to the attendee — so lines
// whose first non-space characters are `//` are ignored.

const here = dirname(fileURLToPath(import.meta.url));
const webSrc = resolve(here, '..');

const RENDERED_SOURCES = ['App.tsx', 'components/HelpDialog.tsx', 'components/SchedulePanel.tsx'];

function nonCommentLines(file: string): string[] {
  const text = readFileSync(resolve(webSrc, file), 'utf8');
  return text.split('\n').filter((line) => !line.trimStart().startsWith('//'));
}

describe('user-facing copy', () => {
  it('contains no build-phase references outside source comments', () => {
    const offenders: string[] = [];
    for (const file of RENDERED_SOURCES) {
      for (const line of nonCommentLines(file)) {
        if (/phase ?[12]/i.test(line)) offenders.push(`${file}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
