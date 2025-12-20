"use client";

import React, { useEffect, useRef, useState } from "react";

type Props = {
  dealId: string;
  sessionId: string | null;
  className?: string;
  onSavedTurn?: (turn: any, extras?: { plan?: any; insertedFactsCount?: number }) => void;
};

type RealtimeClientSecretResponse = {
  value?: string;
  client_secret?: { value?: string };
};

function getEphemeralKey(payload: any): string | null {
  if (!payload) return null;
  if (typeof payload.value === "string") return payload.value;
  if (payload.client_secret?.value && typeof payload.client_secret.value === "string") {
    return payload.client_secret.value;
  }
  return null;
}

function isExplicitAffirmation(text: string) {
  const t = (text || "").trim().toLowerCase();
  return (
    t === "yes" ||
    t === "correct" ||
    t === "that's correct" ||
    t === "thats correct" ||
    t === "yes that's correct" ||
    t === "yes thats correct" ||
    t === "yes correct" ||
    t === "confirmed" ||
    t === "confirm" ||
    t === "yes, confirm" ||
    t === "confirm that" ||
    t === "confirm it"
  );
}

function isQaTrigger(text: string) {
  const t = (text || "").trim().toLowerCase();
  return t === "question" || t === "i have a question" || t.startsWith("i have a question");
}

function isConfirmAllTrigger(text: string) {
  const t = (text || "").trim().toLowerCase();
  return t === "confirm" || t === "confirm all" || t === "yes confirm" || t === "yes, confirm";
}

