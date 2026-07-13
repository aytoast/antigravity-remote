const providers = {
  antigravity: { label: 'Antigravity', logo: '/antigravity-desktop.png' },
  codex: { label: 'Codex', logo: '/codex-logo.png' }
};

export function ProviderBadge({ provider = 'antigravity', compact = false }) {
  const { label, logo } = providers[provider] || providers.antigravity;
  return <span
    className={`provider-badge provider-${provider}${compact ? ' is-compact' : ''}`}
    aria-label={`${label} provider`}
    title={label}
  >
    <img className="provider-logo" src={logo} alt="" aria-hidden="true" />
    {!compact && <span>{label}</span>}
  </span>;
}
