import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, keccak256, toBytes, decodeEventLog } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'

dotenv.config()

/**
 * E2E Integration Tests for Cart Protocol on Base Sepolia
 * 
 * Tests against LIVE deployed contracts:
 * - TrustEngine: 0x1E43578CB0486a036dABcf5b9E31a037b6C27E96
 * - GatewaySession: 0x9e1C3f4c1E14C19cd854F592dE6b3442B5a6A329
 * - IdentityRegistry: 0xAE0Edd86230532d94Ff50a9dE923bCe81Cb8331C
 * - ReputationRegistry: 0xCCdBaE4be2FD7983cA2a24524b05BF356E4395E1
 * - ValidationBridge: 0xC6db64c7cbA9D8747d18b3a80fE4BAac579d2d77
 */

// Helper: wait for RPC propagation
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const RPC_DELAY = 3000 // 3 seconds for testnet propagation

// Contract addresses (Base Sepolia)
const CONTRACTS = {
    TRUST_ENGINE: '0x1E43578CB0486a036dABcf5b9E31a037b6C27E96' as const,
    GATEWAY_SESSION: '0x9e1C3f4c1E14C19cd854F592dE6b3442B5a6A329' as const,
    IDENTITY_REGISTRY: '0xAE0Edd86230532d94Ff50a9dE923bCe81Cb8331C' as const,
    REPUTATION_REGISTRY: '0xCCdBaE4be2FD7983cA2a24524b05BF356E4395E1' as const,
    VALIDATION_BRIDGE: '0xC6db64c7cbA9D8747d18b3a80fE4BAac579d2d77' as const,
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const, // Base Sepolia USDC
}

