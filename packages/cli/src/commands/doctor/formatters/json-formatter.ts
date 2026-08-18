import { DoctorReport } from '../types';

/**
 * Outputs the doctor report as structured JSON to stdout.
 * Suitable for CI pipelines, agent workflows, and machine consumption.
 * Internal fields like monorepoRoot are stripped from the output.
 */
export function formatJsonReport(report: DoctorReport): void {
    const sanitized = {
        ...report,
        checks: report.checks.map(({ monorepoRoot, ...check }) => check),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(sanitized, null, 2));
}
