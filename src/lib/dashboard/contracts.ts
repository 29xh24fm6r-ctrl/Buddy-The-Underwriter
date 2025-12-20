// src/lib/dashboard/contracts.ts
import { z } from "zod";

export const DateRangeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const DashboardFiltersSchema = z.object({
  userId: z.string().uuid().optional(), // filter to one banker
  dealType: z.string().optional(),      // optional if you have types
  stage: z.string().optional(),
});

export type DateRange = z.infer<typeof DateRangeSchema>;
export type DashboardFilters = z.infer<typeof DashboardFiltersSchema>;
