# Cart Protocol - EVM Contracts

EVM smart contracts for Cart Protocol's Machine 2 Machine (M2M) commerce infrastructure.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌────────────────────┐
│  GatewaySession │────▶│   TrustEngine    │◀────│  ValidationBridge  │
│  (x402 Sessions)│     │  (Vault + Escrow)│     │  (AI Arbitration)  │
└─────────────────┘     └──────────────────┘     └────────────────────┘
                               │
                               ▼
                   ┌────────────────────────┐
                   │    IdentityRegistry    │
                   │      (ERC-721 NFT)     │
                   └────────────┬───────────┘
                               │
                               ▼
                   ┌────────────────────────┐
                   │   ReputationRegistry   │
                   │    (Feedback Scores)   │
                   └────────────────────────┘
```

## Contracts

| Contract | Description |
|----------|-------------|
| **TrustEngine** | Core singleton vault. Manages USDC deposits/withdrawals, internal balance accounting, deal escrow, and cross-chain settlement from Solana. |
| **GatewaySession** | x402-style payment sessions for API monetization. Gateways register endpoints, agents pre-fund sessions, providers record usage, then settle in batches. |
| **IdentityRegistry** | ERC-721 NFT-based agent identity. Each registered agent gets a unique token ID with on-chain metadata storage per ERC-8004. |
| **ReputationRegistry** | On-chain feedback and reputation aggregation. Tracks scores per agent, per skill tag, with ERC-8004 compliant signature-authorized feedback. |
| **ValidationBridge** | Connects TrustEngine deals to ERC-8004 validation pattern. Enables AI arbiters to validate work and trigger conditional fund release based on validation scores. |

## Quick Start

```bash
# Install dependencies
npm install

# Compile contracts
npm run compile

# Run tests
npm test

# Run stress tests with gas reporting
npm run test:gas
```

## Deployment

```bash
# Set environment variables
cp .env.example .env
# Edit .env with your private key

# Deploy to Base Sepolia
npm run deploy:sepolia
```

## Deployed Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| TrustEngine | `0x1E43578CB0486a036dABcf5b9E31a037b6C27E96` |
| GatewaySession | `0x9e1C3f4c1E14C19cd854F592dE6b3442B5a6A329` |
| IdentityRegistry | `0xAE0Edd86230532d94Ff50a9dE923bCe81Cb8331C` |
| ReputationRegistry | `0xCCdBaE4be2FD7983cA2a24524b05BF356E4395E1` |
| ValidationBridge | `0xC6db64c7cbA9D8747d18b3a80fE4BAac579d2d77` |

## Key Flows

### Gateway Registration & Usage
1. Provider calls `GatewaySession.registerGateway(slug, pricePerRequest)`
2. Agent calls `GatewaySession.openSession(slug, token, deposit, duration)`
3. Proxy records usage via `GatewaySession.recordUsage(sessionId, amount)`
4. Either party calls `GatewaySession.settleSession(sessionId)` to distribute funds

### Deal Escrow & Validation
1. Buyer deposits USDC via `TrustEngine.deposit(token, amount)`
2. Buyer creates deal: `TrustEngine.createDeal(dealId, seller, token, amount, ...)`
3. Seller submits work: `TrustEngine.submitWork(dealId, resultHash)`
4. Arbiter validates via `ValidationBridge.validationResponse(requestHash, score, ...)`
5. Funds release automatically if score meets threshold

### Cross-Chain Settlement (Solana → Base)
1. Solana program emits settlement proof
2. Relay service calls `TrustEngine.settleFromSolana(sessionId, agent, provider, amount)`
3. Funds transfer from agent's balance to provider on Base

## Testing

The test suite includes:
- **Unit tests**: Basic functionality
- **Stress tests**: 100+ concurrent sessions
- **Extreme tests**: 1000 sessions, 1000 usage recordings
- **Nuclear tests**: 10,000 sessions, 10,000 usage recordings

## License

MIT
