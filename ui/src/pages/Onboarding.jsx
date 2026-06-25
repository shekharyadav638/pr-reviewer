import { Icon } from '@iconify/react';
import { useNavigate } from 'react-router-dom';

export default function Onboarding() {
  const navigate = useNavigate();

  return (
    <>
      {/* Decorative Background Element */}
      <div className="absolute top-0 inset-x-0 h-64 bg-gradient-to-b from-slate-100 to-transparent pointer-events-none z-0"></div>

      {/* Content Wrapper */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 md:p-12 z-10 overflow-y-auto">
        <div className="max-w-[880px] w-full flex flex-col items-center text-center">
          
          {/* Main Logo Graphic */}
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-brand-500 p-[1px] shadow-lg mb-8 shadow-brand-500/20">
            <div className="w-full h-full bg-white rounded-2xl flex items-center justify-center">
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-indigo-50 to-brand-100 flex items-center justify-center border border-brand-100">
                <Icon icon="lucide:shield" className="text-brand-600 text-4xl" />
              </div>
            </div>
          </div>

          {/* Hero Text */}
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight mb-4">
            PR Guardian
          </h1>
          <p className="text-slate-500 text-[15px] max-w-2xl leading-relaxed mb-12">
            AI-powered pull request analysis with 7-layer review — ML risk scoring, static analysis, security scanning, semantic search, and GPT-4 code review.
          </p>

          {/* 4 Steps Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 w-full text-left mb-12">
            
            {/* Step 1 */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-slate-300 transition-all">
              <span className="text-[10px] font-bold tracking-wider text-brand-600 uppercase mb-2 block">
                Step 1
              </span>
              <h3 className="text-[14px] font-semibold text-slate-900 mb-1.5">
                Connect a repo
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Browse Bitbucket or paste a repo URL in the sidebar.
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-slate-300 transition-all">
              <span className="text-[10px] font-bold tracking-wider text-brand-600 uppercase mb-2 block">
                Step 2
              </span>
              <h3 className="text-[14px] font-semibold text-slate-900 mb-1.5">
                Build index
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Click "Build Index" to clone and embed the codebase.
              </p>
            </div>

            {/* Step 3 */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-slate-300 transition-all">
              <span className="text-[10px] font-bold tracking-wider text-brand-600 uppercase mb-2 block">
                Step 3
              </span>
              <h3 className="text-[14px] font-semibold text-slate-900 mb-1.5">
                Review PRs
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Open any PR to get a full AI review with inline comments.
              </p>
            </div>

            {/* Step 4 / Auto */}
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-md hover:border-slate-300 transition-all">
              <span className="text-[10px] font-bold tracking-wider text-brand-600 uppercase mb-2 block">
                Auto
              </span>
              <h3 className="text-[14px] font-semibold text-slate-900 mb-1.5">
                Webhook
              </h3>
              <p className="text-[13px] text-slate-500 leading-relaxed">
                Set up a webhook for instant review on every new PR.
              </p>
            </div>

          </div>

          {/* Primary CTA */}
          <button 
            onClick={() => navigate('/repos')}
            className="inline-flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-6 py-3 rounded-lg text-[14px] font-medium shadow-sm shadow-brand-500/30 transition-all hover:shadow-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
          >
            Browse Bitbucket repos
            <Icon icon="lucide:arrow-right" className="text-[16px]" />
          </button>

        </div>
      </div>
    </>
  );
}
