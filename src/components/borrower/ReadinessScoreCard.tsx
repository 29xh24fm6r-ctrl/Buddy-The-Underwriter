"use client";

import React from "react";

/**
 * SBA God Mode: Readiness Score Card
 * 
 * Shows borrower their progress through the SBA loan application.
 * Inspired by TurboTax progress bars and Duolingo achievements.
 */

interface ReadinessScoreCardProps {
  overallScore: number; // 0.0 to 1.0
  components: {
    identity_verification: number;
    business_profile_complete: number;
    documents_uploaded: number;
    documents_verified: number;
    underwriting_confidence: number;
  };
  milestones: {
    '25': boolean;
    '50': boolean;
    '75': boolean;
    '100': boolean;
  };
}

export function ReadinessScoreCard({ overallScore, components, milestones }: ReadinessScoreCardProps) {
  const percentage = Math.round(overallScore * 100);
  
  // Determine color based on score
  const getColor = (score: number) => {
    if (score >= 0.75) return { bg: 'bg-green-500', text: 'text-green-600' };
    if (score >= 0.50) return { bg: 'bg-yellow-500', text: 'text-yellow-600' };
    if (score >= 0.25) return { bg: 'bg-orange-500', text: 'text-orange-600' };
    return { bg: 'bg-gray-400', text: 'text-gray-600' };
  };
  
  const color = getColor(overallScore);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      {/* Overall Score */}
      <div className="text-center mb-6">
        <h2 className="text-lg font-semibold mb-2">Your Application Progress</h2>
        
        {/* Circular progress */}
        <div className="relative inline-flex items-center justify-center">
          <svg className="w-32 h-32 transform -rotate-90">
            {/* Background circle */}
            <circle
              cx="64"
              cy="64"
              r="56"
              className="stroke-gray-200"
              strokeWidth="8"
              fill="none"
            />
            {/* Progress circle */}
            <circle
              cx="64"
              cy="64"
              r="56"
              className={`${color.bg.replace('bg-', 'stroke-')} transition-all duration-500`}
              strokeWidth="8"
              fill="none"
              strokeDasharray={`${2 * Math.PI * 56}`}
              strokeDashoffset={`${2 * Math.PI * 56 * (1 - overallScore)}`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute">
            <div className={`text-4xl font-bold ${color.text}`}>{percentage}%</div>
          </div>
        </div>
        
        <p className="text-sm text-gray-600 mt-2">
          {percentage >= 75 && "Almost ready for underwriting!"}
          {percentage >= 50 && percentage < 75 && "Halfway there!"}
          {percentage >= 25 && percentage < 50 && "Good progress so far"}
          {percentage < 25 && "Let's get started"}
        </p>
      </div>

      {/* Milestones */}
      <div className="flex items-center justify-between mb-6 px-4">
        {(['25', '50', '75', '100'] as const).map((milestone) => (
          <div
            key={milestone}
            className={`flex flex-col items-center ${
              milestones[milestone] ? 'opacity-100' : 'opacity-30'
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center ${
                milestones[milestone] ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'
              }`}
            >
              {milestones[milestone] ? '✓' : ''}
            </div>
            <span className="text-xs mt-1">{milestone}%</span>
          </div>
        ))}
      </div>

      {/* Component Breakdown */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700">What's Contributing</h3>
        
        <ScoreComponent
          label="Identity Verified"
          score={components.identity_verification}
          weight={10}
        />
        <ScoreComponent
          label="Business Profile"
          score={components.business_profile_complete}
          weight={10}
        />
        <ScoreComponent
          label="Documents Uploaded"
          score={components.documents_uploaded}
          weight={30}
        />
        <ScoreComponent
          label="Documents Verified"
          score={components.documents_verified}
          weight={25}
        />
        <ScoreComponent
          label="Underwriting Analysis"
          score={components.underwriting_confidence}
          weight={25}
        />
      </div>

      {/* Disclaimer */}
      <p className="text-xs text-gray-500 mt-6 border-t pt-4">
        This score shows your application progress, not approval likelihood. 
        Final credit decisions are made by human underwriters.
      </p>
    </div>
  );
}

function ScoreComponent({ label, score, weight }: { label: string; score: number; weight: number }) {
  const percentage = Math.round(score * 100);
  const isComplete = score >= 0.99;
  
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className={isComplete ? 'text-green-600 font-medium' : 'text-gray-700'}>
          {isComplete && '✓ '}
          {label}
        </span>
        <span className="text-gray-500 text-xs">
          {percentage}% ({weight}% of total)
        </span>
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${
            isComplete ? 'bg-green-500' : 'bg-blue-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
