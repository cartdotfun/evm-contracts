# Cart Protocol - EVM Contracts

Smart contracts for Cart Protocol's M2M commerce infrastructure on EVM chains.

## Contracts

| Contract | Description |
|----------|-------------|
| **GatewaySession** | x402-style payment sessions for API monetization |
| **TrustEngine** | Core escrow, balance management, and cross-chain settlement |
| **IdentityRegistry** | On-chain agent identity (ERC-721) |
| **ReputationRegistry** | Agent reputation and feedback system |
| **ValidationBridge** | Connects TrustEngine to ERC-8004 identity |

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
# Edit .env with your private key and RPC

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

## Testing

The test suite includes:
- **Unit tests**: Basic functionality
- **Stress tests**: 100+ concurrent sessions
- **Extreme tests**: 1000 sessions, 1000 usage recordings
- **Nuclear tests**: 10,000 sessions, 10,000 usage recordings

## License

MIT
