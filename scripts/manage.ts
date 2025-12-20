#!/usr/bin/env npx ts-node
import { createPublicClient, createWalletClient, http, formatUnits, parseUnits, Address } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import * as dotenv from 'dotenv'
import * as readline from 'readline'

dotenv.config()

/**
 * TrustEngine Management CLI
 * 
 * Interactive tool for admin functions:
 * - View/update protocol fee
 * - View/update fee recipients
 * - View/update authorized addresses
 * - Withdraw internal balance
 */

const CONTRACTS = {
    TRUST_ENGINE: '0x1E43578CB0486a036dABcf5b9E31a037b6C27E96' as const,
    GATEWAY_SESSION: '0x9e1C3f4c1E14C19cd854F592dE6b3442B5a6A329' as const,
    USDC: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const,
}

const TRUST_ENGINE_ABI = [
    // View functions
    { name: 'owner', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'protocolFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'protocolFeeRecipient', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'arbitrationFeeBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { name: 'arbitrationFeeRecipient', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'arbiter', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'gatewaySession', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'validationBridge', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'solanaRelay', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
    { name: 'balances', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'address' }], outputs: [{ type: 'uint256' }] },
    // Write functions
    { name: 'setProtocolFee', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256', name: '_newFeeBps' }], outputs: [] },
    { name: 'setProtocolFeeRecipient', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_newRecipient' }], outputs: [] },
    { name: 'setArbitrationFee', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'uint256', name: '_newFeeBps' }], outputs: [] },
    { name: 'setArbitrationFeeRecipient', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_newRecipient' }], outputs: [] },
    { name: 'setArbiter', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_arbiter' }], outputs: [] },
    { name: 'setGatewaySession', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_gatewaySession' }], outputs: [] },
    { name: 'setValidationBridge', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_validationBridge' }], outputs: [] },
    { name: 'setSolanaRelay', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_relay' }], outputs: [] },
    { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: '_token' }, { type: 'uint256', name: '_amount' }], outputs: [] },
] as const

const ERC20_ABI = [
    { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

class TrustEngineManager {
    private publicClient
    private walletClient
    private account
    private rl: readline.Interface

    constructor() {
        const privateKey = process.env.PRIVATE_KEY
        if (!privateKey) throw new Error('PRIVATE_KEY not set in .env')

        this.account = privateKeyToAccount(privateKey.startsWith('0x') ? privateKey as `0x${string}` : `0x${privateKey}`)

        const transport = http(process.env.BASE_SEPOLIA_RPC || 'https://sepolia.base.org')

        this.publicClient = createPublicClient({
            chain: baseSepolia,
            transport,
        })

        this.walletClient = createWalletClient({
            account: this.account,
            chain: baseSepolia,
            transport,
        })

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        })
    }

    private async prompt(question: string): Promise<string> {
        return new Promise(resolve => {
            this.rl.question(question, resolve)
        })
    }

    private async showStatus() {
        console.log('\n═══════════════════════════════════════════════════════════════')
        console.log('📊 TrustEngine Status')
        console.log('═══════════════════════════════════════════════════════════════')

        const [owner, protocolFeeBps, protocolFeeRecipient, arbitrationFeeBps, arbitrationFeeRecipient,
            arbiter, gatewaySession, validationBridge, solanaRelay, myBalance] = await Promise.all([
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'owner' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'protocolFeeBps' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'protocolFeeRecipient' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'arbitrationFeeBps' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'arbitrationFeeRecipient' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'arbiter' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'gatewaySession' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'validationBridge' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'solanaRelay' }),
                this.publicClient.readContract({ address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'balances', args: [this.account.address, CONTRACTS.USDC] }),
            ])

        const isOwner = owner.toLowerCase() === this.account.address.toLowerCase()

        console.log(`\n  Your Address:         ${this.account.address}`)
        console.log(`  Owner:                ${owner} ${isOwner ? '(YOU)' : ''}`)
        console.log(`  Your USDC Balance:    ${formatUnits(myBalance, 6)} USDC`)
        console.log('')
        console.log('  ─── Fee Configuration ───')
        console.log(`  Protocol Fee:         ${Number(protocolFeeBps) / 100}% (${protocolFeeBps} bps)`)
        console.log(`  Protocol Recipient:   ${protocolFeeRecipient}`)
        console.log(`  Arbitration Fee:      ${Number(arbitrationFeeBps) / 100}% (${arbitrationFeeBps} bps)`)
        console.log(`  Arb. Recipient:       ${arbitrationFeeRecipient || '(not set)'}`)
        console.log('')
        console.log('  ─── Authorized Addresses ───')
        console.log(`  Arbiter:              ${arbiter === '0x0000000000000000000000000000000000000000' ? '(not set)' : arbiter}`)
        console.log(`  GatewaySession:       ${gatewaySession}`)
        console.log(`  ValidationBridge:     ${validationBridge === '0x0000000000000000000000000000000000000000' ? '(not set)' : validationBridge}`)
        console.log(`  Solana Relay:         ${solanaRelay === '0x0000000000000000000000000000000000000000' ? '(not set)' : solanaRelay}`)
        console.log('')

        return isOwner
    }

    private showMenu(isOwner: boolean) {
        console.log('═══════════════════════════════════════════════════════════════')
        console.log('📋 Available Actions')
        console.log('═══════════════════════════════════════════════════════════════')
        console.log('  1. Refresh status')
        console.log('  2. Check balance of address')
        if (isOwner) {
            console.log('  ─── Owner Actions ───')
            console.log('  3. Set protocol fee')
            console.log('  4. Set protocol fee recipient')
            console.log('  5. Set arbitration fee')
            console.log('  6. Set arbitration fee recipient')
            console.log('  7. Set arbiter')
            console.log('  8. Set Solana relay')
        }
        console.log('  ─── Wallet Actions ───')
        console.log('  9. Withdraw USDC from internal balance')
        console.log('  0. Exit')
        console.log('')
    }

    private async setProtocolFee() {
        const current = await this.publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'protocolFeeBps'
        })
        console.log(`\n  Current fee: ${Number(current) / 100}% (${current} bps)`)
        console.log('  Enter new fee in basis points (100 = 1%, max 1000 = 10%):')

        const input = await this.prompt('  > ')
        const newFee = parseInt(input)

        if (isNaN(newFee) || newFee < 0 || newFee > 1000) {
            console.log('  ❌ Invalid fee. Must be 0-1000 bps.')
            return
        }

        console.log(`\n  Setting protocol fee to ${newFee / 100}% (${newFee} bps)...`)
        const hash = await this.walletClient.writeContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'setProtocolFee',
            args: [BigInt(newFee)],
        })
        await this.publicClient.waitForTransactionReceipt({ hash })
        console.log(`  ✅ Done! Tx: ${hash}`)
    }

    private async setProtocolFeeRecipient() {
        const current = await this.publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'protocolFeeRecipient'
        })
        console.log(`\n  Current recipient: ${current}`)
        console.log('  Enter new recipient address:')

        const input = await this.prompt('  > ')
        if (!input.match(/^0x[a-fA-F0-9]{40}$/)) {
            console.log('  ❌ Invalid address.')
            return
        }

        console.log(`\n  Setting protocol fee recipient to ${input}...`)
        const hash = await this.walletClient.writeContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'setProtocolFeeRecipient',
            args: [input as Address],
        })
        await this.publicClient.waitForTransactionReceipt({ hash })
        console.log(`  ✅ Done! Tx: ${hash}`)
    }

    private async setArbitrationFee() {
        const current = await this.publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'arbitrationFeeBps'
        })
        console.log(`\n  Current fee: ${Number(current) / 100}% (${current} bps)`)
        console.log('  Enter new fee in basis points:')

        const input = await this.prompt('  > ')
        const newFee = parseInt(input)

        if (isNaN(newFee) || newFee < 0 || newFee > 1000) {
            console.log('  ❌ Invalid fee. Must be 0-1000 bps.')
            return
        }

        console.log(`\n  Setting arbitration fee to ${newFee / 100}% (${newFee} bps)...`)
        const hash = await this.walletClient.writeContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'setArbitrationFee',
            args: [BigInt(newFee)],
        })
        await this.publicClient.waitForTransactionReceipt({ hash })
        console.log(`  ✅ Done! Tx: ${hash}`)
    }

    private async setArbitrationFeeRecipient() {
        console.log('\n  Enter new arbitration fee recipient address:')
        const input = await this.prompt('  > ')
        if (!input.match(/^0x[a-fA-F0-9]{40}$/)) {
            console.log('  ❌ Invalid address.')
            return
        }

        console.log(`\n  Setting arbitration fee recipient to ${input}...`)
        const hash = await this.walletClient.writeContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'setArbitrationFeeRecipient',
            args: [input as Address],
        })
        await this.publicClient.waitForTransactionReceipt({ hash })
        console.log(`  ✅ Done! Tx: ${hash}`)
    }

    private async setArbiter() {
        const current = await this.publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'arbiter'
        })
        console.log(`\n  Current arbiter: ${current}`)
        console.log('  Enter new arbiter address:')

        const input = await this.prompt('  > ')
        if (!input.match(/^0x[a-fA-F0-9]{40}$/)) {
            console.log('  ❌ Invalid address.')
            return
        }

        console.log(`\n  Setting arbiter to ${input}...`)
        const hash = await this.walletClient.writeContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'setArbiter',
            args: [input as Address],
        })
        await this.publicClient.waitForTransactionReceipt({ hash })
        console.log(`  ✅ Done! Tx: ${hash}`)
    }

    private async setSolanaRelay() {
        const current = await this.publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE, abi: TRUST_ENGINE_ABI, functionName: 'solanaRelay'
        })
        console.log(`\n  Current Solana relay: ${current}`)
        console.log('  Enter new relay address:')

        const input = await this.prompt('  > ')
        if (!input.match(/^0x[a-fA-F0-9]{40}$/)) {
            console.log('  ❌ Invalid address.')
            return
        }

        console.log(`\n  Setting Solana relay to ${input}...`)
        const hash = await this.walletClient.writeContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'setSolanaRelay',
            args: [input as Address],
        })
        await this.publicClient.waitForTransactionReceipt({ hash })
        console.log(`  ✅ Done! Tx: ${hash}`)
    }

    private async checkBalance() {
        console.log('\n  Enter address to check (or press Enter for your own):')
        let input = await this.prompt('  > ')

        if (!input) input = this.account.address
        if (!input.match(/^0x[a-fA-F0-9]{40}$/)) {
            console.log('  ❌ Invalid address.')
            return
        }

        const balance = await this.publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'balances',
            args: [input as Address, CONTRACTS.USDC],
        })
        console.log(`\n  ${input}`)
        console.log(`  Internal USDC Balance: ${formatUnits(balance, 6)} USDC`)
    }

    private async withdrawUSDC() {
        const balance = await this.publicClient.readContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'balances',
            args: [this.account.address, CONTRACTS.USDC],
        })

        console.log(`\n  Your internal balance: ${formatUnits(balance, 6)} USDC`)
        if (balance === 0n) {
            console.log('  ❌ No balance to withdraw.')
            return
        }

        console.log(`  Enter amount to withdraw (or "all" for full balance):`)
        const input = await this.prompt('  > ')

        let amount: bigint
        if (input.toLowerCase() === 'all') {
            amount = balance
        } else {
            amount = parseUnits(input, 6)
            if (amount > balance) {
                console.log('  ❌ Insufficient balance.')
                return
            }
        }

        console.log(`\n  Withdrawing ${formatUnits(amount, 6)} USDC to ${this.account.address}...`)
        const hash = await this.walletClient.writeContract({
            address: CONTRACTS.TRUST_ENGINE,
            abi: TRUST_ENGINE_ABI,
            functionName: 'withdraw',
            args: [CONTRACTS.USDC, amount],
        })
        await this.publicClient.waitForTransactionReceipt({ hash })
        console.log(`  ✅ Done! Tx: ${hash}`)
    }

    async run() {
        console.log('═══════════════════════════════════════════════════════════════')
        console.log('🔧 TrustEngine Management CLI')
        console.log('═══════════════════════════════════════════════════════════════')
        console.log(`  Contract: ${CONTRACTS.TRUST_ENGINE}`)
        console.log(`  Network: Base Sepolia`)

        while (true) {
            const isOwner = await this.showStatus()
            this.showMenu(isOwner)

            const choice = await this.prompt('Select action: ')

            try {
                switch (choice) {
                    case '1': break // Just refresh
                    case '2': await this.checkBalance(); break
                    case '3': if (isOwner) await this.setProtocolFee(); break
                    case '4': if (isOwner) await this.setProtocolFeeRecipient(); break
                    case '5': if (isOwner) await this.setArbitrationFee(); break
                    case '6': if (isOwner) await this.setArbitrationFeeRecipient(); break
                    case '7': if (isOwner) await this.setArbiter(); break
                    case '8': if (isOwner) await this.setSolanaRelay(); break
                    case '9': await this.withdrawUSDC(); break
                    case '0':
                    case 'q':
                    case 'exit':
                        console.log('\n  Goodbye! 👋\n')
                        this.rl.close()
                        process.exit(0)
                    default:
                        console.log('  ❌ Invalid option.')
                }
            } catch (error: any) {
                console.log(`  ❌ Error: ${error.message}`)
            }
        }
    }
}

const manager = new TrustEngineManager()
manager.run().catch(console.error)
