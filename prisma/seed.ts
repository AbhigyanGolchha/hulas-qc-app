/* eslint-disable no-console */
// Seed: all master data (mills, materials, products, parameters, versioned
// specs, users, suppliers, pack sizes) + demo batch RFM-193 populated from the
// real scanned forms, and one small demo batch per other mill.
import { PrismaClient } from '@prisma/client';
import { scryptSync, randomBytes } from 'crypto';
import NepaliDate from 'nepali-date-converter';

const prisma = new PrismaClient();

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

function adToBs(adIso: string): string {
  const [y, m, d] = adIso.split('-').map(Number);
  const nd = new NepaliDate(new Date(y, m - 1, d));
  return `${nd.getYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}-${String(nd.getDate()).padStart(2, '0')}`;
}

type SpecDef = {
  name: string;
  unit?: string;
  valueType?: 'NUMBER' | 'TEXT' | 'SELECT';
  options?: string[];
  sampleCount?: number;
  hasIr?: boolean;
  op: string; // operator
  min?: number;
  max?: number;
  textExpected?: string;
  display: string;
  tag?: 'INTERNAL' | 'REFERENCE';
  regRef?: string;
  note?: string;
};

async function createParams(target: { materialId?: string; productId?: string }, defs: SpecDef[]) {
  const ids: Record<string, string> = {};
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    const p = await prisma.parameter.create({
      data: {
        ...target,
        name: d.name,
        unit: d.unit ?? null,
        valueType: d.valueType ?? 'NUMBER',
        options: d.options ? JSON.stringify(d.options) : null,
        sampleCount: d.sampleCount ?? 1,
        hasIr: d.hasIr ?? false,
        sortOrder: i + 1,
      },
    });
    await prisma.specVersion.create({
      data: {
        parameterId: p.id,
        version: 1,
        operator: d.op,
        min: d.min ?? null,
        max: d.max ?? null,
        textExpected: d.textExpected ?? null,
        displayText: d.display,
        sourceTag: d.tag ?? 'INTERNAL',
        regulatoryRef: d.regRef ?? null,
        note: d.note ?? null,
        createdBy: 'seed',
      },
    });
    ids[d.name] = p.id;
  }
  return ids;
}

