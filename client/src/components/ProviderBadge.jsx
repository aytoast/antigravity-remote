import { Bot, Sparkles } from 'lucide-react';

const providers = {
  antigravity: { label: 'Antigravity', Icon: Sparkles },
  codex: { label: 'Codex', Icon: Bot }
};

export function ProviderBadge({ provider = 'antigravity', compact = false }) {
  const { label, Icon } = providers[provider] || providers.antigravity;
  return <span
    className={`provider-badge provider-${provider}${compact ? ' is-compact' : ''}`}
    aria-label={`${label} provider`}
    title={label}
  >
    <Icon size={compact ? 10 : 11} strokeWidth={2.2} aria-hidden="true" />
    {!compact && <span>{label}</span>}
  </span>;
}
