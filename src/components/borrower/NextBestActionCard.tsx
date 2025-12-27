"use client";

import React from "react";

/**
 * SBA God Mode: Next Best Action Card
 * 
 * Tells borrower exactly what to do next to move their application forward.
 * One clear CTA, not a laundry list.
 */

interface NextBestActionCardProps {
  action: {
    type: 'upload_document' | 'complete_profile' | 'verify_identity' | 'answer_question' | 'wait_for_review';
    title: string;
    description: string;
    eta_minutes: number;
    priority: 'critical' | 'high' | 'medium' | 'low';
  } | null;
}

export function NextBestActionCard({ action }: NextBestActionCardProps) {
  if (!action) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <div className="text-center">
          <div className="text-4xl mb-2">🎉</div>
          <h3 className="text-lg font-semibold text-green-900">All Set!</h3>
          <p className="text-sm text-green-700 mt-1">
            Your application is with our underwriting team. We'll notify you of any updates.
          </p>
        </div>
      </div>
    );
  }

  const priorityStyles = {
    critical: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-900',
      badge: 'bg-red-100 text-red-700',
      button: 'bg-red-600 hover:bg-red-700 text-white',
    },
    high: {
      bg: 'bg-orange-50',
      border: 'border-orange-200',
      text: 'text-orange-900',
      badge: 'bg-orange-100 text-orange-700',
      button: 'bg-orange-600 hover:bg-orange-700 text-white',
    },
    medium: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-900',
      badge: 'bg-blue-100 text-blue-700',
      button: 'bg-blue-600 hover:bg-blue-700 text-white',
    },
    low: {
      bg: 'bg-gray-50',
      border: 'border-gray-200',
      text: 'text-gray-900',
      badge: 'bg-gray-100 text-gray-700',
      button: 'bg-gray-600 hover:bg-gray-700 text-white',
    },
  };

  const styles = priorityStyles[action.priority];

  const getIcon = () => {
    switch (action.type) {
      case 'upload_document': return '📄';
      case 'complete_profile': return '📝';
      case 'verify_identity': return '🪪';
      case 'answer_question': return '❓';
      case 'wait_for_review': return '⏳';
    }
  };

  const getActionUrl = () => {
    switch (action.type) {
      case 'upload_document': return '/borrower/upload';
      case 'complete_profile': return '/borrower/profile';
      case 'verify_identity': return '/borrower/verify';
      case 'answer_question': return '/borrower/questions';
      case 'wait_for_review': return null;
    }
  };

  const formatETA = (minutes: number) => {
    if (minutes < 5) return 'Less than 5 minutes';
    if (minutes < 60) return `About ${minutes} minutes`;
    if (minutes < 1440) return `About ${Math.round(minutes / 60)} hours`;
    return `About ${Math.round(minutes / 1440)} days`;
  };

  return (
    <div className={`${styles.bg} border ${styles.border} rounded-lg p-6`}>
      <div className="flex items-start gap-4">
        {/* Icon */}
        <div className="text-4xl">{getIcon()}</div>

        {/* Content */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <h3 className={`text-lg font-semibold ${styles.text}`}>{action.title}</h3>
            {action.priority === 'critical' && (
              <span className={`text-xs px-2 py-1 rounded ${styles.badge}`}>
                Required
              </span>
            )}
          </div>
          
          <p className="text-sm text-gray-700 mb-3">{action.description}</p>
          
          <div className="flex items-center gap-4 text-xs text-gray-600 mb-4">
            <span>⏱️ {formatETA(action.eta_minutes)}</span>
          </div>

          {/* CTA */}
          {getActionUrl() ? (
            <a
              href={getActionUrl()!}
              className={`inline-block px-4 py-2 rounded font-medium ${styles.button} transition-colors`}
            >
              {action.type === 'upload_document' && 'Upload Now'}
              {action.type === 'complete_profile' && 'Complete Profile'}
              {action.type === 'verify_identity' && 'Verify Identity'}
              {action.type === 'answer_question' && 'Answer Question'}
            </a>
          ) : (
            <div className="text-sm text-gray-600 italic">
              No action required right now
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
