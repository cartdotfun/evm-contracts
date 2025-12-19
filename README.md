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
| TrustEngine | `0x0D5510C3c5B5f1DFf9721425900fF8A6FcC5A09D` |
| GatewaySession | `0x5acCdB4df55a5524bc36E288E5040602CDF4383b` |

## Testing

The test suite includes:
- **Unit tests**: Basic functionality
- **Stress tests**: 100+ concurrent sessions
- **Extreme tests**: 1000 sessions, 1000 usage recordings
- **Nuclear tests**: 10,000 sessions, 10,000 usage recordings

## License

MIT
