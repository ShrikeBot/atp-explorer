#!/usr/bin/env node
/**
 * ATP Explorer API
 * Decentralized agent discovery via Agent Trust Protocol
 */

import express from 'express';
import cors from 'cors';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.ATP_EXPLORER_PORT || 3847;

// Registry path - defaults to sibling atp-registry
const REGISTRY_PATH = process.env.ATP_REGISTRY_PATH || 
  join(__dirname, '../../atp-registry');

app.use(cors());
app.use(express.json());

// --- Data Loading ---

function normalizeIdentity(raw) {
  // Normalize different registry formats to consistent API format
  return {
    atp: raw.atp || '0.4',
    type: raw.type || 'identity',
    name: raw.name,
    description: raw.description,
    gpgFingerprint: raw.gpg?.fingerprint || raw.gpgFingerprint,
    gpgKeyserver: raw.gpg?.keyserver || raw.gpgKeyserver,
    platforms: raw.platforms || {},
    wallets: raw.wallet ? { btc: raw.wallet.address } : (raw.wallets || {}),
    walletProof: raw.wallet?.proof || raw.walletProof,
    bindingProofs: raw.binding_proofs || raw.bindingProofs || [],
    proofOfExistence: raw.proofOfExistence || raw.proof_of_existence,
    created: raw.created,
    signature: raw.signature
  };
}

function loadRegistry() {
  const identities = [];
  const identitiesDir = join(REGISTRY_PATH, 'identities');
  
  if (!existsSync(identitiesDir)) {
    console.warn(`Registry not found at ${identitiesDir}`);
    return { identities: [], indexes: {} };
  }

  const files = readdirSync(identitiesDir).filter(f => f.endsWith('.json'));
  
  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(identitiesDir, file), 'utf-8'));
      const identity = normalizeIdentity(raw);
      identities.push(identity);
    } catch (err) {
      console.warn(`Failed to load ${file}:`, err.message);
    }
  }

  // Build indexes
  const indexes = {
    byFingerprint: {},
    byName: {},
    byPlatform: {},
    byWallet: {}
  };

  for (const identity of identities) {
    // By fingerprint (full and short forms)
    if (identity.gpgFingerprint) {
      const fp = identity.gpgFingerprint.toLowerCase();
      indexes.byFingerprint[fp] = identity;
      // Short forms: last 16, last 8 chars
      indexes.byFingerprint[fp.slice(-16)] = identity;
      indexes.byFingerprint[fp.slice(-8)] = identity;
    }

    // By name (case-insensitive)
    if (identity.name) {
      indexes.byName[identity.name.toLowerCase()] = identity;
    }

    // By platform handles
    if (identity.platforms) {
      for (const [platform, handle] of Object.entries(identity.platforms)) {
        const p = platform.toLowerCase();
        if (!indexes.byPlatform[p]) {
          indexes.byPlatform[p] = {};
        }
        indexes.byPlatform[p][handle.toLowerCase()] = identity;
      }
    }

    // By wallet addresses
    if (identity.wallets) {
      for (const [chain, address] of Object.entries(identity.wallets)) {
        if (address) {
          indexes.byWallet[address.toLowerCase()] = identity;
        }
      }
    }
  }

  return { identities, indexes };
}

let registry = loadRegistry();

// Reload registry periodically (every 5 min)
setInterval(() => {
  registry = loadRegistry();
  console.log(`Registry reloaded: ${registry.identities.length} identities`);
}, 5 * 60 * 1000);

// --- API Routes ---

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    protocol: 'ATP',
    version: '0.4',
    identityCount: registry.identities.length 
  });
});

// Protocol info
app.get('/v1', (req, res) => {
  res.json({
    protocol: 'Agent Trust Protocol',
    version: '0.4',
    spec: 'https://github.com/ShrikeBot/agent-trust-protocol',
    endpoints: {
      identities: '/v1/identities',
      lookup: {
        byFingerprint: '/v1/identities/:fingerprint',
        byName: '/v1/lookup/name/:name',
        byPlatform: '/v1/lookup/platform/:platform/:handle',
        byWallet: '/v1/lookup/wallet/:address'
      },
      search: '/v1/search?q=query',
      stats: '/v1/stats'
    }
  });
});

// List all identities
app.get('/v1/identities', (req, res) => {
  const { limit = 100, offset = 0 } = req.query;
  const l = Math.min(parseInt(limit) || 100, 1000);
  const o = parseInt(offset) || 0;

  const results = registry.identities.slice(o, o + l).map(summarize);
  
  res.json({
    total: registry.identities.length,
    limit: l,
    offset: o,
    identities: results
  });
});