// Minimal ABIs for testing
const TRUST_ENGINE_ABI = [
    { name: 'balances', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
    { name: 'deposit', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_token' }, { type: 'uint256', name: '_amount' }], outputs: [] },
    { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_token' }, { type: 'uint256', name: '_amount' }], outputs: [] },
    { name: 'protocolFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'protocolFeeRecipient', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'gatewaySession', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'arbiter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'solanaRelay', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
] as const

const GATEWAY_SESSION_ABI = [
    { name: 'trustEngine', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'gateways', type: 'function', stateMutability: 'view', inputs: [{ type: 'string' }], outputs: [{ type: 'address' }] },
    { name: 'gatewayPricing', type: 'function', stateMutability: 'view', inputs: [{ type: 'string' }], outputs: [{ type: 'uint256' }] },
    { name: 'registerGateway', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'string', name: '_slug' }, { type: 'uint256', name: '_pricePerRequest' }], outputs: [] },
    { name: 'openSession', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'string', name: '_gatewaySlug' }, { type: 'address', name: '_token' }, { type: 'uint256', name: '_deposit' }, { type: 'uint256', name: '_duration' }], outputs: [{ type: 'bytes32' }] },
    { name: 'recordUsage', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32', name: '_sessionId' }, { type: 'uint256', name: '_amount' }], outputs: [] },
    { name: 'settleSession', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'bytes32', name: '_sessionId' }], outputs: [] },
    { name: 'getSession', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'string' }] },
    { name: 'sessions', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint8' }, { type: 'string' }] },
    { name: 'isSessionValid', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
    { name: 'getRemainingCredits', type: 'function', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
    { name: 'MAX_SESSION_DURATION', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'MAX_SLUG_LENGTH', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
] as const

const SESSION_OPENED_EVENT = {
    type: 'event',
    name: 'SessionOpened',
    inputs: [
        { indexed: true, name: 'sessionId', type: 'bytes32' },
        { indexed: true, name: 'agent', type: 'address' },
        { indexed: true, name: 'provider', type: 'address' },
        { indexed: false, name: 'gatewaySlug', type: 'string' },
        { indexed: false, name: 'depositAmount', type: 'uint256' },
        { indexed: false, name: 'expiresAt', type: 'uint256' },
    ],
} as const

const ERC20_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
    { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'spender' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }] },
    { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
    { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
    { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

// Test results tracking
interface TestResult {
    name: string
    passed: boolean
    error?: string
    duration?: number
}

class E2ETestRunner {
    private publicClient
    private walletClient
    private account
    private results: TestResult[] = []

    constructor() {
        const privateKey = process.env.PRIVATE_KEY
        if (!privateKey) throw new Error('PRIVATE_KEY not set in .env')

        this.account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}`)

        this.publicClient = createPublicClient({
            chain: baseSepolia,
            transport: http(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org'),
        })

        this.walletClient = createWalletClient({
            account: this.account,
            chain: baseSepolia,
            transport: http(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org'),
        })
    }

    async runTest(name: string, testFn: () => Promise<void>) {
        const start = Date.now()
        try {
            await testFn()
            this.results.push({ name, passed: true, duration: Date.now() - start })
            console.log(`  ✅ ${name}`)
        } catch (error: any) {
            this.results.push({ name, passed: false, error: error.message, duration: Date.now() - start })
            console.log(`  ❌ ${name}: ${error.message}`)
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. Contract Configuration Tests
    // ═══════════════════════════════════════════════════════════════════════
    async testContractConfiguration() {
        console.log('\n📋 1. Contract Configuration Tests')

        await this.runTest('TrustEngine has correct GatewaySession linked', async () => {
            const linkedGateway = await this.publicClient.readContract({
                address: CONTRACTS.TRUST_ENGINE,
                abi: TRUST_ENGINE_ABI,
                functionName: 'gatewaySession',
            })
            if (linkedGateway.toLowerCase() !== CONTRACTS.GATEWAY_SESSION.toLowerCase()) {
                throw new Error(`Expected ${CONTRACTS.GATEWAY_SESSION}, got ${linkedGateway}`)
            }
        })

        await this.runTest('GatewaySession has correct TrustEngine linked', async () => {
            const linkedTrustEngine = await this.publicClient.readContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'trustEngine',
            })
            if (linkedTrustEngine.toLowerCase() !== CONTRACTS.TRUST_ENGINE.toLowerCase()) {
                throw new Error(`Expected ${CONTRACTS.TRUST_ENGINE}, got ${linkedTrustEngine}`)
            }
        })

        await this.runTest('Protocol fee is configured', async () => {
            const feeBps = await this.publicClient.readContract({
                address: CONTRACTS.TRUST_ENGINE,
                abi: TRUST_ENGINE_ABI,
                functionName: 'protocolFeeBps',
            })
            console.log(`    Fee: ${Number(feeBps) / 100}%`)
            if (feeBps > 1000n) throw new Error(`Fee ${feeBps} exceeds max 10%`)
        })

        await this.runTest('Protocol fee recipient is set', async () => {
            const recipient = await this.publicClient.readContract({
                address: CONTRACTS.TRUST_ENGINE,
                abi: TRUST_ENGINE_ABI,
                functionName: 'protocolFeeRecipient',
            })
            if (recipient === '0x0000000000000000000000000000000000000000') {
                throw new Error('Fee recipient is zero address')
            }
            console.log(`    Recipient: ${recipient}`)
        })

        await this.runTest('MAX_SESSION_DURATION is 7 days', async () => {
            const maxDuration = await this.publicClient.readContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'MAX_SESSION_DURATION',
            })
            const sevenDays = BigInt(7 * 24 * 60 * 60)
            if (maxDuration !== sevenDays) {
                throw new Error(`Expected ${sevenDays}, got ${maxDuration}`)
            }
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 2. Balance and Deposit Tests
    // ═══════════════════════════════════════════════════════════════════════
    async testBalancesAndDeposits() {
        console.log('\n💰 2. Balance and Deposit Tests')

        await this.runTest('Can read USDC balance', async () => {
            const balance = await this.publicClient.readContract({
                address: CONTRACTS.USDC,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [this.account.address],
            })
            console.log(`    Wallet USDC: ${formatUnits(balance, 6)}`)
        })

        await this.runTest('Can read TrustEngine internal balance', async () => {
            const balance = await this.publicClient.readContract({
                address: CONTRACTS.TRUST_ENGINE,
                abi: TRUST_ENGINE_ABI,
                functionName: 'balances',
                args: [this.account.address, CONTRACTS.USDC],
            })
            console.log(`    TrustEngine Balance: ${formatUnits(balance, 6)} USDC`)
        })

        await this.runTest('Can check USDC allowance for TrustEngine', async () => {
            const allowance = await this.publicClient.readContract({
                address: CONTRACTS.USDC,
                abi: ERC20_ABI,
                functionName: 'allowance',
                args: [this.account.address, CONTRACTS.TRUST_ENGINE],
            })
            console.log(`    Allowance: ${formatUnits(allowance, 6)} USDC`)
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Full Gateway Session Lifecycle (WRITE OPERATIONS)
    // ═══════════════════════════════════════════════════════════════════════
    async testFullSessionLifecycle() {
        console.log('\n🔄 3. Full Session Lifecycle Test (requires USDC)')

        const testSlug = `e2e-test-${Date.now()}`
        const pricePerRequest = parseUnits('0.001', 6) // $0.001
        const depositAmount = parseUnits('0.01', 6) // $0.01
        const usageAmount = parseUnits('0.005', 6) // $0.005
        let sessionId: `0x${string}` | null = null

        // Check if we have enough funds
        const walletBalance = await this.publicClient.readContract({
            address: CONTRACTS.USDC,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [this.account.address],
        })

        const trustBalance = await this.publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'balances',
            args: [this.account.address, CONTRACTS.USDC],
        })

        if (trustBalance < depositAmount && walletBalance < depositAmount) {
            console.log(`    ⚠️  Skipping write tests - insufficient USDC (need ${formatUnits(depositAmount, 6)})`)
            console.log(`    Wallet: ${formatUnits(walletBalance, 6)} USDC, TrustEngine: ${formatUnits(trustBalance, 6)} USDC`)
            return
        }

        // Step 1: Approve USDC if needed
        await this.runTest('Approve USDC for TrustEngine', async () => {
            const allowance = await this.publicClient.readContract({
                address: CONTRACTS.USDC,
                abi: ERC20_ABI,
                functionName: 'allowance',
                args: [this.account.address, CONTRACTS.TRUST_ENGINE],
            })

            if (allowance < depositAmount) {
                const hash = await this.walletClient.writeContract({
                    address: CONTRACTS.USDC,
                    abi: ERC20_ABI,
                    functionName: 'approve',
                    args: [CONTRACTS.TRUST_ENGINE, parseUnits('1000', 6)],
                })
                await this.publicClient.waitForTransactionReceipt({ hash })
                console.log(`    Tx: ${hash}`)
            } else {
                console.log(`    Already approved`)
            }
        })

        // Step 2: Deposit to TrustEngine if needed
        await this.runTest('Deposit USDC to TrustEngine', async () => {
            const currentBalance = await this.publicClient.readContract({
                address: CONTRACTS.TRUST_ENGINE,
                abi: TRUST_ENGINE_ABI,
                functionName: 'balances',
                args: [this.account.address, CONTRACTS.USDC],
            })

            if (currentBalance < depositAmount) {
                const hash = await this.walletClient.writeContract({
                    address: CONTRACTS.TRUST_ENGINE,
                    abi: TRUST_ENGINE_ABI,
                    functionName: 'deposit',
                    args: [CONTRACTS.USDC, depositAmount],
                })
                await this.publicClient.waitForTransactionReceipt({ hash })
                console.log(`    Tx: ${hash}`)
            } else {
                console.log(`    Already has sufficient balance`)
            }
        })

        // Step 3: Register Gateway
        await this.runTest('Register new gateway', async () => {
            const hash = await this.walletClient.writeContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'registerGateway',
                args: [testSlug, pricePerRequest],
            })
            await this.publicClient.waitForTransactionReceipt({ hash })
            console.log(`    Slug: ${testSlug}, Tx: ${hash}`)
            // Wait for RPC propagation
            await delay(RPC_DELAY)
        })

        // Step 4: Verify gateway registered
        await this.runTest('Verify gateway registration', async () => {
            const provider = await this.publicClient.readContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'gateways',
                args: [testSlug],
            })
            console.log(`    Provider from chain: ${provider}`)
            if (provider.toLowerCase() !== this.account.address.toLowerCase()) {
                throw new Error(`Gateway not registered to us: ${provider}`)
            }
        })

        // Step 5: Open Session
        await this.runTest('Open session', async () => {
            const hash = await this.walletClient.writeContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'openSession',
                args: [testSlug, CONTRACTS.USDC, depositAmount, 3600n], // 1 hour
            })
            const receipt = await this.publicClient.waitForTransactionReceipt({ hash })

            // Extract sessionId from first log's first indexed topic (sessionId is indexed)
            for (const log of receipt.logs) {
                // The SessionOpened event has sessionId as first indexed param
                if (log.address.toLowerCase() === CONTRACTS.GATEWAY_SESSION.toLowerCase() && log.topics.length >= 2) {
                    sessionId = log.topics[1] as `0x${string}`
                    break
                }
            }

            console.log(`    SessionId: ${sessionId}, Tx: ${hash}`)
            // Wait for RPC propagation
            await delay(RPC_DELAY)
        })

        if (!sessionId) {
            console.log('    ⚠️  Could not extract sessionId, skipping remaining lifecycle tests')
            return
        }

        // Step 6: Verify session is active
        await this.runTest('Verify session is active', async () => {
            const isValid = await this.publicClient.readContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'isSessionValid',
                args: [sessionId!],
            })
            console.log(`    isSessionValid: ${isValid}`)
            if (!isValid) throw new Error('Session not valid')
        })

        // Step 7: Record Usage (we are the provider since we registered the gateway)
        await this.runTest('Record usage', async () => {
            const hash = await this.walletClient.writeContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'recordUsage',
                args: [sessionId!, usageAmount],
            })
            await this.publicClient.waitForTransactionReceipt({ hash })
            console.log(`    Usage: ${formatUnits(usageAmount, 6)} USDC, Tx: ${hash}`)
            // Wait for RPC propagation
            await delay(RPC_DELAY)
        })

        // Step 8: Check remaining credits
        await this.runTest('Check remaining credits', async () => {
            const remaining = await this.publicClient.readContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'getRemainingCredits',
                args: [sessionId!],
            })
            const expected = depositAmount - usageAmount
            console.log(`    Remaining: ${formatUnits(remaining, 6)} USDC (expected: ${formatUnits(expected, 6)})`)
            if (remaining !== expected) {
                throw new Error(`Expected ${formatUnits(expected, 6)}, got ${formatUnits(remaining, 6)}`)
            }
        })

        // Step 9: Settle Session
        await this.runTest('Settle session', async () => {
            const hash = await this.walletClient.writeContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'settleSession',
                args: [sessionId!],
            })
            await this.publicClient.waitForTransactionReceipt({ hash })
            console.log(`    Tx: ${hash}`)
            // Wait for RPC propagation
            await delay(RPC_DELAY)
        })

        // Step 10: Verify session is no longer valid
        await this.runTest('Verify session is settled', async () => {
            const isValid = await this.publicClient.readContract({
                address: CONTRACTS.GATEWAY_SESSION,
                abi: GATEWAY_SESSION_ABI,
                functionName: 'isSessionValid',
                args: [sessionId!],
            })
            console.log(`    isSessionValid after settle: ${isValid}`)
            if (isValid) throw new Error('Session should no longer be valid')
        })
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Summary
    // ═══════════════════════════════════════════════════════════════════════
    printSummary() {
        console.log('\n═══════════════════════════════════════════════════════════════')
        console.log('📊 E2E TEST SUMMARY')
        console.log('═══════════════════════════════════════════════════════════════')

        const passed = this.results.filter(r => r.passed).length
        const failed = this.results.filter(r => !r.passed).length

        console.log(`\n  ✅ Passed: ${passed}`)
        console.log(`  ❌ Failed: ${failed}`)
        console.log(`  📈 Total:  ${this.results.length}`)

        if (failed > 0) {
            console.log('\n  Failed Tests:')
            this.results.filter(r => !r.passed).forEach(r => {
                console.log(`    - ${r.name}: ${r.error}`)
            })
        }

        console.log('\n═══════════════════════════════════════════════════════════════')
        return failed === 0
    }

    async run() {
        console.log('═══════════════════════════════════════════════════════════════')
        console.log('🚀 Cart Protocol E2E Integration Tests (Base Sepolia)')
        console.log('═══════════════════════════════════════════════════════════════')
        console.log(`  Account: ${this.account.address}`)
        console.log(`  Network: Base Sepolia`)
        console.log(`  TrustEngine: ${CONTRACTS.TRUST_ENGINE}`)
        console.log(`  GatewaySession: ${CONTRACTS.GATEWAY_SESSION}`)

        await this.testContractConfiguration()
        await this.testBalancesAndDeposits()
        await this.testFullSessionLifecycle()

        const success = this.printSummary()
        process.exit(success ? 0 : 1)
    }
}

// Run tests
const runner = new E2ETestRunner()
runner.run().catch(console.error)
