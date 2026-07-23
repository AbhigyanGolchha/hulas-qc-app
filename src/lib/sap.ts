// SAP-readiness layer. Emits clean JSON shaped to map onto SAP QM inspection
// lots (intake + product QC) and production order confirmations (daily
// reports), and drops each payload into the integration_outbox for a future
// connector to consume. No SAP connection is made — standalone by design.
import { prisma } from './db';
import { intakeValue } from './calc';

export async function buildIntakePayload(id: string) {
  const r = await prisma.intakeReport.findUniqueOrThrow({
    where: { id },
    include: {
      material: true,
      mill: true,
      supplier: true,
      results: { include: { parameter: true, specVersion: true } },
    },
  });
  return {
    record_type: 'SAP_QM_INSPECTION_LOT',
    inspection_lot_origin: '01', // goods receipt
    record_id: r.id,
    report_no: r.reportNo,
    plant: r.mill ? { code: r.mill.sapPlantCode, name: r.mill.name } : null,
    material: { code: r.material.sapMaterialCode, name: r.material.name, variety: r.variety },
    vendor: r.supplier ? { code: r.supplier.sapVendorCode, name: r.supplier.name } : null,
    document: { challan_no: r.challanNo, vehicle_no: r.vehicleNo, unloading_place: r.unloadingPlace, season: r.season },
    quantity: { value: r.weightKg, unit: 'KG', bags: r.bags, bag_type: r.bagType },
    dates: { date_ad: r.dateAd.toISOString().slice(0, 10), date_bs: r.dateBs },
    usage_decision: {
      decision: r.decision,
      reason: r.decisionReason,
      deduction_amount: r.deductionAmount,
      deduction_rate: r.deductionRate,
    },
    // Pricing block. SAP B1 posting agreed with accounting: receive the FULL
    // weight on the GRPO, priced at effective_rate_per_quintal, so inventory
    // is valued at what the lot truly cost. Base rate and the deduction
    // breakdown ride along for the audit trail / supplier ledger.
    pricing: (() => {
      const v = intakeValue({
        weightKg: r.weightKg, pricePerQuintal: r.pricePerQuintal,
        weightCutKg: r.weightCutKg, priceCutPerQuintal: r.priceCutPerQuintal, flatDeduction: r.deductionAmount,
      });
      return {
        currency: 'NPR',
        price_unit: 'QUINTAL_100KG',
        base_rate_per_quintal: r.pricePerQuintal,
        gross_value: v.grossValue,
        deductions: {
          weight_cut_kg: r.weightCutKg,
          price_cut_per_quintal: r.priceCutPerQuintal,
          flat_amount: r.deductionAmount,
          total: v.totalDeduction,
        },
        payable_weight_kg: v.payableWeightKg,
        payable_value: v.payableValue,
        effective_rate_per_quintal: v.effectiveRatePerQuintal,
        sap_posting: 'GRPO_AT_EFFECTIVE_PRICE',
      };
    })(),
    status: r.status,
    signatures: { godown_keeper: r.godownKeeper, quality_controller: r.checkedBy, manager: r.approvedBy, approved_at: r.approvedAt?.toISOString() ?? null },
    characteristics: r.results.map((res) => ({
      characteristic: res.parameter.name,
      unit: res.parameter.unit,
      value_numeric: res.valueNum,
      value_text: res.valueText,
      evaluation: res.evalStatus,
      specification: {
        operator: res.specVersion.operator,
        min: res.specVersion.min,
        max: res.specVersion.max,
        display: res.specVersion.displayText,
        version: res.specVersion.version,
        source: res.specVersion.sourceTag,
      },
    })),
  };
}

