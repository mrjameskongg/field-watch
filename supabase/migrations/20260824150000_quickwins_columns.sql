-- Research quick wins (plan 2026-08-24-research-quick-wins.md).
-- grade: intake quality grade, TEXT app-validated 'A'|'B'|'C' (house rule: no enums).
-- certifications / labor_notes: ESG questionnaire fields on the farmer profile.
ALTER TABLE public.deliveries ADD COLUMN IF NOT EXISTS grade TEXT;
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS certifications TEXT;
ALTER TABLE public.farmers ADD COLUMN IF NOT EXISTS labor_notes TEXT;
