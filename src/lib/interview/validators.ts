// src/lib/interview/validators.ts
import { z } from "zod";

export const InterviewSessionCreateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  mode: z.enum(["text", "voice", "mixed"]).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const InterviewTurnCreateSchema = z.object({
  role: z.enum(["buddy", "borrower", "banker"]),
  text: z.string().default(""),
  audio_file_id: z.string().uuid().optional().nullable(),
  transcript_confidence: z.number().min(0).max(1).optional().nullable(),
  payload: z.record(z.string(), z.any()).optional(),
});

export const InterviewFactCreateSchema = z.object({
  field_key: z.string().trim().min(1).max(200),
  field_value: z.any(), // stored as jsonb
  value_text: z.string().trim().max(4000).optional().nullable(),
  source_type: z.enum(["turn", "document", "manual"]).optional(),
  source_turn_id: z.string().uuid().optional().nullable(),
  source_document_id: z.string().uuid().optional().nullable(),
  confidence: z.number().min(0).max(1).optional().nullable(),
  revision_of: z.string().uuid().optional().nullable(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const InterviewFactConfirmSchema = z.object({
  confirmed: z.boolean(),
});