// Get identity by fingerprint
app.get('/v1/identities/:fingerprint', (req, res) => {
  const fp = req.params.fingerprint.toLowerCase();
  const identity = registry.indexes.byFingerprint[fp];
  
  if (!identity) {
    return res.status(404).json({ error: 'Identity not found', fingerprint: req.params.fingerprint });
  }
  
  res.json(identity);
});

// Lookup by name
app.get('/v1/lookup/name/:name', (req, res) => {
  const name = req.params.name.toLowerCase();
  const identity = registry.indexes.byName[name];
  
  if (!identity) {
    return res.status(404).json({ error: 'No identity found', name: req.params.name });
  }
  
  res.json(identity);
});

// Lookup by platform handle
app.get('/v1/lookup/platform/:platform/:handle', (req, res) => {
  const { platform, handle } = req.params;
  const platformIndex = registry.indexes.byPlatform[platform.toLowerCase()];
  
  if (!platformIndex) {
    return res.status(404).json({ 
      error: 'Platform not indexed', 
      platform,
      availablePlatforms: Object.keys(registry.indexes.byPlatform)
    });
  }
  
  const identity = platformIndex[handle.toLowerCase()];
  
  if (!identity) {
    return res.status(404).json({ error: 'No identity found', platform, handle });
  }
  
  res.json(identity);
});

// Lookup by wallet address
app.get('/v1/lookup/wallet/:address', (req, res) => {
  const address = req.params.address.toLowerCase();
  const identity = registry.indexes.byWallet[address];
  
  if (!identity) {
    return res.status(404).json({ error: 'No identity found', address: req.params.address });
  }
  
  res.json(identity);
});

// Search across identities
app.get('/v1/search', (req, res) => {
  const { q, limit = 20 } = req.query;
  
  if (!q || q.length < 2) {
    return res.status(400).json({ error: 'Query must be at least 2 characters' });
  }
  
  const query = q.toLowerCase();
  const l = Math.min(parseInt(limit) || 20, 100);
  
  const results = registry.identities.filter(identity => {
    // Search in name
    if (identity.name?.toLowerCase().includes(query)) return true;
    
    // Search in description
    if (identity.description?.toLowerCase().includes(query)) return true;
    
    // Search in platform handles
    if (identity.platforms) {
      for (const handle of Object.values(identity.platforms)) {
        if (handle.toLowerCase().includes(query)) return true;
      }
    }
    
    // Search in fingerprint
    if (identity.gpgFingerprint?.toLowerCase().includes(query)) return true;
    
    return false;
  }).slice(0, l).map(summarize);
  
  res.json({
    query: q,
    count: results.length,
    results
  });
});

// Stats endpoint
app.get('/v1/stats', (req, res) => {
  const platforms = {};
  const chains = {};
  
  for (const identity of registry.identities) {
    if (identity.platforms) {
      for (const platform of Object.keys(identity.platforms)) {
        platforms[platform] = (platforms[platform] || 0) + 1;
      }
    }
    if (identity.wallets) {
      for (const chain of Object.keys(identity.wallets)) {
        if (identity.wallets[chain]) {
          chains[chain] = (chains[chain] || 0) + 1;
        }
      }
    }
  }
  
  res.json({
    totalIdentities: registry.identities.length,
    platforms,
    chains,
    lastUpdated: new Date().toISOString()
  });
});

// --- Helpers ---

function summarize(identity) {
  return {
    name: identity.name,
    gpgFingerprint: identity.gpgFingerprint,
    description: identity.description,
    platforms: identity.platforms,
    proofOfExistence: identity.proofOfExistence ? {
      txid: identity.proofOfExistence.txid,
      network: identity.proofOfExistence.network
    } : null
  };
}

// --- Start Server ---

app.listen(PORT, () => {
  console.log(`\n🔍 ATP Explorer API`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Registry: ${REGISTRY_PATH}`);
  console.log(`   Identities: ${registry.identities.length}`);
  console.log(`\n   Endpoints:`);
  console.log(`   GET /health`);
  console.log(`   GET /v1/identities`);
  console.log(`   GET /v1/identities/:fingerprint`);
  console.log(`   GET /v1/lookup/name/:name`);
  console.log(`   GET /v1/lookup/platform/:platform/:handle`);
  console.log(`   GET /v1/lookup/wallet/:address`);
  console.log(`   GET /v1/search?q=query`);
  console.log(`   GET /v1/stats\n`);
});
