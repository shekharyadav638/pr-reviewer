import { Icon } from '@iconify/react';
import { useState, useEffect } from 'react';
import { listRepos, registerWebhook } from '../api/client';
import Toast from '../components/Toast';

export default function WebhookSetup() {
  const [repos, setRepos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(null);
  const [toast, setToast] = useState(null);

  // You can set the host manually or dynamically
  const webhookUrl = `${window.location.origin}/webhook/bitbucket`;

  useEffect(() => {
    async function loadRepos() {
      try {
        const data = await listRepos();
        setRepos(data);
      } catch (err) {
        console.error("Failed to load repos", err);
      } finally {
        setLoading(false);
      }
    }
    loadRepos();
  }, []);

  const handleAutoRegister = async (repoId) => {
    setRegistering(repoId);
    try {
      const response = await registerWebhook(repoId);
      if (response.status === 'already_registered') {
        setToast({ message: "Webhook is already registered for this repository.", type: 'success' });
      } else if (response.status === 'permission_denied') {
        setToast({ message: "Permission Denied: " + response.message, type: 'error' });
      } else if (response.status === 'error') {
        setToast({ message: "Error: " + response.message, type: 'error' });
      } else {
        setToast({ message: "Webhook successfully registered!", type: 'success' });
      }
    } catch (err) {
      setToast({ message: "Failed to register webhook: " + err.message, type: 'error' });
    } finally {
      setRegistering(null);
    }
  };

  return (
    <>
      <Toast message={toast?.message} type={toast?.type} onDismiss={() => setToast(null)} />
      <div className="absolute top-0 inset-x-0 h-64 bg-gradient-to-b from-slate-100 to-transparent pointer-events-none z-0"></div>

      <header className="px-8 py-6 border-b border-slate-200 bg-white/80 backdrop-blur-md shrink-0 z-20 relative">
        <div className="w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center border border-amber-100 shadow-sm">
              <Icon icon="lucide:zap" className="text-amber-500 text-[20px]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Webhook Setup
              </h1>
              <p className="text-[14px] text-slate-500 mt-0.5">
                Configure Bitbucket webhooks to automatically review Pull Requests when they are created.
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8 relative z-10">
        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Manual Instructions */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
              <Icon icon="lucide:book-open" className="text-slate-400" />
              Manual Configuration
            </h2>
            
            <div className="mb-6">
              <label className="block text-[13px] font-semibold text-slate-700 mb-2">Webhook URL</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 block p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[13px] text-slate-800 font-mono break-all">
                  {webhookUrl}
                </code>
                <button 
                  onClick={() => navigator.clipboard.writeText(webhookUrl)}
                  className="p-2.5 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-500 hover:text-slate-700 transition-colors"
                  title="Copy to clipboard"
                >
                  <Icon icon="lucide:copy" className="text-[16px]" />
                </button>
              </div>
              <p className="text-[12px] text-slate-500 mt-2">
                Note: Bitbucket cloud requires a publicly accessible URL (like ngrok) if you are running this locally.
              </p>
            </div>

            <h3 className="text-[14px] font-semibold text-slate-800 mb-3">Steps:</h3>
            <ol className="list-decimal list-inside space-y-3 text-[13px] text-slate-600">
              <li>Go to your Bitbucket repository settings.</li>
              <li>Click on <strong>Webhooks</strong> in the left sidebar under the Workflow section.</li>
              <li>Click the <strong>Add webhook</strong> button.</li>
              <li>Set the Title to <strong>PR Guardian</strong>.</li>
              <li>Paste the Webhook URL from above.</li>
              <li>Under Triggers, select <strong>Choose from a full list of triggers</strong>.</li>
              <li>Check the <strong>Created</strong> box under the <strong>Pull Request</strong> section.</li>
              <li>Click <strong>Save</strong>.</li>
            </ol>
          </div>

          {/* Automatic Setup */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 mb-1 flex items-center gap-2">
              <Icon icon="lucide:wand-2" className="text-brand-500" />
              1-Click Setup
            </h2>
            <p className="text-[13px] text-slate-500 mb-6">
              Automatically register the webhook for your connected repositories using your Bitbucket App Password.
            </p>

            <div className="space-y-3">
              {loading ? (
                <div className="text-center text-slate-500 text-[13px] py-4">Loading repositories...</div>
              ) : repos.length === 0 ? (
                <div className="text-center text-slate-500 text-[13px] py-4">No connected repositories found. Go to Browse Repositories to add one.</div>
              ) : (
                repos.map(repo => (
                  <div key={repo.id} className="flex items-center justify-between p-3 border border-slate-200 rounded-lg bg-slate-50">
                    <div className="flex items-center gap-3 overflow-hidden">
                      <Icon icon="mdi:github" className="text-slate-400 text-[18px] shrink-0" />
                      <div className="truncate">
                        <div className="text-[13px] font-semibold text-slate-800 truncate">{repo.repo_slug}</div>
                        <div className="text-[11px] text-slate-500 truncate">{repo.workspace}</div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleAutoRegister(repo.id)}
                      disabled={registering === repo.id}
                      className="shrink-0 px-3 py-1.5 bg-white border border-slate-200 hover:bg-brand-50 hover:text-brand-600 hover:border-brand-200 text-slate-600 text-[12px] font-medium rounded-md transition-colors disabled:opacity-50 disabled:pointer-events-none"
                    >
                      {registering === repo.id ? 'Registering...' : 'Add Webhook'}
                    </button>
                  </div>
                ))
              )}
            </div>

          </div>

        </div>
      </div>
    </>
  );
}
