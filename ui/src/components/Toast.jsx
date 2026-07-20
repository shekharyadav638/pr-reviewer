import { Icon } from '@iconify/react';
import { useEffect } from 'react';

export default function Toast({ message, type = 'error', onDismiss }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  const styles = type === 'error'
    ? 'bg-rose-50 border-rose-200 text-rose-700'
    : 'bg-emerald-50 border-emerald-200 text-emerald-700';
  const icon = type === 'error' ? 'lucide:alert-circle' : 'lucide:check-circle-2';

  return (
    <div className={`fixed bottom-6 right-6 z-50 flex items-start gap-3 max-w-md border rounded-xl shadow-lg px-4 py-3 ${styles}`}>
      <Icon icon={icon} className="text-[18px] mt-0.5 shrink-0" />
      <p className="text-[13px] font-medium leading-snug">{message}</p>
      <button onClick={onDismiss} className="ml-auto shrink-0 opacity-60 hover:opacity-100 transition-opacity">
        <Icon icon="lucide:x" className="text-[16px]" />
      </button>
    </div>
  );
}