export default function VoiceInterviewButton({ dealId, sessionId, className, onSavedTurn }: Props) {
  const [status, setStatus] = useState<"idle" | "starting" | "connected" | "stopping" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [liveTranscript, setLiveTranscript] = useState<string>("");

  const [pushToTalk, setPushToTalk] = useState<boolean>(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // State machine for Q&A mode
  const awaitingQaQuestionRef = useRef<boolean>(false);

  // Track the last plan we asked (from server)
  const lastAskedPlanRef = useRef<any>(null);

  // Track latest suggested fact IDs so we can voice-confirm them (explicitly)
  const lastSuggestedFactIdsRef = useRef<string[]>([]);

  // Track whether Buddy just did a "captured items" readback prompt
  const awaitingVoiceConfirmRef = useRef<boolean>(false);

  const canStart = status === "idle" || status === "error";
  const canStop = status === "connected";

  const sendResponseCreate = (instructions: string) => {
    const dc = dcRef.current;
    if (!dc || dc.readyState !== "open") return;

    dc.send(
      JSON.stringify({
        type: "response.create",
        response: {
          output_modalities: ["audio", "text"],
          instructions,
        },
      })
    );
  };

  const speakText = (text: string) => {
    const clean = String(text || "").trim();
    if (!clean) return;
    sendResponseCreate(
      [
        "Say the following exactly (do not add extra questions):",
        clean,
        "Be friendly, concise, human.",
      ].join("\n")
    );
  };

  const askNextServerLogged = async () => {
    if (!sessionId) return null;

    const r = await fetch(`/api/deals/${dealId}/interview/sessions/${sessionId}/question-plan/ask-next`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `ask_next_failed_${r.status}`);

    lastAskedPlanRef.current = j.plan || null;

    const q = j?.plan?.question ? String(j.plan.question).trim() : "";
    if (q) speakText(q);

    return j as { plan: any; buddyTurn: any };
  };

  const confirmSingleCandidateIfApplicable = async (borrowerTurn: any, borrowerText: string) => {
    const plan = lastAskedPlanRef.current;
    const candidateId = plan?.candidate_fact_id ? String(plan.candidate_fact_id) : null;

    if (plan?.kind !== "confirm_candidate") return;
    if (!candidateId) return;
    if (!isExplicitAffirmation(borrowerText)) return;

    const r = await fetch(`/api/deals/${dealId}/interview/sessions/${sessionId}/facts/confirm-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        factIds: [candidateId],
        confirmed: true,
        confirmationTurnId: borrowerTurn?.id ?? null,
        confirmationText: borrowerText ?? null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) console.warn("auto_confirm_failed", j?.error || r.status);
  };

  const confirmAllSuggestedFactsIfApplicable = async (borrowerTurn: any, borrowerText: string) => {
    if (!awaitingVoiceConfirmRef.current) return;
    if (!isConfirmAllTrigger(borrowerText)) return;

    const ids = lastSuggestedFactIdsRef.current || [];
    if (ids.length === 0) return;

    const r = await fetch(`/api/deals/${dealId}/interview/sessions/${sessionId}/facts/confirm-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        factIds: ids,
        confirmed: true,
        confirmationTurnId: borrowerTurn?.id ?? null,
        confirmationText: borrowerText ?? null,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) console.warn("confirm_all_failed", j?.error || r.status);

    // Once confirmed, clear the state
    awaitingVoiceConfirmRef.current = false;
    lastSuggestedFactIdsRef.current = [];
  };

  const saveBorrowerTurn = async (text: string, payload?: Record<string, any>) => {
    if (!sessionId) return null;

    const r = await fetch(`/api/deals/${dealId}/interview/sessions/${sessionId}/turns/voice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "borrower", text, payload }),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `turn_save_failed_${r.status}`);

    // Track that suggested facts likely exist after this turn (server inserted them).
    // We'll refresh the exact IDs from UI later; but for voice confirm we need an immediate list.
    // Best approach: borrow the "candidate_fact_id" and/or ask the UI to pass suggested IDs.
    // Here we set a conservative placeholder: if plan says confirm_candidate, store that id.
    const plan = j.plan;
    if (plan?.candidate_fact_id) {
      lastSuggestedFactIdsRef.current = [String(plan.candidate_fact_id)];
    }

    onSavedTurn?.(j.turn, { plan: j.plan, insertedFactsCount: j.insertedFactsCount });
    return j as { turn: any; plan: any; insertedFactsCount: number };
  };

  const runQa = async (question: string) => {
    if (!sessionId) return;

    const r = await fetch(`/api/deals/${dealId}/interview/sessions/${sessionId}/qa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.ok === false) throw new Error(j?.error || `qa_failed_${r.status}`);

    // Speak the answer
    const ans = String(j.answer || "").trim();
    if (ans) speakText(ans);

    // After Q&A, return to intake
    awaitingQaQuestionRef.current = false;
    await new Promise((r) => setTimeout(r, 200));
    speakText("Ready to continue? Let's pick up where we left off.");
    await new Promise((r) => setTimeout(r, 200));
    await askNextServerLogged();
  };

  const stop = async () => {
    setStatus("stopping");
    setErrorMsg("");
    try {
      dcRef.current?.close();
      dcRef.current = null;

      pcRef.current?.getSenders().forEach((s) => {
        try {
          if (s.track) s.track.stop();
        } catch {}
      });
      pcRef.current?.close();
      pcRef.current = null;

      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      micTrackRef.current = null;

      if (audioElRef.current) {
        audioElRef.current.pause();
        audioElRef.current.srcObject = null;
      }

      lastAskedPlanRef.current = null;
      awaitingQaQuestionRef.current = false;
      awaitingVoiceConfirmRef.current = false;
      lastSuggestedFactIdsRef.current = [];
      setLiveTranscript("");
      setStatus("idle");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message || "Failed to stop voice session");
    }
  };

  const start = async () => {
    if (!sessionId) {
      setStatus("error");
      setErrorMsg("Select/create an interview session first.");
      return;
    }

    setStatus("starting");
    setErrorMsg("");
    setLiveTranscript("");
    lastAskedPlanRef.current = null;
    awaitingQaQuestionRef.current = false;
    awaitingVoiceConfirmRef.current = false;
    lastSuggestedFactIdsRef.current = [];

    try {
      // ephemeral key
      const tokenResp = await fetch(`/api/deals/${dealId}/voice/token`, { method: "GET" });
      const tokenJson = (await tokenResp.json()) as RealtimeClientSecretResponse;
      const EPHEMERAL_KEY = getEphemeralKey(tokenJson);
      if (!EPHEMERAL_KEY) throw new Error("Missing ephemeral key in token response");

      // peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;

      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0];
      };

      // mic
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = ms;

      const [track] = ms.getAudioTracks();
      micTrackRef.current = track;
      if (pushToTalk) track.enabled = false;

      pc.addTrack(track);

      // data channel
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.onmessage = async (msg) => {
        let evt: any = null;
        try {
          evt = JSON.parse(msg.data);
        } catch {
          return;
        }

        if (evt?.type === "conversation.item.input_audio_transcription.delta" && typeof evt.delta === "string") {
          setLiveTranscript((prev) => (prev + evt.delta).slice(-4000));
        }

        if (evt?.type === "conversation.item.input_audio_transcription.completed") {
          const transcript = typeof evt.transcript === "string" ? evt.transcript.trim() : "";
          setLiveTranscript("");
          if (!transcript) return;

          // Q&A state: if we asked "what's your question?" then treat next utterance as the question
          if (awaitingQaQuestionRef.current) {
            await runQa(transcript);
            return;
          }

          // If borrower triggers Q&A mode explicitly
          if (isQaTrigger(transcript)) {
            awaitingQaQuestionRef.current = true;
            speakText("Sure — what's your question?");
            return;
          }

          // Save borrower turn => server suggests facts + returns plan
          const saved = await saveBorrowerTurn(transcript, {
            channel: "voice",
            source: "openai_realtime",
            item_id: evt.item_id,
            content_index: evt.content_index,
          });

          // If we were awaiting a confirm (Buddy just read back captured items), allow "confirm all"
          await confirmAllSuggestedFactsIfApplicable(saved?.turn, transcript);

          // Optional: auto-confirm single candidate if we asked a confirm_candidate and borrower says yes/correct
          await confirmSingleCandidateIfApplicable(saved?.turn, transcript);

          // If server inserted multiple suggested facts, do a short readback + offer confirm
          const insertedCount = Number(saved?.insertedFactsCount || 0);
          if (insertedCount >= 2) {
            awaitingVoiceConfirmRef.current = true;
            speakText(
              `I captured ${insertedCount} items from that. If that sounds right, say "confirm" to lock them in. Or you can correct anything.`
            );
            // Then continue the interview on the next turn (after confirm or correction)
            return;
          }

          // Otherwise continue deterministic intake immediately
          await askNextServerLogged();
        }
      };

      dc.onopen = async () => {
        sendResponseCreate(`Greet warmly. Disclose once: "I'm Buddy, an AI lending assistant." Keep it short.`);
        await askNextServerLogged();
      };

      // SDP offer/answer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResp.ok) {
        const t = await sdpResp.text().catch(() => "");
        throw new Error(`Realtime SDP failed: ${sdpResp.status} ${t}`);
      }

      const answer = { type: "answer", sdp: await sdpResp.text() } as RTCSessionDescriptionInit;
      await pc.setRemoteDescription(answer);

      setStatus("connected");
    } catch (e: any) {
      setStatus("error");
      setErrorMsg(e?.message || "Failed to start voice session");
      try {
        await stop();
      } catch {}
    }
  };

  const onHoldTalkStart = () => {
    if (!pushToTalk) return;
    const t = micTrackRef.current;
    if (t) t.enabled = true;
  };

  const onHoldTalkEnd = () => {
    if (!pushToTalk) return;
    const t = micTrackRef.current;
    if (t) t.enabled = false;
  };

  useEffect(() => {
    return () => {
      try {
        dcRef.current?.close();
        pcRef.current?.close();
        micStreamRef.current?.getTracks().forEach((t) => t.stop());
      } catch {}
    };
  }, []);

  const disabledBecauseNoSession = !sessionId;
  const startDisabled = !canStart || disabledBecauseNoSession;

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            startDisabled ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground hover:opacity-90"
          }`}
          disabled={startDisabled}
          onClick={start}
          title={disabledBecauseNoSession ? "Select/create a session first" : "Start voice"}
        >
          {status === "starting" ? "Starting…" : "Talk to Buddy"}
        </button>

        <button
          type="button"
          className={`rounded-md px-3 py-2 text-sm font-medium ${
            canStop ? "border hover:bg-accent" : "bg-muted text-muted-foreground"
          }`}
          disabled={!canStop}
          onClick={stop}
        >
          {status === "stopping" ? "Stopping…" : "Stop"}
        </button>

        <label className="ml-2 flex items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={pushToTalk}
            onChange={(e) => {
              const next = e.target.checked;
              setPushToTalk(next);
              const t = micTrackRef.current;
              if (t) t.enabled = !next;
            }}
            disabled={status === "starting"}
          />
          Push-to-talk
        </label>

        {pushToTalk && status === "connected" ? (
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm hover:bg-accent"
            onMouseDown={onHoldTalkStart}
            onMouseUp={onHoldTalkEnd}
            onMouseLeave={onHoldTalkEnd}
            onTouchStart={onHoldTalkStart}
            onTouchEnd={onHoldTalkEnd}
            title="Hold to speak"
          >
            Hold to speak
          </button>
        ) : null}

        <div className="text-xs text-muted-foreground">
          {status === "connected" ? "Live" : status === "starting" ? "Connecting" : "Idle"}
        </div>
      </div>

      {errorMsg ? (
        <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 p-2 text-sm">
          <div className="font-medium">Voice error</div>
          <div className="mt-1 font-mono text-xs">{errorMsg}</div>
        </div>
      ) : null}

      {status === "connected" && liveTranscript ? (
        <div className="mt-2 rounded-md border bg-card p-2 text-sm">
          <div className="mb-1 text-xs text-muted-foreground">Listening…</div>
          <div className="whitespace-pre-wrap">{liveTranscript}</div>
        </div>
      ) : null}

      <div className="mt-2 text-xs text-muted-foreground">
        Tip: say "I have a question" anytime for Q&A mode. Intake decisions remain based on confirmed facts only.
      </div>
    </div>
  );
}
