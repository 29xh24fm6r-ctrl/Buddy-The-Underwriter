---
name: buddy-voice
version: 1.0.0
author: buddy-system
description: Gemini Live voice interview gateway for deal gap resolution
tags: [voice, gemini-live, gap-resolution, interview]
allowed_tools: [gemini_live_audio, deal_gap_queue, deal_financial_facts]
---

# Voice Skill

## Architecture
Browser → POST /api/deals/[dealId]/banker-session/gemini-token
         ← { proxyToken, sessionId }
Browser → WebSocket wss://pulse-voice-gateway.fly.dev/gemini-live
Gateway → validates token against Supabase deal_voice_sessions
Gateway → opens upstream to Vertex AI Gemini Live (bidirectional relay)
Gateway → tool calls intercepted → POST /api/deals/[dealId]/banker-session/dispatch
Dispatch → resolveDealGap() → deal_financial_facts (confirmed)
         → deal_events ledger entry (voice.fact_confirmed)

## Model
gemini-live-2.5-flash-native-audio via Vertex AI (GCP service account OAuth2)

## Gateway
Fly.io: pulse-voice-gateway, shared-cpu-1x, 512mb, min_machines_running=1
Secret: BUDDY_GATEWAY_SECRET shared between Fly.io and Vercel
