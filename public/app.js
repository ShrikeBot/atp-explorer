// ATP Explorer Frontend
const API_BASE = '/v1';

// --- API Calls ---

async function fetchStats() {
  const res = await fetch(`${API_BASE}/stats`);
  return res.json();
}

async function fetchIdentities() {
  const res = await fetch(`${API_BASE}/identities`);
  return res.json();
}

async function fetchIdentity(fingerprint) {
  const res = await fetch(`${API_BASE}/identities/${fingerprint}`);
  return res.json();
}

async function searchIdentities(query) {
  const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(query)}`);
  return res.json();
}

// --- Rendering ---

function getPlatformIcon(platform) {
  const icons = {
    twitter: '𝕏',
    github: '⌨',
    moltbook: '🦞',
    reddit: '📡',
    discord: '💬',
    telegram: '✈',
  };
  return icons[platform.toLowerCase()] || '🔗';
}

function renderAgentCard(agent) {
  const hasProof = agent.proofOfExistence?.txid;
  const isMainnet = agent.proofOfExistence?.network === 'mainnet';
  
  const platformsHtml = agent.platforms 
    ? Object.entries(agent.platforms).map(([platform, handle]) => `
        <span class="platform-badge">
          ${getPlatformIcon(platform)}
          <span class="handle">@${handle}</span>
        </span>
      `).join('')
    : '';
  
  const proofHtml = hasProof 
    ? `<div class="agent-proof ${isMainnet ? '' : 'testnet'}">
        ⛓ ${isMainnet ? 'Bitcoin Mainnet' : 'Testnet'} verified
       </div>`
    : '';

  return `
    <div class="agent-card" data-fingerprint="${agent.gpgFingerprint}">
      <div class="agent-name">
        ${agent.name || 'Unknown Agent'}
        ${hasProof && isMainnet ? '<span class="verified-badge">✓</span>' : ''}
      </div>
      <div class="agent-fingerprint">${agent.gpgFingerprint || 'No fingerprint'}</div>
      <div class="agent-platforms">${platformsHtml}</div>
      ${proofHtml}
    </div>
  `;
}

function renderAgentDetail(agent) {
  const proofSection = agent.proofOfExistence ? `
    <div class="detail-section">
      <h3>Proof of Existence</h3>
      <p>Network: ${agent.proofOfExistence.network}</p>
      <p>TX: <a href="https://blockstream.info${agent.proofOfExistence.network === 'testnet' ? '/testnet' : ''}/tx/${agent.proofOfExistence.txid}" target="_blank">
        ${agent.proofOfExistence.txid}
      </a></p>
      <p>OP_RETURN: ${agent.proofOfExistence.opReturn}</p>
    </div>
  ` : '';

  const walletsSection = agent.wallets ? `
    <div class="detail-section">
      <h3>Wallets</h3>
      ${Object.entries(agent.wallets).map(([chain, addr]) => `
        <p>${chain.toUpperCase()}: ${addr}</p>
      `).join('')}
    </div>
  ` : '';

  const platformsSection = agent.platforms ? `
    <div class="detail-section">
      <h3>Platforms</h3>
      ${Object.entries(agent.platforms).map(([platform, handle]) => `
        <p>${platform}: @${handle}</p>
      `).join('')}
    </div>
  ` : '';

  return `
    <div class="detail-section">
      <h3>Name</h3>
      <p>${agent.name || 'Unknown'}</p>
    </div>
    <div class="detail-section">
      <h3>GPG Fingerprint</h3>
      <p>${agent.gpgFingerprint}</p>
      ${agent.gpgKeyserver ? `<p>Keyserver: ${agent.gpgKeyserver}</p>` : ''}
    </div>
    ${platformsSection}
    ${walletsSection}
    ${proofSection}
    <div class="detail-section">
      <h3>Created</h3>
      <p>${agent.created ? new Date(agent.created * 1000).toISOString() : 'Unknown'}</p>
    </div>
  `;
}

// --- Event Handlers ---

function showModal(content) {
  document.getElementById('modalBody').innerHTML = content;
  document.getElementById('modal').classList.remove('hidden');
}

function hideModal() {
  document.getElementById('modal').classList.add('hidden');
}

async function handleCardClick(fingerprint) {
  try {
    const agent = await fetchIdentity(fingerprint);
    showModal(renderAgentDetail(agent));
  } catch (err) {
    console.error('Failed to load agent:', err);
  }
}

async function handleSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) {
    loadAgents();
    return;
  }
  
  try {
    const results = await searchIdentities(query);
    const container = document.getElementById('agentList');
    
    if (results.results.length === 0) {
      container.innerHTML = '<p class="loading">No agents found</p>';
      return;
    }
    
    container.innerHTML = results.results.map(renderAgentCard).join('');
    attachCardListeners();
  } catch (err) {
    console.error('Search failed:', err);
  }
}

function attachCardListeners() {
  document.querySelectorAll('.agent-card').forEach(card => {
    card.addEventListener('click', () => {
      handleCardClick(card.dataset.fingerprint);
    });
  });
}

// --- Init ---

async function loadStats() {
  try {
    const stats = await fetchStats();
    document.getElementById('totalAgents').textContent = stats.totalIdentities;
    document.getElementById('totalPlatforms').textContent = Object.keys(stats.platforms).length;
    document.getElementById('totalChains').textContent = Object.keys(stats.chains || {}).length;
  } catch (err) {
    console.error('Failed to load stats:', err);
  }
}

async function loadAgents() {
  try {
    const data = await fetchIdentities();
    const container = document.getElementById('agentList');
    
    if (data.identities.length === 0) {
      container.innerHTML = '<p class="loading">No agents registered yet</p>';
      return;
    }
    
    container.innerHTML = data.identities.map(renderAgentCard).join('');
    attachCardListeners();
  } catch (err) {
    console.error('Failed to load agents:', err);
    document.getElementById('agentList').innerHTML = 
      '<p class="loading">Failed to load agents. Is the API running?</p>';
  }
}

// Event listeners
document.getElementById('searchBtn').addEventListener('click', handleSearch);
document.getElementById('searchInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') handleSearch();
});
document.querySelector('.modal-close').addEventListener('click', hideModal);
document.getElementById('modal').addEventListener('click', (e) => {
  if (e.target.id === 'modal') hideModal();
});

// Load initial data
loadStats();
loadAgents();
