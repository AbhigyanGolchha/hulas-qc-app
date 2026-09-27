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
  {
    // Approval matrix (Sep 2026): nothing about sign-offs / approvals is built
    // into the code any more. Write what the app used to do implicitly into the
    // database once, as ordinary editable data; anything the Admin already set
    // up is left exactly as it is.
    id: '2026-09-approval-matrix-seed',
    describe: 'Approval matrix written into the database (was built into the code)',
    run: async () => {
      const done: string[] = [];
      const slotsRow = await prisma.setting.findUnique({ where: { key: 'signoff.slots' } });
      let slots: Record<string, unknown> = {};
      try { slots = slotsRow ? JSON.parse(slotsRow.value) : {}; } catch { slots = {}; }
      const legacySlots: Record<string, { title: string; role: string }[]> = {
        intake: [{ title: 'Godown Keeper', role: 'GODOWN' }, { title: 'Quality Controller', role: 'QC' }],
        qc: [{ title: 'Checked by', role: 'ANY' }],
        production: [{ title: 'Prepared by', role: 'ANY' }],
      };
      for (const kind of Object.keys(legacySlots)) {
        if (!Array.isArray(slots[kind])) { slots[kind] = legacySlots[kind]; done.push(`${kind} sign-off slots`); }
      }
      await prisma.setting.upsert({ where: { key: 'signoff.slots' }, create: { key: 'signoff.slots', value: JSON.stringify(slots) }, update: { value: JSON.stringify(slots) } });

      const legacyApprover: Record<string, string> = { INTAKE: 'Manager', QC: 'Approved by (GM)', PRODUCTION: 'Approved by' };
      for (const [recordType, title] of Object.entries(legacyApprover)) {
        if (!(await prisma.approvalStage.count({ where: { recordType } }))) {
          await prisma.approvalStage.create({ data: { recordType, order: 1, title, role: 'MANAGER' } });
          done.push(`${recordType.toLowerCase()} approval step "${title}"`);
        }
      }

      const unlockRow = await prisma.setting.findUnique({ where: { key: 'approval.unlock' } });
      if (!unlockRow) {
        await prisma.setting.create({ data: { key: 'approval.unlock', value: JSON.stringify({ intake: ['MANAGER'], qc: ['MANAGER'], production: ['MANAGER'] }) } });
        done.push('unlock roles');
      }
      if (!(await prisma.setting.findUnique({ where: { key: 'approval.adminOverride' } }))) {
        await prisma.setting.create({ data: { key: 'approval.adminOverride', value: 'on' } });
        done.push('admin step-in on');
      }
      return done.length ? done.join(', ') : 'already configured';
    },
  },
  {
    // Roles & permissions (Sep 2026): roles become data. Write the five roles
    // the app shipped with, with exactly the rights they had, so nothing
    // changes until the Admin edits them. Deleting reports is Admin-only.
    id: '2026-09-roles-seed',
    describe: 'Roles & permissions written into the database',
    run: async () => {
      if (await prisma.setting.findUnique({ where: { key: 'roles' } })) return 'already configured';
      const edit = ['intake.edit', 'qc.edit', 'production.edit'];
      const roles = [
        { key: 'ADMIN', label: 'Admin', permissions: [] },
        { key: 'MANAGER', label: 'Manager / GM', permissions: [...edit, 'admin.panel', 'admin.matrix', 'admin.specs', 'admin.master', 'admin.notifications', 'admin.audit', 'admin.sap'] },
        { key: 'QC', label: 'QC Analyst', permissions: edit },
        { key: 'SUPERVISOR', label: 'Production Supervisor', permissions: edit },
        { key: 'GODOWN', label: 'Godown Keeper', permissions: edit },
      ];
      await prisma.setting.create({ data: { key: 'roles', value: JSON.stringify(roles) } });
      return `${roles.length} roles`;
    },
  },
  {
    // Report header (Sep 2026 issue list): "HULAS KHADYA UDHYOG LTD." replaces
    // the old "Pvt. Ltd." name — only if nobody has typed their own since.
    id: '2026-09-company-name',
    describe: 'Report company name → Hulas Khadya Udhyog Ltd.',
    run: async () => {
      const row = await prisma.setting.findUnique({ where: { key: 'company.name' } });
      if (row && row.value !== 'Hulas Khadya Udyog Pvt. Ltd.') return `kept "${row.value}"`;
      await prisma.setting.upsert({ where: { key: 'company.name' }, create: { key: 'company.name', value: 'Hulas Khadya Udhyog Ltd.' }, update: { value: 'Hulas Khadya Udhyog Ltd.' } });
      return 'updated';
    },
  },
  {
    // Sep 2026 issue list: "Need option of Maida Mill". The Roller Flour Mill
    // IS the maida plant (its paper form is the "Maida Plan Daily Report"), so
    // its name now says so; batch code RFM and all history stay as they are.
    id: '2026-09-maida-mill-name',
    describe: 'Roller Flour Mill → "Maida Mill (Roller Flour Mill)"',
    run: async () => {
      const r = await prisma.mill.updateMany({ where: { code: 'RFM', name: 'Roller Flour Mill' }, data: { name: 'Maida Mill (Roller Flour Mill)' } });
      return `${r.count} mill(s) renamed`;
    },
  },
  {
    // Sep 2026 issue list: a choice-list parameter whose "text must match"
    // answer is not in its dropdown can never pass (Wheat "Appearance / Smell"
    // expects "Bright, Clean, Uniform" but offered Grainy/Dull/…). Put the
    // expected answer first in every such list; Texture also gets "Normal".
    id: '2026-09-select-options',
    describe: 'Dropdown choices include the expected answer (+ "Normal" for Texture)',
    run: async () => {
      const params = await prisma.parameter.findMany({
        where: { valueType: 'SELECT' },
        include: { specVersions: { orderBy: { version: 'desc' }, take: 1 } },
      });
      let changed = 0;
      for (const p of params) {
        let options: string[] = [];
        try { options = p.options ? JSON.parse(p.options) : []; } catch { options = []; }
        const has = (v: string) => options.some((o) => o.trim().toLowerCase() === v.trim().toLowerCase());
        const next = [...options];
        const spec = p.specVersions[0];
        if (spec?.operator === 'TEXT_MATCH' && spec.textExpected && !has(spec.textExpected)) next.unshift(spec.textExpected.trim());
        if (p.name.trim().toLowerCase() === 'texture' && !has('Normal')) next.push('Normal');
        if (next.length !== options.length) {
          await prisma.parameter.update({ where: { id: p.id }, data: { options: JSON.stringify(next) } });
          changed++;
        }
      }
      return `${changed} parameter(s) updated`;
    },
  },
  {
    // Sep 2026 issue list: the IR moisture box was still missing on First Break
    // Moisture on the plant server. Retry case-insensitively (the first fix
    // matched the exact name only).
    id: '2026-09-first-break-ir-v2',
    describe: 'First Break Moisture gets the IR moisture column (any spelling)',
    run: async () => {
      const params = await prisma.parameter.findMany({ where: { productId: { not: null }, hasIr: false, valueType: 'NUMBER' } });
      const hits = params.filter((p) => /first\s*break\s*moisture/i.test(p.name));
      for (const p of hits) await prisma.parameter.update({ where: { id: p.id }, data: { hasIr: true } });
      return `${hits.length} parameter(s) updated`;
    },
  },
];

export async function runDataFixes() {
  for (const fix of FIXES) {
    const key = `datafix.${fix.id}`;
    if (await prisma.setting.findUnique({ where: { key } })) continue;
    let result: string;
    try {
      result = await fix.run();
    } catch (e) {
      // one broken fix must not stop the others; it retries next start
      console.error(`[data-fix] ${fix.describe} FAILED:`, e);
      continue;
    }
    await prisma.setting.create({ data: { key, value: `${new Date().toISOString()} — ${result}` } });
    await prisma.auditLog.create({
      data: { userName: 'system', recordType: 'MASTER', recordId: fix.id, action: 'UPDATE', field: 'data-fix', newValue: `${fix.describe}: ${result}` },
    });
    console.log(`[data-fix] ${fix.describe}: ${result}`);
  }
}
