// One-time master-data corrections that ship with the code, so a plain
// `git pull && npm run build && npm run start` on the plant server applies
// them — no extra command to remember. Runs at server start (instrumentation).
// Each fix runs once: a Setting row `datafix.<id>` records it, so if an admin
// later changes the same thing in the UI, a restart never overrides them.
import { prisma } from './db';
import { suggestOverall, type EvalStatus } from './spec';

type Fix = { id: string; describe: string; run: () => Promise<string> };

const FIXES: Fix[] = [
  {
    // Plant review 2026-09 #5: the paper Maida report keeps "Aspirator Dust"
    // outside the finished-goods table — it must not inflate Total output (%).
    id: '2026-09-rfm-dust-is-loss',
    describe: 'Roller Flour Mill "Dust" → loss (not counted in output)',
    run: async () => {
      const r = await prisma.product.updateMany({
        where: { name: 'Dust', kind: 'BYPRODUCT', mill: { code: 'RFM' } },
        data: { kind: 'LOSS' },
      });
      return `${r.count} product(s) updated`;
    },
  },
  {
    // Plant review 2026-09 #7: the paper QC sheet records an IR moisture
    // reading for First Break Moisture too, not only Final Moisture Content.
    id: '2026-09-first-break-ir',
    describe: 'First Break Moisture gets the IR moisture column',
    run: async () => {
      const r = await prisma.parameter.updateMany({
        where: { name: 'First Break Moisture', productId: { not: null }, hasIr: false },
        data: { hasIr: true },
      });
      return `${r.count} parameter(s) updated`;
    },
  },
  {
    // Plant review 2026-09 #6: "<118µ = 99.7–100" cannot pass together with
    // ">118µ = 1–4" (if 1 g stays above 118µ, at most 99 g can pass through),
    // and the lab signs sheets with e.g. 98.5 as PASS. The coarse bands carry
    // the pass/fail; <118µ is recorded. Same printed spec text as the paper.
    id: '2026-09-granularity-118-record-only',
    describe: 'Granularity <118µ becomes record-only (no automatic fail)',
    run: async () => {
      const params = await prisma.parameter.findMany({
        where: { name: { startsWith: 'Granularity <118' } },
        include: { specVersions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      let changed = 0, repinned = 0;
      for (const p of params) {
        const cur = p.specVersions[0];
        if (!cur || cur.operator === 'RECORD') continue;
        const next = await prisma.specVersion.create({
          data: {
            parameterId: p.id,
            version: cur.version + 1,
            operator: 'RECORD',
            min: cur.min,
            max: cur.max,
            displayText: cur.displayText,
            sourceTag: cur.sourceTag,
            regulatoryRef: cur.regulatoryRef,
            note: 'Recorded, not auto-failed: it cannot pass together with ">118µ = 1–4", and the lab passes sheets on the coarser bands (plant review Sep 2026).',
            createdBy: 'system (plant review Sep 2026)',
          },
        });
        changed++;
        // reports still being worked on move to the new version; approved ones keep theirs
        const open = await prisma.qcResult.findMany({
          where: { parameterId: p.id, report: { status: { in: ['DRAFT', 'SUBMITTED', 'REJECTED'] } } },
          select: { id: true, reportId: true },
        });
        for (const res of open) {
          await prisma.qcResult.update({ where: { id: res.id }, data: { specVersionId: next.id, evalStatus: null } });
          const report = await prisma.qcReport.findUniqueOrThrow({ where: { id: res.reportId }, include: { results: true } });
          if (!report.overallOverridden) {
            const suggested = suggestOverall(report.results.map((x) => x.evalStatus as EvalStatus));
            await prisma.qcReport.update({ where: { id: report.id }, data: { overallResult: suggested } });
          }
          repinned++;
        }
      }
      return `${changed} spec(s) versioned, ${repinned} open report result(s) re-evaluated`;
    },
  },
];

export async function runDataFixes() {
  for (const fix of FIXES) {
    const key = `datafix.${fix.id}`;
    if (await prisma.setting.findUnique({ where: { key } })) continue;
    const result = await fix.run();
    await prisma.setting.create({ data: { key, value: `${new Date().toISOString()} — ${result}` } });
    await prisma.auditLog.create({
      data: { userName: 'system', recordType: 'MASTER', recordId: fix.id, action: 'UPDATE', field: 'data-fix', newValue: `${fix.describe}: ${result}` },
    });
    console.log(`[data-fix] ${fix.describe}: ${result}`);
  }
}
