---
name: buddy-voice
version: 2.0.0
author: buddy-system
description: OpenAI Realtime voice interview gateway for deal gap resolution
tags: [voice, openai-realtime, gap-resolution, interview]
allowed_tools: [openai_realtime_audio, deal_gap_queue, deal_financial_facts]
---

# Voice Skill

## Architecture
Browser → POST /api/deals/[dealId]/banker-session/realtime-token
         ← { proxyToken, sessionId }
Browser → WebSocket wss://buddy-voice-gateway.fly.dev/realtime
Gateway → validates token against Supabase deal_voice_sessions
Gateway → opens upstream to OpenAI Realtime API (bidirectional relay)
Gateway → tool calls intercepted → POST /api/deals/[dealId]/banker-session/dispatch
Dispatch → resolveDealGap() → deal_financial_facts (confirmed)
         → deal_events ledger entry (voice.fact_confirmed)

## Model
gpt-realtime via the OpenAI Realtime API (Bearer API key, server-side only)

## Gateway
Fly.io: buddy-voice-gateway, shared-cpu-1x, 512mb, min_machines_running=1
Secrets: BUDDY_GATEWAY_SECRET and OPENAI_API_KEY, set on Fly.io (never sent to the browser)
