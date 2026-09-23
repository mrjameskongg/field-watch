// One place where database enums become words a clerk would say. Every screen
// that used to render `value.replace(/_/g, " ")` now calls one of these, so a
// new value still reads as words and a renamed one changes in one line.
// English only for now; the Khmer pass wires these into i18n.

export const humanize = (value: string | null | undefined): string => {
  if (!value) return "";
  const words = value.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const pick = (table: Record<string, string>) => (value: string | null | undefined) =>
  value ? (table[value] ?? humanize(value)) : "";

export const alertTypeLabel = pick({
  water_stress: "Water stress",
  possible_burn: "Possible burn",
  low_vegetation: "Low vegetation",
  manual_flag: "Flagged by officer",
});

export const alertStatusLabel = pick({
  open: "Open",
  investigating: "Being checked",
  resolved: "Resolved",
  dismissed: "Dismissed",
});

export const settlementStatusLabel = pick({
  draft: "Slip saved, not paid",
  paid: "Paid",
  cancelled: "Cancelled",
});

export const advanceItemLabel = pick({
  seed: "Seed",
  fertiliser: "Fertiliser",
  fertilizer: "Fertiliser",
  pesticide: "Pesticide",
  cash: "Cash advance",
  other: "Other",
});

export const farmerStatusLabel = pick({
  active: "Active",
  inactive: "Inactive",
  suspended: "Suspended",
});

export const custodyLabel = pick({
  identity_preserved: "Kept separate",
  mass_balance: "Mixed (mass balance)",
});

export const dispatchProductLabel = pick({
  head_rice: "Head rice",
  broken: "Broken rice",
  bran: "Rice bran",
  husk: "Husk",
  paddy: "Paddy",
});

export const PAYMENT_METHODS = ["Cash", "ABA transfer", "Wing", "Bank transfer", "Other"] as const;

// QC test types. The list drives the add-test picker; the label helper is
// used by the QC dialog, the /qc table and the lot traceability ledger.
export const TEST_TYPES: { value: string; label: string }[] = [
  { value: "moisture", label: "Moisture" },
  { value: "visual", label: "Visual check (condition, foreign matter)" },
  { value: "pesticide_residue", label: "Pesticide residue" },
  { value: "other", label: "Other" },
];

export const qcTestTypeLabel = (type: string | null | undefined): string =>
  type ? (TEST_TYPES.find((t) => t.value === type)?.label ?? humanize(type)) : "";
