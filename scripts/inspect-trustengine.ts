import { createPublicClient, http, formatUnits, Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import * as dotenv from 'dotenv'

dotenv.config()

/**
 * TrustEngine Inspector
 * 
 * Provides visibility into the internal state of the TrustEngine contract:
 * - Configuration (fees, authorized addresses)
 * - User balances
 * - Recent events (deposits, withdrawals, settlements)
 */

const CONTRACTS = {
    TRUST_ENGINE: '0x1E43578CB0486a036dABcf5b9E31a037b6C27E96' as const,
    GATEWAY_SESSION: '0x9e1C3f4c1E14C19cd854F592dE6b3442B5a6A329' as const,
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
}

// Known addresses to check (add more as needed)
const KNOWN_ADDRESSES: { name: string; address: Address }[] = [
    { name: 'Your Wallet', address: process.env.WALLET_ADDRESS as Address || '0x14339ABF94Db70b7d29325C62e2209322C3A4de4' },
    // Add more known addresses here
]

const TRUST_ENGINE_ABI = [
    // Config
    { name: 'protocolFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'protocolFeeRecipient', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'arbitrationFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'arbitrationFeeRecipient', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'arbiter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'gatewaySession', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'validationBridge', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'solanaRelay', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'solanaSessionToken', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    // Balances
    { name: 'balances', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
    // Session info
    { name: 'sessionLocks', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
    { name: 'sessionInfo', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }] },
    // Deals
    {
        name: 'deals', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [
            { type: 'address', name: 'buyer' },
            { type: 'address', name: 'seller' },
            { type: 'address', name: 'token' },
            { type: 'uint256', name: 'amount' },
            { type: 'uint8', name: 'state' },
            { type: 'string', name: 'resultHash' },
            { type: 'string', name: 'judgmentCid' },
            { type: 'uint256', name: 'createdAt' },
            { type: 'bytes', name: 'metadata' },
            { type: 'bytes32', name: 'parentDealId' },
            { type: 'uint256', name: 'expiresAt' },
        ]
    },
] as const

const ERC20_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
    { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

// Event ABIs for fetching logs
const DEPOSITED_EVENT = {
    type: 'event',
    name: 'Deposited',
    inputs: [
        { indexed: true, name: 'user', type: 'address' },
        { indexed: true, name: 'token', type: 'address' },
        { indexed: false, name: 'amount', type: 'uint256' },
    ],
} as const

const WITHDRAWN_EVENT = {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
        { indexed: true, name: 'user', type: 'address' },
        { indexed: true, name: 'token', type: 'address' },
        { indexed: false, name: 'amount', type: 'uint256' },
    ],
} as const

const SESSION_LOCKED_EVENT = {
    type: 'event',
    name: 'SessionLocked',
    inputs: [
        { indexed: true, name: 'sessionId', type: 'bytes32' },
        { indexed: true, name: 'agent', type: 'address' },
        { indexed: true, name: 'provider', type: 'address' },
        { indexed: false, name: 'token', type: 'address' },
        { indexed: false, name: 'amount', type: 'uint256' },
    ],
} as const

const SESSION_UNLOCKED_EVENT = {
    type: 'event',
    name: 'SessionUnlocked',
    inputs: [
        { indexed: true, name: 'sessionId', type: 'bytes32' },
        { indexed: false, name: 'toProvider', type: 'uint256' },
        { indexed: false, name: 'refundedToAgent', type: 'uint256' },
    ],
} as const

const PROTOCOL_FEE_COLLECTED_EVENT = {
    type: 'event',
    name: 'ProtocolFeeCollected',
    inputs: [
        { indexed: true, name: 'refId', type: 'bytes32' },
        { indexed: true, name: 'token', type: 'address' },
        { indexed: false, name: 'amount', type: 'uint256' },
    ],
} as const

async function main() {
    const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org'),
    })

    console.log('═══════════════════════════════════════════════════════════════')
    console.log('🔍 TrustEngine Inspector (Base Sepolia)')
    console.log('═══════════════════════════════════════════════════════════════')
    console.log(`  Contract: ${CONTRACTS.TRUST_ENGINE}`)
    console.log(`  USDC: ${CONTRACTS.USDC}`)

    // ═══════════════════════════════════════════════════════════════════════
    // 1. Contract Configuration
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n📋 CONTRACT CONFIGURATION')
    console.log('───────────────────────────────────────────────────────────────')

    const [owner, protocolFeeBps, protocolFeeRecipient, arbitrationFeeBps, arbiter, gatewaySession, validationBridge, solanaRelay] = await Promise.all([
        publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'owner' }),
        publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'protocolFeeBps' }),
        publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'protocolFeeRecipient' }),
        publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'arbitrationFeeBps' }),
        publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'arbiter' }),
        publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'gatewaySession' }),
        publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'validationBridge' }),
        publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'solanaRelay' }),
    ])

    console.log(`  Owner:              ${owner}`)
    console.log(`  Protocol Fee:       ${Number(protocolFeeBps) / 100}% (${protocolFeeBps} bps)`)
    console.log(`  Fee Recipient:      ${protocolFeeRecipient}`)
    console.log(`  Arbitration Fee:    ${Number(arbitrationFeeBps) / 100}% (${arbitrationFeeBps} bps)`)
    console.log(`  Arbiter:            ${arbiter === '0x0000000000000000000000000000000000000000' ? '(not set)' : arbiter}`)
    console.log(`  GatewaySession:     ${gatewaySession}`)
    console.log(`  ValidationBridge:   ${validationBridge === '0x0000000000000000000000000000000000000000' ? '(not set)' : validationBridge}`)
    console.log(`  Solana Relay:       ${solanaRelay === '0x0000000000000000000000000000000000000000' ? '(not set)' : solanaRelay}`)

    // ═══════════════════════════════════════════════════════════════════════
    // 2. Contract USDC Balance (Total Held)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n💰 CONTRACT USDC HOLDINGS')
    console.log('───────────────────────────────────────────────────────────────')

    const contractUSDC = await publicClient.readContract({
        address: CONTRACTS.USDC,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [CONTRACTS.TRUST_ENGINE],
    })
    console.log(`  Total USDC in contract: ${formatUnits(contractUSDC, 6)} USDC`)

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Known Address Balances
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n👥 INTERNAL BALANCES (Known Addresses)')
    console.log('───────────────────────────────────────────────────────────────')

    let totalInternalBalances = 0n
    for (const { name, address } of KNOWN_ADDRESSES) {
        const balance = await publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'balances',
            args: [address, CONTRACTS.USDC],
        })
        totalInternalBalances += balance
        if (balance > 0n) {
            console.log(`  ${name}: ${formatUnits(balance, 6)} USDC`)
            console.log(`    └─ ${address}`)
        }
    }

    // Check fee recipient balance
    const feeRecipientBalance = await publicClient.readContract({
        address: CONTRACTS.TRUST_ENGINE,
        abi: TRUST_ENGINE_ABI,
        functionName: 'balances',
        args: [protocolFeeRecipient, CONTRACTS.USDC],
    })
    if (feeRecipientBalance > 0n && protocolFeeRecipient !== KNOWN_ADDRESSES[0]?.address) {
        console.log(`  Fee Recipient: ${formatUnits(feeRecipientBalance, 6)} USDC`)
        console.log(`    └─ ${protocolFeeRecipient}`)
        totalInternalBalances += feeRecipientBalance
    }

    console.log(`\n  📊 Total tracked internal balances: ${formatUnits(totalInternalBalances, 6)} USDC`)
    console.log(`  📊 Contract holds: ${formatUnits(contractUSDC, 6)} USDC`)
    console.log(`  📊 Difference (locked in sessions/deals): ${formatUnits(contractUSDC - totalInternalBalances, 6)} USDC`)

    // ═══════════════════════════════════════════════════════════════════════
    // 4. Recent Events (last 1000 blocks)
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n📜 RECENT ACTIVITY (last ~1000 blocks)')
    console.log('───────────────────────────────────────────────────────────────')

    const currentBlock = await publicClient.getBlockNumber()
    const fromBlock = currentBlock - 1000n

    // Deposits
    const depositLogs = await publicClient.getLogs({
        address: CONTRACTS.TRUST_ENGINE,
        event: DEPOSITED_EVENT,
        fromBlock,
        toBlock: currentBlock,
    })

    console.log(`\n  💵 Deposits (${depositLogs.length} total):`)
    for (const log of depositLogs.slice(-5)) {
        const amount = formatUnits(log.args.amount || 0n, 6)
        const user = log.args.user?.slice(0, 10) + '...'
        console.log(`    ${user} deposited ${amount} USDC (block ${log.blockNumber})`)
    }
    if (depositLogs.length > 5) console.log(`    ... and ${depositLogs.length - 5} more`)

    // Withdrawals
    const withdrawLogs = await publicClient.getLogs({
        address: CONTRACTS.TRUST_ENGINE,
        event: WITHDRAWN_EVENT,
        fromBlock,
        toBlock: currentBlock,
    })

    console.log(`\n  💸 Withdrawals (${withdrawLogs.length} total):`)
    for (const log of withdrawLogs.slice(-5)) {
        const amount = formatUnits(log.args.amount || 0n, 6)
        const user = log.args.user?.slice(0, 10) + '...'
        console.log(`    ${user} withdrew ${amount} USDC (block ${log.blockNumber})`)
    }
    if (withdrawLogs.length > 5) console.log(`    ... and ${withdrawLogs.length - 5} more`)

    // Session Locks
    const sessionLockLogs = await publicClient.getLogs({
        address: CONTRACTS.TRUST_ENGINE,
        event: SESSION_LOCKED_EVENT,
        fromBlock,
        toBlock: currentBlock,
    })

    console.log(`\n  🔒 Session Locks (${sessionLockLogs.length} total):`)
    for (const log of sessionLockLogs.slice(-5)) {
        const amount = formatUnits(log.args.amount || 0n, 6)
        const agent = log.args.agent?.slice(0, 10) + '...'
        console.log(`    ${agent} locked ${amount} USDC (block ${log.blockNumber})`)
    }
    if (sessionLockLogs.length > 5) console.log(`    ... and ${sessionLockLogs.length - 5} more`)

    // Session Unlocks
    const sessionUnlockLogs = await publicClient.getLogs({
        address: CONTRACTS.TRUST_ENGINE,
        event: SESSION_UNLOCKED_EVENT,
        fromBlock,
        toBlock: currentBlock,
    })

    console.log(`\n  🔓 Session Unlocks (${sessionUnlockLogs.length} total):`)
    for (const log of sessionUnlockLogs.slice(-5)) {
        const toProvider = formatUnits(log.args.toProvider || 0n, 6)
        const refund = formatUnits(log.args.refundedToAgent || 0n, 6)
        console.log(`    Provider got ${toProvider} USDC, Agent refund ${refund} USDC (block ${log.blockNumber})`)
    }
    if (sessionUnlockLogs.length > 5) console.log(`    ... and ${sessionUnlockLogs.length - 5} more`)

    // Protocol Fees
    const feeLogs = await publicClient.getLogs({
        address: CONTRACTS.TRUST_ENGINE,
        event: PROTOCOL_FEE_COLLECTED_EVENT,
        fromBlock,
        toBlock: currentBlock,
    })

    let totalFees = 0n
    for (const log of feeLogs) {
        totalFees += log.args.amount || 0n
    }

    console.log(`\n  🏦 Protocol Fees Collected (${feeLogs.length} events):`)
    console.log(`    Total: ${formatUnits(totalFees, 6)} USDC`)

    // ═══════════════════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════════════════
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('📊 SUMMARY')
    console.log('═══════════════════════════════════════════════════════════════')
    console.log(`  Contract USDC:      ${formatUnits(contractUSDC, 6)} USDC`)
    console.log(`  Internal Balances:  ${formatUnits(totalInternalBalances, 6)} USDC`)
    console.log(`  In Sessions/Deals:  ${formatUnits(contractUSDC - totalInternalBalances, 6)} USDC`)
    console.log(`  Fees Collected:     ${formatUnits(totalFees, 6)} USDC (last 1000 blocks)`)
    console.log(`  Deposits:           ${depositLogs.length}`)
    console.log(`  Withdrawals:        ${withdrawLogs.length}`)
    console.log(`  Sessions Opened:    ${sessionLockLogs.length}`)
    console.log(`  Sessions Settled:   ${sessionUnlockLogs.length}`)
    console.log('═══════════════════════════════════════════════════════════════\n')
}

main().catch(console.error)
