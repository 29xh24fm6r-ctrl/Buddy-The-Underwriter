"use client";

import React, { useEffect, useState } from "react";

/**
 * SBA God Mode: Milestone Toast
 * 
 * Celebratory toast when borrower hits progress milestones.
 * Auto-dismisses after 5 seconds but feels delightful.
 */

export type MilestoneKey = '25' | '50' | '75' | '100';

export type MilestoneMessage = {
  emoji: string;
  title: string;
  description: string;
  color: string;
};

export type MilestoneMessages = Record<MilestoneKey, MilestoneMessage>;

interface MilestoneToastProps {
  milestone: MilestoneKey | null;
  onDismiss: () => void;
  /** Override the default copy — different borrower journeys (bulk-upload
   * vs. brokerage/portal) reach 100% via different next steps, so the
   * message shouldn't be hardcoded to one journey's language. */
  messages?: MilestoneMessages;
}

export function MilestoneToast({ milestone, onDismiss, messages }: MilestoneToastProps) {
  const [dismissed, setDismissed] = useState(false);
  const visible = Boolean(milestone && !dismissed);

  useEffect(() => {
    if (!milestone) return;
    
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(false);
    const timer = setTimeout(() => {
      setDismissed(true);
      setTimeout(onDismiss, 300); // Wait for fade-out animation
    }, 5000);
    
    return () => clearTimeout(timer);
  }, [milestone, onDismiss]);

  if (!milestone || !visible) return null;

  const defaultMessages: MilestoneMessages = {
    '25': {
      emoji: '🎉',
      title: 'Nice — you\'ve started!',
      description: 'Keep going, you\'re building momentum',
      color: 'bg-blue-500',
    },
    '50': {
      emoji: '🚀',
      title: 'Halfway there!',
      description: 'The big stuff is done — you\'ve got this',
      color: 'bg-green-500',
    },
    '75': {
      emoji: '💪',
      title: 'Almost underwriter-ready!',
      description: 'Just a few more pieces and you\'re golden',
      color: 'bg-yellow-500',
    },
    '100': {
      emoji: '🎊',
      title: 'Package ready for E-Tran!',
      description: 'Amazing work! We\'re reviewing your application now',
      color: 'bg-purple-500',
    },
  };

  const config = (messages ?? defaultMessages)[milestone];

  return (
    <div
      className={`fixed top-4 right-4 z-50 transition-all duration-300 ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
    >
      <div className={`${config.color} text-white rounded-lg shadow-lg p-4 max-w-sm`}>
        <div className="flex items-start gap-3">
          <div className="text-3xl">{config.emoji}</div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg">{config.title}</h3>
            <p className="text-sm text-white/90 mt-1">{config.description}</p>
          </div>
          <button
            onClick={() => {
              setDismissed(true);
              setTimeout(onDismiss, 300);
            }}
            className="text-white/75 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Progress bar animation */}
        <div className="mt-3 h-1 bg-white/30 rounded-full overflow-hidden">
          <div
            className="h-full bg-white animate-shrink"
            style={{
              animation: 'shrink 5s linear forwards',
            }}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes shrink {
          from {
            width: 100%;
          }
          to {
            width: 0%;
          }
        }
      `}</style>
    </div>
  );
}
