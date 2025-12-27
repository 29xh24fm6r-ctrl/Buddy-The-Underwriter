"use client";

import { useState } from "react";
import { NavBar } from "@/components/NavBar";
import { useCapture } from "@/components/analytics/useCapture";

export default function ContactPage() {
  const capture = useCapture();

  const demoUrl = process.env.NEXT_PUBLIC_DEMO_CALENDAR_URL;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");

  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setStatus("sending");
    setError(null);
    capture("contact_submit_click");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, company, message }),
      });

      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error || "Failed to submit");

      setStatus("sent");
      capture("contact_submit_success");
    } catch (e: any) {
      setStatus("error");
      setError(e?.message || "Failed to submit");
      capture("contact_submit_error", { error: e?.message });
    }
  }

  return (
    <main>
      <NavBar />

      <section className="py-16 px-8 max-w-xl mx-auto">
        <h1 className="text-3xl font-bold mb-3">Contact Sales</h1>
        <p className="text-gray-600 mb-8">
          Tell us about your bank and we'll set up pricing + overlays.
        </p>

        {demoUrl && (
          <div className="mb-8">
            <a
              href={demoUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => capture("demo_request_click")}
              className="px-4 py-2 rounded bg-black text-white inline-block"
            >
              Request a Demo
            </a>
          </div>
        )}

        {status === "sent" ? (
          <div className="border rounded-xl p-6">
            <div className="font-semibold mb-1">✅ Message sent</div>
            <p className="text-gray-600 mb-4">
              We'll get back to you shortly.
            </p>
            {demoUrl && (
              <div>
                <a
                  href={demoUrl}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => capture("demo_request_click", { location: "contact_success" })}
                  className="px-4 py-2 rounded bg-black text-white inline-block"
                >
                  Book a demo now
                </a>
              </div>
            )}
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (status !== "sending") submit();
            }}
          >
            <input
              className="w-full border rounded p-2"
              placeholder="Name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              className="w-full border rounded p-2"
              placeholder="Work email *"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="w-full border rounded p-2"
              placeholder="Bank / company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
            <textarea
              className="w-full border rounded p-2"
              placeholder="What are you trying to accomplish? *"
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />

            {status === "error" && (
              <div className="text-sm text-red-600">{error}</div>
            )}

            <button
              type="submit"
              disabled={status === "sending"}
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-60"
            >
              {status === "sending" ? "Sending..." : "Send"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
