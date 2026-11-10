/**
 * The design rules (docs/release-pass/SPEC-design.md 5.4) hold in the design,
 * states and common component folders: zero violations of the exported
 * scanner, so a later edit that brings back an off-scale gap, a literal lip or
 * a hand-rolled Modal fails here with the file and the line.
 */

import { DESIGN_RULES, formatDesignReport, scanDesign } from '../../theme/designScan';

const SWEPT = ['src/components/design', 'src/components/states', 'src/components/common'];

describe('design sweep: design, states and common', () => {
  const result = scanDesign(SWEPT);

  it('scans the three folders and nothing else', () => {
    expect(result.files.length).toBeGreaterThan(20);
    expect(result.files).toContain('src/components/design/Tactile.tsx');
    expect(result.files).toContain('src/components/states/FullScreenState.tsx');
    expect(result.files).toContain('src/components/common/TopBarAccount.tsx');
    expect(result.files.every(file => SWEPT.some(dir => file.startsWith(`${dir}/`)))).toBe(true);
  });

  it.each(DESIGN_RULES)('no %s violation', rule => {
    const hits = result.violations.filter(v => v.rule === rule);
    // The message names every file and line, so a failure says what to fix.
    expect(hits.map(v => `${v.file}:${v.line} ${v.text}`)).toEqual([]);
  });

  it('the report says zero', () => {
    expect(formatDesignReport(result)).toContain(`design scan: 0 violations in 0 of ${result.files.length} files`);
  });
});