export async function buildQcPayload(id: string) {
  const r = await prisma.qcReport.findUniqueOrThrow({
    where: { id },
    include: {
      batch: { include: { mill: true } },
      product: true,
      results: { include: { parameter: true, specVersion: true } },
    },
  });
  return {
    record_type: 'SAP_QM_INSPECTION_LOT',
    inspection_lot_origin: '04', // goods receipt from production
    record_id: r.id,
    report_no: r.reportNo,
    plant: { code: r.batch.mill.sapPlantCode, name: r.batch.mill.name },
    material: { code: r.product.sapMaterialCode, name: r.product.name },
    batch: { number: r.batch.batchNo, date_ad: r.batch.dateAd.toISOString().slice(0, 10), date_bs: r.batch.dateBs },
    dates: { date_ad: r.dateAd.toISOString().slice(0, 10), date_bs: r.dateBs },
    usage_decision: { result: r.overallResult, overridden: r.overallOverridden, override_reason: r.overrideReason, remarks: r.remarks },
    fortification: r.product.hasFortification
      ? { premix_brand: r.premixBrand, premix_lot: r.premixLot, dosing_target_g_per_mt: r.premixTarget, dosing_actual_g_per_mt: r.premixActual, doser_working: r.doserWorking, remarks: r.premixRemarks }
      : null,
    status: r.status,
    signatures: { checked_by: r.checkedBy, analyst: r.analyst, approved_by: r.approvedBy, approved_at: r.approvedAt?.toISOString() ?? null },
    characteristics: r.results.map((res) => ({
      characteristic: res.parameter.name,
      unit: res.parameter.unit,
      samples: [res.sample1, res.sample2, res.sample3].filter((s) => s !== null),
      ir_moisture: res.irMoisture,
      result_numeric: res.resultNum,
      result_text: res.resultText,
      evaluation: res.evalStatus,
      specification: {
        operator: res.specVersion.operator,
        min: res.specVersion.min,
        max: res.specVersion.max,
        display: res.specVersion.displayText,
        version: res.specVersion.version,
        source: res.specVersion.sourceTag,
      },
    })),
  };
}

export async function buildProductionPayload(id: string) {
  const r = await prisma.productionReport.findUniqueOrThrow({
    where: { id },
    include: {
      mill: true,
      batch: true,
      inputs: { include: { intakeReport: true }, orderBy: { sortOrder: 'asc' } },
      rows: { include: { product: true }, orderBy: { sortOrder: 'asc' } },
      downtime: { orderBy: { sortOrder: 'asc' } },
    },
  });
  const packSizes = await prisma.packSize.findMany();
  const packLabel = Object.fromEntries(packSizes.map((p) => [p.id, p.label]));
  return {
    record_type: 'SAP_PROD_ORDER_CONFIRMATION',
    record_id: r.id,
    report_no: r.reportNo,
    plant: { code: r.mill.sapPlantCode, name: r.mill.name },
    batch: { number: r.batch.batchNo, sap_order_no: r.batch.sapOrderNo },
    dates: { date_ad: r.dateAd.toISOString().slice(0, 10), date_bs: r.dateBs },
    operations: {
      manpower: r.manpower,
      start_time: r.startTime,
      close_time: r.closeTime,
      breakdown_minutes: r.breakdownMin,
      packaging_hours: r.packagingHours,
      electricity_kwh: r.electricityKwh,
      voltage: r.voltage,
      cumulative_kwh: r.cumulativeKwh,
      cumulative_production_mt: r.cumulativeMT,
      process_extras: r.processExtras ? JSON.parse(r.processExtras) : null,
      vendors: r.vendors,
    },
    goods_issued: r.inputs.map((i) => ({
      invoice_no: i.invoiceNo,
      gross_kg: i.kantaKg,
      tare_kg: i.boraKg,
      net_kg: i.netKg,
      bag_type: i.bagType,
      intake_report_no: i.intakeReport?.reportNo ?? null,
    })),
    goods_received: r.rows.map((row) => ({
      material: { code: row.product.sapMaterialCode, name: row.product.name, kind: row.product.kind },
      semi_finished_kg: row.semiFinishedKg,
      packed: Object.entries(row.packedKg ? (JSON.parse(row.packedKg) as Record<string, number>) : {}).map(([pid, kg]) => ({ pack_size: packLabel[pid] ?? pid, kg })),
    })),
    downtime: r.downtime.map((d) => ({ from: d.fromTime, to: d.toTime, minutes: d.durationMin, department: d.department, root_cause: d.rootCause })),
    status: r.status,
    signatures: { prepared_by: r.preparedBy, approved_by: r.approvedBy, approved_at: r.approvedAt?.toISOString() ?? null },
  };
}

export async function exportToOutbox(type: 'INTAKE' | 'QC' | 'PRODUCTION', id: string) {
  const payload =
    type === 'INTAKE' ? await buildIntakePayload(id) : type === 'QC' ? await buildQcPayload(id) : await buildProductionPayload(id);
  const row = await prisma.integrationOutbox.create({
    data: { recordType: payload.record_type, recordId: id, payload: JSON.stringify(payload), status: 'PENDING' },
  });
  // deliver immediately when the connector's auto-send is on (errors stay on
  // the queue row and are retried by the worker / manual sync — never lost)
  const { autoDeliver } = await import('./connector');
  void autoDeliver(row.id);
  return payload;
}