async function main() {
  console.log('Seeding Hulas Khadya QC…');

  // ---------- Settings ----------
  const settings: Record<string, string> = {
    'company.name': 'Hulas Khadya Udyog Pvt. Ltd.',
    'company.location': 'Nepalgunj, Nepal',
    'numbering.INTAKE': 'SA-{BSYEAR}-{SEQ4}',
    'numbering.QC': 'QC-{BSYEAR}-{SEQ4}',
    'numbering.PRODUCTION': 'DP-{BSYEAR}-{SEQ4}',
    'numbering.BATCH': '{MILL}-{SEQ}',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  }

  // ---------- Mills ----------
  const rfm = await prisma.mill.create({
    data: {
      code: 'RFM', name: 'Roller Flour Mill', sortOrder: 1, batchSeq: 193,
      totalRecoveryMin: 98, totalRecoveryMax: 103, mainYieldMin: 50, mainYieldMax: 75,
    },
  });
  const cam = await prisma.mill.create({
    data: {
      code: 'CAM', name: 'Chakki Atta Mill', sortOrder: 2, batchSeq: 87,
      totalRecoveryMin: 97, totalRecoveryMax: 101, mainYieldMin: 90, mainYieldMax: 100,
    },
  });
  const chm = await prisma.mill.create({
    data: {
      code: 'CHM', name: 'Chiura Mill', sortOrder: 3, batchSeq: 41,
      totalRecoveryMin: 95, totalRecoveryMax: 100, mainYieldMin: 60, mainYieldMax: 70,
      processFields: JSON.stringify(['soakTimeHrs', 'roastTempC', 'saltNotes']),
    },
  });
  const bjm = await prisma.mill.create({
    data: {
      code: 'BJM', name: 'Bhuja Mill', sortOrder: 4, batchSeq: 28,
      totalRecoveryMin: 90, totalRecoveryMax: 100, mainYieldMin: 80, mainYieldMax: 95,
      processFields: JSON.stringify(['soakTimeHrs', 'roastTempC', 'saltNotes']),
    },
  });

  // ---------- Pack sizes ----------
  const packDefs: Array<[string, number]> = [
    ['400 g', 400], ['1 kg', 1000], ['2 kg', 2000], ['5 kg', 5000],
    ['10 kg', 10000], ['20 kg bora', 20000], ['50 kg bora', 50000],
  ];
  const packs: Record<string, string> = {};
  for (let i = 0; i < packDefs.length; i++) {
    const p = await prisma.packSize.create({ data: { label: packDefs[i][0], grams: packDefs[i][1], sortOrder: i + 1 } });
    packs[packDefs[i][0]] = p.id;
  }

  // ---------- Suppliers ----------
  for (const name of ['Baba Galla Bhandar', 'Saraswati Khadya Traders', 'Kalika Food Trades', 'Kitija Trading']) {
    await prisma.supplier.create({ data: { name } });
  }
  const babaGalla = await prisma.supplier.findUniqueOrThrow({ where: { name: 'Baba Galla Bhandar' } });

  // ---------- Materials + spot analysis templates ----------
  const wheat = await prisma.material.create({ data: { name: 'Wheat', sortOrder: 1 } });
  const paddy = await prisma.material.create({ data: { name: 'Paddy', sortOrder: 2 } });
  const rice = await prisma.material.create({ data: { name: 'Rice', sortOrder: 3 } });

  // 1A. Wheat ⚙ — seeded exactly from the existing paper form
  const wheatParams = await createParams({ materialId: wheat.id }, [
    { name: 'Texture', valueType: 'SELECT', options: ['Hard', 'Medium', 'Soft'], op: 'TEXT_MATCH', textExpected: 'Hard', display: 'Hard' },
    { name: 'Appearance / Smell', valueType: 'SELECT', options: ['Grainy', 'Dull', 'Off-odour', 'Musty'], op: 'TEXT_MATCH', textExpected: 'Grainy', display: 'Grainy' },
    { name: 'Moisture Content', unit: '%', op: 'LTE', max: 15.0, display: '≤ 15.0%' },
    { name: 'Size — 1000 kernels weight (HI)', unit: 'gm', op: 'RANGE', min: 40, max: 65, display: '40–65 gm' },
    { name: 'Dust & others', unit: '%', op: 'LT', max: 1.0, display: '< 1.0%' },
    { name: 'Immature Grains', unit: '%', op: 'LT', max: 1.0, display: '< 1.0%' },
    { name: 'Wevilled Grains', unit: '%', op: 'NIL', display: '< 0.0% (nil)' },
    { name: 'Akara', unit: '%', op: 'LT', max: 1.0, display: '< 1.0%' },
    { name: 'Damage Grains', unit: '%', op: 'NIL', display: '< 0.0% (nil)' },
    { name: 'Other Food Grains', unit: '%', op: 'LT', max: 1.0, display: '< 1.0%' },
    { name: 'Broken Grains', unit: '%', op: 'LT', max: 1.0, display: '< 1.0%' },
    { name: 'Bulk Density', unit: 'kg/m³', op: 'RANGE', min: 700, max: 770, display: '700–770 kg/m³' },
    { name: 'Foreign Matter (Stem/stones)', unit: '%', op: 'LT', max: 1.0, display: '< 1.0%' },
    { name: 'Falling Number', unit: 's', op: 'RANGE', min: 250, max: 400, display: '250–400 s' },
    { name: 'Protein Content', unit: '%', op: 'RANGE', min: 9, max: 14, display: '9–14%' },
    { name: 'Test Weight', unit: 'kg/hl', op: 'RANGE', min: 74, max: 78, display: '74–78 kg/hl' },
    { name: 'Ash Content', unit: '%', op: 'RANGE', min: 1.5, max: 2.0, display: '1.5–2.0%' },
    { name: 'Gluten Content', unit: '%', op: 'RANGE', min: 8, max: 14, display: '8–14%' },
    { name: 'Mycotoxin — Aflatoxin', unit: 'ppb', op: 'LT', max: 20, display: 'Aflatoxin < 20 ppb' },
    { name: 'Mycotoxin — DON', unit: 'ppb', op: 'LT', max: 1000, display: 'DON < 1000 ppb' },
  ]);

  // 1B. Paddy 📖 — FCI/GoI uniform paddy specs + chiura practice
  const REF = 'REFERENCE' as const;
  await createParams({ materialId: paddy.id }, [
    { name: 'Variety / class', valueType: 'TEXT', op: 'RECORD', display: 'as declared (chiura-suitable variety)', tag: REF },
    { name: 'Appearance / Smell', valueType: 'SELECT', options: ['Normal', 'Off-odour', 'Musty'], op: 'TEXT_MATCH', textExpected: 'Normal', display: 'normal, no off-odour/must', tag: REF },
    { name: 'Moisture Content', unit: '%', op: 'LTE', max: 14.0, display: '≤ 14.0% for storage (abs. max 17.0%)', tag: REF, note: 'Absolute max 17.0% — accept 14–17% only with drying plan.' },
    { name: 'Foreign Matter — Inorganic', unit: '%', op: 'LTE', max: 1.0, display: '≤ 1.0%', tag: REF },
    { name: 'Foreign Matter — Organic', unit: '%', op: 'LTE', max: 1.0, display: '≤ 1.0%', tag: REF },
    { name: 'Damaged, discoloured, sprouted & weevilled grains', unit: '%', op: 'LTE', max: 5.0, display: '≤ 5.0% (damaged+sprouted+weevilled ≤ 4.0%)', tag: REF, regRef: 'FCI uniform specs' },
    { name: 'Immature, shrunken & shrivelled grains', unit: '%', op: 'LTE', max: 3.0, display: '≤ 3.0%', tag: REF, regRef: 'FCI uniform specs' },
    { name: 'Admixture of lower class / other varieties', unit: '%', op: 'LTE', max: 6.0, display: '≤ 6.0%', tag: REF, regRef: 'FCI uniform specs' },
    { name: '1000 grain weight', unit: 'gm', op: 'RECORD', display: 'per variety norm (record)', tag: REF },
    { name: 'Bulk density', unit: 'kg/m³', op: 'RECORD', display: 'record (typ. 550–600 kg/m³)', tag: REF },
    { name: 'Husk content / hulling out-turn (lab test)', unit: '%', op: 'RECORD', display: 'record % (typ. husk ~20–22%)', tag: REF },
    { name: 'Chalky grains', unit: '%', op: 'LTE', max: 5.0, display: '≤ 5.0%', tag: REF },
    { name: 'Mycotoxin — Aflatoxin', unit: 'ppb', op: 'LT', max: 20, display: 'Aflatoxin < 20 ppb', tag: REF },
  ]);

  // 1C. Rice 📖 — FSSAI milled/parboiled rice + puffing practice
  await createParams({ materialId: rice.id }, [
    { name: 'Rice type', valueType: 'SELECT', options: ['Parboiled milled rice (puffing grade)', 'Raw milled rice'], op: 'TEXT_MATCH', textExpected: 'Parboiled milled rice (puffing grade)', display: 'Parboiled milled rice (puffing grade)', tag: REF },
    { name: 'Appearance / Smell', valueType: 'SELECT', options: ['Normal', 'Rancid', 'Off-odour'], op: 'TEXT_MATCH', textExpected: 'Normal', display: 'normal, no rancid/off-odour', tag: REF },
    { name: 'Moisture Content', unit: '%', op: 'LTE', max: 14.0, display: '≤ 14.0%', tag: REF, regRef: 'FSSAI milled rice' },
    { name: 'Broken grains', unit: '%', op: 'LTE', max: 5.0, display: '≤ 5.0% (whole kernels puff best)', tag: REF },
    { name: 'Foreign Matter — organic', unit: '%', op: 'LTE', max: 0.5, display: '≤ 0.5%', tag: REF, regRef: 'FSSAI' },
    { name: 'Foreign Matter — inorganic', unit: '%', op: 'LTE', max: 0.2, display: '≤ 0.2%', tag: REF, regRef: 'FSSAI' },
    { name: 'Damaged / heat-damaged kernels', unit: '%', op: 'LTE', max: 4.0, display: '≤ 4.0%', tag: REF },
    { name: 'Discoloured kernels', unit: '%', op: 'LTE', max: 5.0, display: '≤ 5.0%', tag: REF },
    { name: 'Chalky kernels', unit: '%', op: 'LTE', max: 5.0, display: '≤ 5.0%', tag: REF },
    { name: 'Weevilled kernels', unit: '% count', op: 'LTE', max: 5, display: '≤ 5 by count % — target nil', tag: REF },
    { name: 'Immature kernels', unit: '%', op: 'LTE', max: 0.5, display: '≤ 0.5%', tag: REF },
    { name: 'Degree of milling / polish', valueType: 'SELECT', options: ['Uniform, bran fully removed', 'Uneven', 'Under-milled'], op: 'TEXT_MATCH', textExpected: 'Uniform, bran fully removed', display: 'uniform, bran fully removed (record)', tag: REF },
    { name: 'Uric acid', unit: 'mg/kg', op: 'LTE', max: 100, display: '≤ 100 mg/kg', tag: REF, regRef: 'FSSAI' },
    { name: 'Lab puff test — expansion ratio', unit: '× vol', op: 'GTE', min: 6, display: '≥ 6× volume (record actual)', tag: REF },
    { name: 'Mycotoxin — Aflatoxin', unit: 'ppb', op: 'LT', max: 20, display: 'Aflatoxin < 20 ppb', tag: REF },
  ]);

  // ---------- Products + finished product QC templates ----------
  async function product(millId: string, name: string, opts: Partial<{ kind: string; shelfLifeDays: number; hasQcSheet: boolean; hasFortification: boolean; sortOrder: number }> = {}) {
    return prisma.product.create({
      data: {
        millId, name,
        kind: opts.kind ?? 'PRODUCT',
        shelfLifeDays: opts.shelfLifeDays ?? null,
        hasQcSheet: opts.hasQcSheet ?? false,
        hasFortification: opts.hasFortification ?? false,
        sortOrder: opts.sortOrder ?? 0,
      },
    });
  }

  // Roller Flour Mill
  const maida = await product(rfm.id, 'Maida', { shelfLifeDays: 720, hasQcSheet: true, sortOrder: 1 });
  const millAtta = await product(rfm.id, 'Mill Atta', { shelfLifeDays: 90, hasQcSheet: true, hasFortification: true, sortOrder: 2 });
  const suji = await product(rfm.id, 'Suji', { shelfLifeDays: 90, hasQcSheet: true, sortOrder: 3 });
  await product(rfm.id, 'Choker (bran)', { kind: 'BYPRODUCT', sortOrder: 4 });
  await product(rfm.id, 'Broken + usable dust + stem', { kind: 'BYPRODUCT', sortOrder: 5 });
  await product(rfm.id, 'Dust', { kind: 'BYPRODUCT', sortOrder: 6 });

  // Chakki Atta Mill
  const chakki = await product(cam.id, 'Chakki Atta', { shelfLifeDays: 120, hasQcSheet: true, sortOrder: 1 });
  await product(cam.id, 'Dust / sweepings', { kind: 'BYPRODUCT', sortOrder: 2 });

  // Chiura Mill — grades as separate rows
  const chiuraThin = await product(chm.id, 'Chiura — thin', { shelfLifeDays: 90, hasQcSheet: true, sortOrder: 1 });
  const chiuraMed = await product(chm.id, 'Chiura — medium', { shelfLifeDays: 90, hasQcSheet: true, sortOrder: 2 });
  await product(chm.id, 'Chiura — thick', { shelfLifeDays: 90, hasQcSheet: true, sortOrder: 3 });
  await product(chm.id, 'Husk', { kind: 'BYPRODUCT', sortOrder: 4 });
  await product(chm.id, 'Bran', { kind: 'BYPRODUCT', sortOrder: 5 });
  await product(chm.id, 'Broken flakes & powder', { kind: 'BYPRODUCT', sortOrder: 6 });

  // Bhuja Mill
  const bhuja = await product(bjm.id, 'Bhuja (puffed rice)', { shelfLifeDays: 90, hasQcSheet: true, sortOrder: 1 });
  await product(bjm.id, 'Unpuffed / rejects', { kind: 'BYPRODUCT', sortOrder: 2 });
  await product(bjm.id, 'Brokens', { kind: 'BYPRODUCT', sortOrder: 3 });

  // --- Roller Flour Mill specs ⚙ (paper form) + 📖 additions
  const visual: SpecDef = {
    name: 'Visual Inspection', valueType: 'SELECT', options: ['Nil', 'Insects found', 'Foreign material found', 'Microbial signs'],
    op: 'TEXT_MATCH', textExpected: 'Nil', display: 'No insects, microbes, foreign materials → "Nil"',
  };
  const uric: SpecDef = { name: 'Uric acid', unit: 'mg/kg', op: 'LTE', max: 100, display: '≤ 100 mg/kg', tag: REF, regRef: 'FSSAI' };

  const maidaParams = await createParams({ productId: maida.id }, [
    { name: 'First Break Moisture', unit: '% by wt', op: 'LT', max: 18.0, display: '< 18.0%', sampleCount: 3 },
    { name: 'Final Moisture Content', unit: '% by wt', op: 'LT', max: 14.0, display: '< 14.0%', sampleCount: 3, hasIr: true },
    { name: 'Gluten (dry basis)', unit: '% by wt', op: 'GT', min: 8.0, display: '> 8.0%', regRef: 'FSSAI: gluten ≥ 7.5%' },
    { name: 'Total Ash (dry basis)', unit: '% by wt', op: 'LT', max: 0.70, display: '< 0.70%', regRef: 'FSSAI: ash ≤ 1.0%', note: 'Hulas internal limit is deliberately tighter than FSSAI.' },
    { name: 'Acid Insoluble Ash (dry basis)', unit: '%', op: 'LT', max: 0.10, display: '< 0.10%' },
    { name: 'Alcoholic Acidity as H2SO4', unit: '%', op: 'LT', max: 0.12, display: '< 0.12%' },
    { name: 'Water Absorption Power', unit: '% by wt', op: 'GT', min: 50.0, display: '> 50.0%' },
    visual,
    { name: 'Granularity >180µ (per 100 gm)', unit: 'gm', op: 'NIL', display: '>180µ = 0' },
    { name: 'Granularity >150µ (per 100 gm)', unit: 'gm', op: 'NIL', display: '>150µ = 0' },
    { name: 'Granularity >132µ (per 100 gm)', unit: 'gm', op: 'RANGE', min: 0, max: 0.3, display: '>132µ = 0–0.3' },
    { name: 'Granularity <118µ (per 100 gm)', unit: 'gm', op: 'RANGE', min: 99.7, max: 100, display: '<118µ = 99.7–100' },
    uric,
  ]);

  const attaParams = await createParams({ productId: millAtta.id }, [
    { name: 'First Break Moisture', unit: '% by wt', op: 'LT', max: 18.0, display: '< 18.0%', sampleCount: 3 },
    { name: 'Final Moisture Content', unit: '% by wt', op: 'LT', max: 14.0, display: '< 14.0%', sampleCount: 3, hasIr: true },
    { name: 'Gluten (dry basis)', unit: '% by wt', op: 'GT', min: 6.0, display: '> 6.0%', regRef: 'FSSAI: gluten ≥ 6.0%' },
    { name: 'Total Ash (dry basis)', unit: '% by wt', op: 'LT', max: 2.0, display: '< 2.0%', regRef: 'FSSAI: ash ≤ 2.0%' },
    { name: 'Acid Insoluble Ash (dry basis)', unit: '%', op: 'LT', max: 0.15, display: '< 0.15%' },
    { name: 'Alcoholic Acidity as H2SO4', unit: '%', op: 'LT', max: 0.18, display: '< 0.18%', regRef: 'FSSAI: ≤ 0.18%' },
    { name: 'Water Absorption Power', unit: '% by wt', op: 'GT', min: 55.0, display: '> 55.0%' },
    visual,
    { name: 'Granularity — through 500µ sieve', unit: '%', op: 'GTE', min: 98, display: '≥ 98% through 500µ sieve', tag: REF, regRef: 'FSSAI atta' },
    uric,
    { name: 'Crude fibre (dry basis)', unit: '%', op: 'LTE', max: 2.5, display: '≤ 2.5%', tag: REF },
  ]);

  const sujiParams = await createParams({ productId: suji.id }, [
    { name: 'First Break Moisture', unit: '% by wt', op: 'LT', max: 18.0, display: '< 18.0%', sampleCount: 3 },
    { name: 'Final Moisture Content', unit: '% by wt', op: 'LT', max: 14.5, display: '< 14.5%', sampleCount: 3, hasIr: true, regRef: 'FSSAI suji: moisture ≤ 13.0%' },
    { name: 'Gluten (dry basis)', unit: '% by wt', op: 'GT', min: 6.0, display: '> 6.0%' },
    { name: 'Total Ash (dry basis)', unit: '% by wt', op: 'LT', max: 0.70, display: '< 0.70%' },
    { name: 'Acid Insoluble Ash (dry basis)', unit: '%', op: 'LT', max: 0.07, display: '< 0.07%' },
    { name: 'Alcoholic Acidity as H2SO4', unit: '%', op: 'LT', max: 0.15, display: '< 0.15%' },
    visual,
    { name: 'Granularity — through 315µ sieve', unit: '%', op: 'GTE', min: 80, display: '≥ 80% through 315µ sieve', tag: REF },
    uric,
    { name: 'Protein (dry basis)', unit: '%', op: 'GTE', min: 11.0, display: '≥ 11.0%', tag: REF },
  ]);

  // Chakki Atta 📖
  await createParams({ productId: chakki.id }, [
    { name: 'First Break Moisture', unit: '% by wt', op: 'LT', max: 18.0, display: '< 18.0%', sampleCount: 3, tag: REF },
    { name: 'Final Moisture Content', unit: '% by wt', op: 'LT', max: 14.0, display: '< 14.0% (target ≤ 13.0% — 120-day shelf life)', sampleCount: 3, hasIr: true, tag: REF },
    { name: 'Gluten (dry basis)', unit: '% by wt', op: 'GT', min: 6.0, display: '> 6.0%', tag: REF, regRef: 'FSSAI atta' },
    { name: 'Total Ash (dry basis)', unit: '% by wt', op: 'LT', max: 2.0, display: '< 2.0%', tag: REF, regRef: 'FSSAI atta' },
    { name: 'Acid Insoluble Ash (dry basis)', unit: '%', op: 'LT', max: 0.15, display: '< 0.15%', tag: REF },
    { name: 'Alcoholic Acidity as H2SO4', unit: '%', op: 'LT', max: 0.18, display: '< 0.18%', tag: REF, regRef: 'FSSAI atta' },
    { name: 'Crude fibre (dry basis)', unit: '%', op: 'LTE', max: 2.5, display: '≤ 2.5% (whole grain — expect ~1.5–2.5%)', tag: REF },
    { name: 'Water Absorption Power', unit: '% by wt', op: 'GT', min: 55.0, display: '> 55.0%', tag: REF },
    { name: 'Granularity — through 500µ sieve', unit: '%', op: 'GTE', min: 98, display: '≥ 98% through 500µ sieve (coarser rustic grind acceptable)', tag: REF },
    uric,
    visual,
    { name: 'Stone-mill outlet temperature', unit: '°C', op: 'LTE', max: 45, display: 'record °C — flag > 45°C', tag: REF, note: 'Nutrition/flavour claim protection for stone grinding.' },
  ]);

  // Chiura 📖 — same template for all three grades
  for (const p of [chiuraThin, chiuraMed]) void p; // grades share the template below
  const chiuraProducts = await prisma.product.findMany({ where: { millId: chm.id, hasQcSheet: true } });
  let chiuraParams: Record<string, string> = {};
  for (const cp of chiuraProducts) {
    const ids = await createParams({ productId: cp.id }, [
      { name: 'Moisture Content', unit: '%', op: 'LTE', max: 12.0, display: '≤ 12.0% (crispness & 90-day shelf life)', sampleCount: 3, hasIr: true, tag: REF },
      { name: 'Broken flakes & powder', unit: '%', op: 'LTE', max: 5.0, display: '≤ 5.0%', tag: REF },
      { name: 'Husk / paddy pieces', unit: '%', op: 'LTE', max: 0.1, display: 'Nil (max 0.1%)', tag: REF },
      { name: 'Bran content / colour', valueType: 'SELECT', options: ['Uniform, per grade', 'Uneven', 'Excess bran'], op: 'TEXT_MATCH', textExpected: 'Uniform, per grade', display: 'uniform, per grade (record)', tag: REF },
      { name: 'Flake thickness', unit: 'mm', op: 'RECORD', display: 'thin < 1.0 / medium 1.0–1.5 / thick > 1.5 mm (record)', tag: REF },
      { name: 'Bulk density', unit: 'g/L', op: 'RECORD', display: 'record g/L (grade norm)', tag: REF },
      { name: 'Water uptake / rehydration', valueType: 'TEXT', op: 'RECORD', display: 'record (target: soft in < 2 min)', tag: REF },
      { name: 'Acid Insoluble Ash (dry basis)', unit: '%', op: 'LTE', max: 0.10, display: '≤ 0.10%', tag: REF },
      { name: 'Alcoholic Acidity as H2SO4', unit: '%', op: 'LTE', max: 0.12, display: '≤ 0.12%', tag: REF },
      uric,
      { name: 'Foreign matter', unit: '%', op: 'NIL', display: 'Nil', tag: REF },
      visual,
      { name: 'Sensory — crunch/taste (kurum kurum score)', unit: 'score 1–5', op: 'GTE', min: 4, display: '1–5 scale, ≥ 4 to pass', tag: REF },
    ]);
    if (cp.id === chiuraMed.id) chiuraParams = ids;
  }

  // Bhuja 📖
  const bhujaParams = await createParams({ productId: bhuja.id }, [
    { name: 'Moisture Content', unit: '%', op: 'LTE', max: 8.0, display: '≤ 8.0% (typical 4–8%)', sampleCount: 3, hasIr: true, tag: REF },
    { name: 'Expansion ratio (vs raw rice volume)', unit: '× vol', op: 'GTE', min: 6, display: '≥ 6×', tag: REF },
    { name: 'Bulk density', unit: 'g/L', op: 'RANGE', min: 80, max: 125, display: '80–125 g/L (record)', tag: REF },
    { name: 'Unpuffed / partially puffed grains', unit: '%', op: 'LTE', max: 3.0, display: '≤ 3.0%', tag: REF },
    { name: 'Burnt / charred grains', unit: '%', op: 'LTE', max: 1.0, display: '≤ 1.0%', tag: REF },
    { name: 'Brokens', unit: '%', op: 'LTE', max: 5.0, display: '≤ 5.0%', tag: REF },
    { name: 'Husk pieces / sand', unit: '%', op: 'NIL', display: 'Nil', tag: REF },
    { name: 'Salt content (if salt-puffed)', unit: '%', op: 'LTE', max: 1.0, display: '≤ 1.0% (record)', tag: REF },
    { name: 'Acid Insoluble Ash (dry basis)', unit: '%', op: 'LTE', max: 0.5, display: '≤ 0.5%', tag: REF },
    uric,
    visual,
    { name: 'Sensory — crispness', unit: 'score 1–5', op: 'GTE', min: 4, display: '1–5 scale, ≥ 4 to pass', tag: REF },
  ]);

  // ---------- Users ----------
  const pw = hashPassword('hulas123');
  const users = await Promise.all([
    prisma.user.create({ data: { username: 'admin', name: 'Admin', role: 'ADMIN', passwordHash: pw } }),
    prisma.user.create({ data: { username: 'poonam', name: 'Poonam Gupta', role: 'QC', passwordHash: pw } }),
    prisma.user.create({ data: { username: 'gm', name: 'General Manager', role: 'MANAGER', passwordHash: pw } }),
    prisma.user.create({ data: { username: 'godown', name: 'Godown Keeper', role: 'GODOWN', passwordHash: pw } }),
    prisma.user.create({ data: { username: 'sup.rfm', name: 'RFM Supervisor', role: 'SUPERVISOR', millId: rfm.id, passwordHash: pw } }),
    prisma.user.create({ data: { username: 'sup.cam', name: 'Chakki Supervisor', role: 'SUPERVISOR', millId: cam.id, passwordHash: pw } }),
    prisma.user.create({ data: { username: 'sup.chm', name: 'Chiura Supervisor', role: 'SUPERVISOR', millId: chm.id, passwordHash: pw } }),
    prisma.user.create({ data: { username: 'sup.bjm', name: 'Bhuja Supervisor', role: 'SUPERVISOR', millId: bjm.id, passwordHash: pw } }),
  ]);
  const [adminU, poonam, gmU] = users;

  // ---------- Demo batch RFM-193 (from the real forms) ----------
  const AD = '2026-04-16';
  const BS = adToBs(AD); // 2083-01-03 → Miti 3-1-2083
  const dateAd = new Date(AD + 'T00:00:00');

  const batch193 = await prisma.batch.create({
    data: { millId: rfm.id, batchNo: 'RFM-193', dateAd, dateBs: BS },
  });

  // Spec lookup helper: latest spec version id per parameter
  async function specId(paramId: string) {
    const sv = await prisma.specVersion.findFirstOrThrow({ where: { parameterId: paramId }, orderBy: { version: 'desc' } });
    return sv.id;
  }

  // Wheat intake — Nepali Wheat, 25,600 kg, challan 94/95 — Accepted
  const intake = await prisma.intakeReport.create({
    data: {
      reportNo: 'SA-2083-0001',
      materialId: wheat.id,
      millId: rfm.id,
      batchId: batch193.id,
      supplierId: babaGalla.id,
      dateAd, dateBs: BS,
      variety: 'Nepali Wheat',
      challanNo: '94/95',
      vehicleNo: 'Bhe1 kha 1547',
      unloadingPlace: 'Maida Intake',
      weightKg: 25600, bags: 500, bagType: 'jute',
      season: 'Chait',
      decision: 'ACCEPTED',
      status: 'APPROVED',
      godownKeeper: 'Godown Keeper',
      checkedBy: 'Poonam Gupta',
      approvedBy: 'General Manager',
      approvedAt: dateAd,
      createdById: poonam.id,
    },
  });
  const wheatResults: Array<[string, number | null, string | null]> = [
    ['Texture', null, 'Hard'],
    ['Appearance / Smell', null, 'Grainy'],
    ['Moisture Content', 14.2, null],
    ['Size — 1000 kernels weight (HI)', 42, null],
    ['Dust & others', 0.6, null],
    ['Immature Grains', 0.4, null],
    ['Wevilled Grains', 0, null],
    ['Akara', 0.3, null],
    ['Damage Grains', 0, null],
    ['Other Food Grains', 0.5, null],
    ['Broken Grains', 0.7, null],
    ['Bulk Density', 766, null],
    ['Foreign Matter (Stem/stones)', 0.4, null],
    // rows 14–19 left blank, as on the paper form (= not tested)
  ];
  for (const [name, num, text] of wheatResults) {
    const pid = wheatParams[name];
    const sv = await prisma.specVersion.findFirstOrThrow({ where: { parameterId: pid } });
    const param = await prisma.parameter.findUniqueOrThrow({ where: { id: pid } });
    const { evaluate } = await import('../src/lib/spec');
    await prisma.intakeResult.create({
      data: {
        reportId: intake.id, parameterId: pid, specVersionId: sv.id,
        valueNum: num, valueText: text,
        evalStatus: evaluate(sv, param.valueType, num, text),
      },
    });
  }

  // Daily production report — from the "Maida Plan Daily Report"
  const prod = await prisma.productionReport.create({
    data: {
      reportNo: 'DP-2083-0001',
      millId: rfm.id, batchId: batch193.id,
      dateAd, dateBs: BS,
      vendors: 'Kalika Food Trades and Kitija Trading',
      manpower: 12,
      startTime: '22:00', closeTime: '06:00',
      breakdownMin: 30,
      electricityKwh: 4120, voltage: 380, cumulativeKwh: 812440,
      cumulativeMT: 6480.5,
      status: 'APPROVED',
      preparedBy: 'RFM Supervisor', approvedBy: 'General Manager', approvedAt: dateAd,
      createdById: users[4].id,
    },
  });
  await prisma.productionInput.create({
    data: { reportId: prod.id, invoiceNo: '94/95', kantaKg: 39542, boraKg: 1000, netKg: 38542, bagType: 'jute', intakeReportId: intake.id, sortOrder: 1 },
  });
  const rfmProducts = await prisma.product.findMany({ where: { millId: rfm.id }, orderBy: { sortOrder: 'asc' } });
  const byName = Object.fromEntries(rfmProducts.map((p) => [p.name, p]));
  const outRows: Array<[string, number, Record<string, number>]> = [
    // [product, semiFinishedKg, packed by size] — totals match the paper form kg
    ['Maida', 2580, { [packs['50 kg bora']]: 15000, [packs['20 kg bora']]: 4000, [packs['5 kg']]: 1000 }],
    ['Mill Atta', 250, { [packs['10 kg']]: 2000, [packs['5 kg']]: 1500, [packs['1 kg']]: 500 }],
    ['Suji', 190, { [packs['1 kg']]: 1000, [packs['400 g']]: 1000 }],
    ['Choker (bran)', 0, { [packs['50 kg bora']]: 9200 }],
    ['Broken + usable dust + stem', 800, {}],
    ['Dust', 600, {}],
  ];
  let sort = 1;
  for (const [name, semi, packed] of outRows) {
    await prisma.productionRow.create({
      data: { reportId: prod.id, productId: byName[name].id, semiFinishedKg: semi, packedKg: JSON.stringify(packed), sortOrder: sort++ },
    });
  }
  await prisma.downtimeEntry.create({
    data: { reportId: prod.id, fromTime: '00:30', toTime: '01:00', durationMin: 30, department: 'Break', rootCause: 'break', sortOrder: 1 },
  });

  // QC sheets — Maida / Mill Atta / Suji, values from the real forms
  const { evaluate } = await import('../src/lib/spec');
  async function qcSheet(
    reportNo: string,
    productId: string,
    params: Record<string, string>,
    rows: Array<{ name: string; s?: [number, number, number]; ir?: number; num?: number; text?: string; remarks?: string }>,
    remarks: string,
  ) {
    const rep = await prisma.qcReport.create({
      data: {
        reportNo, batchId: batch193.id, productId,
        dateAd, dateBs: BS,
        analyst: 'Poonam Gupta',
        overallResult: 'PASS',
        remarks,
        status: 'APPROVED',
        checkedBy: 'Poonam Gupta', approvedBy: 'General Manager', approvedAt: dateAd,
        createdById: poonam.id,
      },
    });
    for (const row of rows) {
      const pid = params[row.name];
      if (!pid) continue;
      const sv = await prisma.specVersion.findFirstOrThrow({ where: { parameterId: pid } });
      const param = await prisma.parameter.findUniqueOrThrow({ where: { id: pid } });
      const resultNum = row.num ?? (row.s ? Math.round((row.s.reduce((a, b) => a + b, 0) / 3) * 1000) / 1000 : null);
      await prisma.qcResult.create({
        data: {
          reportId: rep.id, parameterId: pid, specVersionId: sv.id,
          sample1: row.s?.[0] ?? null, sample2: row.s?.[1] ?? null, sample3: row.s?.[2] ?? null,
          irMoisture: row.ir ?? null,
          resultNum, resultText: row.text ?? null,
          remarks: row.remarks ?? (row.s ? '3 Sample' : '1 Sample'),
          evalStatus: evaluate(sv, param.valueType, resultNum, row.text ?? null),
        },
      });
    }
    return rep;
  }

  await qcSheet('QC-2083-0001', maida.id, maidaParams, [
    { name: 'First Break Moisture', s: [16.2, 16.4, 16.3] },
    { name: 'Final Moisture Content', s: [13.5, 13.6, 13.7], ir: 13.5 },
    { name: 'Gluten (dry basis)', num: 10.66 },
    { name: 'Total Ash (dry basis)', num: 0.40 },
    { name: 'Acid Insoluble Ash (dry basis)', num: 0.05 },
    { name: 'Alcoholic Acidity as H2SO4', num: 0.08 },
    { name: 'Water Absorption Power', num: 56.0 },
    { name: 'Visual Inspection', text: 'Nil' },
    { name: 'Granularity >180µ (per 100 gm)', num: 0 },
    { name: 'Granularity >150µ (per 100 gm)', num: 0 },
    { name: 'Granularity >132µ (per 100 gm)', num: 0.2 },
    { name: 'Granularity <118µ (per 100 gm)', num: 99.8, remarks: 'granularity 98.0% on form' },
  ], 'Accepted');

  await qcSheet('QC-2083-0002', millAtta.id, attaParams, [
    { name: 'Final Moisture Content', s: [12.8, 12.9, 13.0], ir: 12.9 },
    { name: 'Gluten (dry basis)', num: 7.6 },
    { name: 'Total Ash (dry basis)', num: 1.01 },
    { name: 'Acid Insoluble Ash (dry basis)', num: 0.09 },
    { name: 'Alcoholic Acidity as H2SO4', num: 0.11 },
    { name: 'Water Absorption Power', num: 58.0 },
    { name: 'Visual Inspection', text: 'Nil' },
  ], 'Accepted');
  // fortification record on the Mill Atta sheet
  await prisma.qcReport.update({
    where: { reportNo: 'QC-2083-0002' },
    data: { premixBrand: 'Hexagon Nutrition', premixLot: 'PMX-2083-11', premixTarget: 250, premixActual: 248, doserWorking: true, premixRemarks: 'Doser OK' },
  });

  await qcSheet('QC-2083-0003', suji.id, sujiParams, [
    { name: 'Final Moisture Content', s: [14.3, 14.4, 14.5], ir: 14.4 },
    { name: 'Gluten (dry basis)', num: 6.59 },
    { name: 'Total Ash (dry basis)', num: 0.52 },
    { name: 'Acid Insoluble Ash (dry basis)', num: 0.05 },
    { name: 'Alcoholic Acidity as H2SO4', num: 0.10 },
    { name: 'Visual Inspection', text: 'Nil' },
  ], 'Ash of Suji is slightly low');

  // ---------- Small demo batches for the other three mills ----------
  // Chakki Atta Mill — CAM-87 (draft QC so the approval queue has content)
  const camBatch = await prisma.batch.create({ data: { millId: cam.id, batchNo: 'CAM-87', dateAd, dateBs: BS } });
  const chakkiParams: Record<string, string> = {};
  for (const p of await prisma.parameter.findMany({ where: { productId: chakki.id } })) chakkiParams[p.name] = p.id;
  const camQc = await prisma.qcReport.create({
    data: {
      reportNo: 'QC-2083-0004', batchId: camBatch.id, productId: chakki.id,
      dateAd, dateBs: BS, analyst: 'Poonam Gupta', status: 'SUBMITTED',
      checkedBy: 'Poonam Gupta', overallResult: 'PASS', remarks: 'Awaiting approval',
      createdById: poonam.id,
    },
  });
  for (const [name, num, text] of [
    ['Final Moisture Content', 12.8, null],
    ['Gluten (dry basis)', 7.1, null],
    ['Total Ash (dry basis)', 1.6, null],
    ['Crude fibre (dry basis)', 1.9, null],
    ['Stone-mill outlet temperature', 42, null],
    ['Visual Inspection', null, 'Nil'],
  ] as Array<[string, number | null, string | null]>) {
    const pid = chakkiParams[name];
    const sv = await prisma.specVersion.findFirstOrThrow({ where: { parameterId: pid } });
    const param = await prisma.parameter.findUniqueOrThrow({ where: { id: pid } });
    await prisma.qcResult.create({
      data: { reportId: camQc.id, parameterId: pid, specVersionId: sv.id, resultNum: num, resultText: text, remarks: '1 Sample', evalStatus: evaluate(sv, param.valueType, num, text) },
    });
  }

  // Chiura Mill — CHM-41 with a medium-grade QC sheet
  const chmBatch = await prisma.batch.create({ data: { millId: chm.id, batchNo: 'CHM-41', dateAd, dateBs: BS } });
  const chmQc = await prisma.qcReport.create({
    data: {
      reportNo: 'QC-2083-0005', batchId: chmBatch.id, productId: chiuraMed.id,
      dateAd, dateBs: BS, analyst: 'Poonam Gupta', status: 'APPROVED',
      checkedBy: 'Poonam Gupta', approvedBy: 'General Manager', approvedAt: dateAd,
      overallResult: 'PASS', remarks: 'Kurum kurum — good crunch', createdById: poonam.id,
    },
  });
  for (const [name, num, text] of [
    ['Moisture Content', 11.2, null],
    ['Broken flakes & powder', 3.4, null],
    ['Husk / paddy pieces', 0, null],
    ['Flake thickness', 1.2, null],
    ['Bulk density', 340, null],
    ['Sensory — crunch/taste (kurum kurum score)', 4.5, null],
    ['Visual Inspection', null, 'Nil'],
  ] as Array<[string, number | null, string | null]>) {
    const pid = chiuraParams[name];
    if (!pid) continue;
    const sv = await prisma.specVersion.findFirstOrThrow({ where: { parameterId: pid } });
    const param = await prisma.parameter.findUniqueOrThrow({ where: { id: pid } });
    await prisma.qcResult.create({
      data: { reportId: chmQc.id, parameterId: pid, specVersionId: sv.id, resultNum: num, resultText: text, remarks: '1 Sample', evalStatus: evaluate(sv, param.valueType, num, text) },
    });
  }

  // Bhuja Mill — BJM-28 draft
  const bjmBatch = await prisma.batch.create({ data: { millId: bjm.id, batchNo: 'BJM-28', dateAd, dateBs: BS } });
  const bhQc = await prisma.qcReport.create({
    data: {
      reportNo: 'QC-2083-0006', batchId: bjmBatch.id, productId: bhuja.id,
      dateAd, dateBs: BS, analyst: 'Poonam Gupta', status: 'DRAFT', createdById: poonam.id,
    },
  });
  for (const [name, num] of [
    ['Moisture Content', 6.5],
    ['Expansion ratio (vs raw rice volume)', 6.8],
    ['Bulk density', 105],
    ['Unpuffed / partially puffed grains', 2.1],
  ] as Array<[string, number]>) {
    const pid = bhujaParams[name];
    const sv = await prisma.specVersion.findFirstOrThrow({ where: { parameterId: pid } });
    await prisma.qcResult.create({
      data: { reportId: bhQc.id, parameterId: pid, specVersionId: sv.id, resultNum: num, remarks: '1 Sample', evalStatus: evaluate(sv, 'NUMBER', num, null) },
    });
  }

  // seq counters so new reports continue after the demo ones
  for (const [k, v] of [['seq.INTAKE.2083', '1'], ['seq.QC.2083', '6'], ['seq.PRODUCTION.2083', '1']]) {
    await prisma.setting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } });
  }

  await prisma.auditLog.create({
    data: { userName: 'seed', recordType: 'MASTER', recordId: 'seed', action: 'CREATE', newValue: 'Initial master data + demo batches seeded' },
  });

  console.log('Seed complete. Login: admin / poonam / gm / godown / sup.rfm … password: hulas123');
  void adminU; void gmU;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
