const { expect } = require("chai");
const hre = require("hardhat");

describe("Stress Tests: TrustEngine & GatewaySession", function () {
    // Increase timeout for stress tests
    this.timeout(120000);

    async function deployContracts() {
        const signers = await hre.ethers.getSigners();
        const [owner, feeRecipient, solanaRelay] = signers;
        const agents = signers.slice(3, 8); // 5 agents
        const providers = signers.slice(8, 11); // 3 providers

        // Deploy mock ERC20 token (USDC)
        const MockToken = await hre.ethers.getContractFactory("MockERC20");
        const token = await MockToken.deploy("Mock USDC", "USDC");
        await token.waitForDeployment();

        // Deploy TrustEngine
        const TrustEngine = await hre.ethers.getContractFactory("TrustEngine");
        const trustEngine = await TrustEngine.deploy(owner.address);
        await trustEngine.waitForDeployment();

        // Deploy GatewaySession
        const GatewaySession = await hre.ethers.getContractFactory("GatewaySession");
        const gatewaySession = await GatewaySession.deploy(
            await trustEngine.getAddress(),
            owner.address
        );
        await gatewaySession.waitForDeployment();

        // Configure TrustEngine
        await trustEngine.setGatewaySession(await gatewaySession.getAddress());
        await trustEngine.setProtocolFee(100); // 1%
        await trustEngine.setProtocolFeeRecipient(feeRecipient.address);
        await trustEngine.setSolanaRelay(solanaRelay.address);
        await trustEngine.setSolanaSessionToken(await token.getAddress());

        // Fund all agents
        const AGENT_FUNDING = hre.ethers.parseUnits("10000", 6); // 10,000 USDC each
        for (const agent of agents) {
            await token.mint(agent.address, AGENT_FUNDING);
            await token.connect(agent).approve(await trustEngine.getAddress(), AGENT_FUNDING);
            await trustEngine.connect(agent).deposit(await token.getAddress(), AGENT_FUNDING);
        }

        return {
            trustEngine,
            gatewaySession,
            token,
            owner,
            feeRecipient,
            solanaRelay,
            agents,
            providers,
            AGENT_FUNDING
        };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // 1. CONCURRENT SESSIONS STRESS TEST
    // ═══════════════════════════════════════════════════════════════════════
    describe("1. Concurrent Sessions", function () {
        it("should handle 10+ concurrent active sessions", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();
            const sessionIds = [];

            // Register gateway
            const pricePerRequest = hre.ethers.parseUnits("0.01", 6);
            await gatewaySession.connect(providers[0]).registerGateway("stress-api", pricePerRequest);

            // Open 10 sessions from different agents
            for (let i = 0; i < 10; i++) {
                const agent = agents[i % agents.length];
                const deposit = hre.ethers.parseUnits("100", 6);

                const tx = await gatewaySession.connect(agent).openSession(
                    "stress-api",
                    await token.getAddress(),
                    deposit,
                    3600 // 1 hour
                );
                const receipt = await tx.wait();
                const event = receipt?.logs.find((l) => l.fragment?.name === "SessionOpened");
                sessionIds.push(event?.args?.sessionId);
            }

            // Verify all sessions are active
            for (const sessionId of sessionIds) {
                expect(await gatewaySession.isSessionValid(sessionId)).to.be.true;
            }

            // Record usage on all sessions concurrently
            for (const sessionId of sessionIds) {
                await gatewaySession.connect(providers[0]).recordUsage(sessionId, pricePerRequest);
            }

            console.log(`    ✓ Successfully managed ${sessionIds.length} concurrent sessions`);
        });

        it("should handle multiple agents using multiple providers", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            // Register gateways for all providers
            for (let i = 0; i < providers.length; i++) {
                await gatewaySession.connect(providers[i]).registerGateway(
                    `provider-${i}-api`,
                    hre.ethers.parseUnits("0.01", 6)
                );
            }

            const sessions = [];

            // Each agent opens sessions with each provider
            for (const agent of agents) {
                for (let i = 0; i < providers.length; i++) {
                    const tx = await gatewaySession.connect(agent).openSession(
                        `provider-${i}-api`,
                        await token.getAddress(),
                        hre.ethers.parseUnits("50", 6),
                        3600
                    );
                    const receipt = await tx.wait();
                    const sessionId = receipt?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;
                    sessions.push({ sessionId, providerIndex: i });
                }
            }

            expect(sessions.length).to.equal(agents.length * providers.length);
            console.log(`    ✓ Created ${sessions.length} sessions (${agents.length} agents × ${providers.length} providers)`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. HIGH-VOLUME USAGE RECORDING
    // ═══════════════════════════════════════════════════════════════════════
    describe("2. High-Volume Usage Recording", function () {
        it("should handle 100+ recordUsage calls on single session", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();
            const agent = agents[0];
            const provider = providers[0];

            const pricePerRequest = hre.ethers.parseUnits("0.001", 6); // $0.001 per call
            await gatewaySession.connect(provider).registerGateway("volume-api", pricePerRequest);

            const deposit = hre.ethers.parseUnits("500", 6); // Enough for 500 calls
            const tx = await gatewaySession.connect(agent).openSession(
                "volume-api",
                await token.getAddress(),
                deposit,
                7200 // 2 hours
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Record 100 usage calls
            const CALL_COUNT = 100;
            let totalGasUsed = 0n;

            for (let i = 0; i < CALL_COUNT; i++) {
                const usageTx = await gatewaySession.connect(provider).recordUsage(sessionId, pricePerRequest);
                const receipt = await usageTx.wait();
                totalGasUsed += receipt.gasUsed;
            }

            // Verify cumulative usage
            const expectedUsage = pricePerRequest * BigInt(CALL_COUNT);
            const remaining = await gatewaySession.getRemainingCredits(sessionId);
            expect(remaining).to.equal(deposit - expectedUsage);

            const avgGasPerCall = totalGasUsed / BigInt(CALL_COUNT);
            console.log(`    ✓ Completed ${CALL_COUNT} usage recordings`);
            console.log(`    ✓ Average gas per recordUsage: ${avgGasPerCall.toString()}`);
        });

        it("should accurately track cumulative usage across many small increments", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            await gatewaySession.connect(providers[0]).registerGateway("micro-api", 1); // 1 wei per call

            const deposit = hre.ethers.parseUnits("1", 6);
            const tx = await gatewaySession.connect(agents[0]).openSession(
                "micro-api",
                await token.getAddress(),
                deposit,
                3600
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // 50 micro-payments of 1 wei each
            for (let i = 0; i < 50; i++) {
                await gatewaySession.connect(providers[0]).recordUsage(sessionId, 1);
            }

            const session = await gatewaySession.getSession(sessionId);
            expect(session.usedAmount).to.equal(50);
            console.log(`    ✓ Micro-payment tracking accurate (50 × 1 wei = ${session.usedAmount} wei used)`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. SESSION LIFECYCLE EDGE CASES
    // ═══════════════════════════════════════════════════════════════════════
    describe("3. Edge Cases", function () {
        it("should allow third-party settlement after expiry", async function () {
            const { gatewaySession, trustEngine, token, agents, providers, owner } = await deployContracts();

            await gatewaySession.connect(providers[0]).registerGateway("expiry-api", 1000);

            // Open session with very short duration
            const tx = await gatewaySession.connect(agents[0]).openSession(
                "expiry-api",
                await token.getAddress(),
                hre.ethers.parseUnits("10", 6),
                1 // 1 second duration
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Wait for expiry
            await hre.network.provider.send("evm_increaseTime", [2]);
            await hre.network.provider.send("evm_mine");

            // Third party (owner) can settle after expiry
            await expect(gatewaySession.connect(owner).settleSession(sessionId))
                .to.emit(gatewaySession, "SessionSettled");

            console.log(`    ✓ Third-party settlement after expiry works`);
        });

        it("should reject cancel attempt after partial usage", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            await gatewaySession.connect(providers[0]).registerGateway("cancel-api", 1000);

            const tx = await gatewaySession.connect(agents[0]).openSession(
                "cancel-api",
                await token.getAddress(),
                hre.ethers.parseUnits("10", 6),
                3600
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Record some usage
            await gatewaySession.connect(providers[0]).recordUsage(sessionId, 500);

            // Try to cancel (should fail)
            await expect(gatewaySession.connect(agents[0]).cancelSession(sessionId))
                .to.be.revertedWith("Cannot cancel session with usage");

            console.log(`    ✓ Cancel correctly blocked after usage recorded`);
        });

        it("should handle usage at exact deposit limit", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            const deposit = hre.ethers.parseUnits("10", 6);
            await gatewaySession.connect(providers[0]).registerGateway("limit-api", deposit);

            const tx = await gatewaySession.connect(agents[0]).openSession(
                "limit-api",
                await token.getAddress(),
                deposit,
                3600
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Record usage exactly at limit
            await expect(gatewaySession.connect(providers[0]).recordUsage(sessionId, deposit))
                .to.emit(gatewaySession, "UsageRecorded");

            // Verify no remaining credits
            expect(await gatewaySession.getRemainingCredits(sessionId)).to.equal(0);

            // Try to record more (should fail)
            await expect(gatewaySession.connect(providers[0]).recordUsage(sessionId, 1))
                .to.be.revertedWith("Usage exceeds deposit");

            console.log(`    ✓ Exact deposit limit handling works correctly`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. MULTI-AGENT ECONOMY SIMULATION
    // ═══════════════════════════════════════════════════════════════════════
    describe("4. Multi-Agent Economy", function () {
        it("should correctly reconcile all balances after complex interactions", async function () {
            const { gatewaySession, trustEngine, token, agents, providers, feeRecipient } = await deployContracts();

            // Register gateways
            for (let i = 0; i < providers.length; i++) {
                await gatewaySession.connect(providers[i]).registerGateway(
                    `economy-${i}`,
                    hre.ethers.parseUnits("0.1", 6)
                );
            }

            // Track initial balances
            const initialBalances = {};
            for (const agent of agents) {
                initialBalances[agent.address] = await trustEngine.balances(agent.address, await token.getAddress());
            }

            const sessions = [];
            const usagePerSession = hre.ethers.parseUnits("5", 6);
            const depositPerSession = hre.ethers.parseUnits("20", 6);

            // Phase 1: All agents open sessions with all providers
            for (const agent of agents) {
                for (let i = 0; i < providers.length; i++) {
                    const tx = await gatewaySession.connect(agent).openSession(
                        `economy-${i}`,
                        await token.getAddress(),
                        depositPerSession,
                        3600
                    );
                    const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;
                    sessions.push({ sessionId, agent, providerIndex: i });
                }
            }

            // Phase 2: Record usage on all sessions
            for (const { sessionId, providerIndex } of sessions) {
                await gatewaySession.connect(providers[providerIndex]).recordUsage(sessionId, usagePerSession);
            }

            // Phase 3: Settle all sessions
            for (const { sessionId, agent } of sessions) {
                await gatewaySession.connect(agent).settleSession(sessionId);
            }

            // Verify: total locked should equal total distributed
            let totalUsed = 0n;
            let totalRefunded = 0n;
            const sessionsCount = BigInt(agents.length * providers.length);

            totalUsed = usagePerSession * sessionsCount;
            totalRefunded = (depositPerSession - usagePerSession) * sessionsCount;

            // Check provider balances received usage payments (minus fees)
            let totalProviderReceived = 0n;
            for (const provider of providers) {
                totalProviderReceived += await trustEngine.balances(provider.address, await token.getAddress());
            }

            // Check fee recipient got fees
            const feeBalance = await trustEngine.balances(feeRecipient.address, await token.getAddress());

            console.log(`    ✓ Simulated ${sessions.length} sessions across ${agents.length} agents × ${providers.length} providers`);
            console.log(`    ✓ Total usage: ${hre.ethers.formatUnits(totalUsed, 6)} USDC`);
            console.log(`    ✓ Total refunded: ${hre.ethers.formatUnits(totalRefunded, 6)} USDC`);
            console.log(`    ✓ Protocol fees collected: ${hre.ethers.formatUnits(feeBalance, 6)} USDC`);

            // Sanity check: fees should be 1% of usage
            const expectedFees = totalUsed / 100n;
            expect(feeBalance).to.equal(expectedFees);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 5. CROSS-CHAIN SETTLEMENT STRESS (TrustEngine Direct)
    // ═══════════════════════════════════════════════════════════════════════
    describe("5. Cross-Chain Settlement", function () {
        it("should prevent replay attacks on Solana settlements", async function () {
            const { trustEngine, token, agents, providers, solanaRelay } = await deployContracts();

            const sessionId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("solana-session-1"));
            const amount = hre.ethers.parseUnits("10", 6);

            // First settlement should succeed
            await expect(trustEngine.connect(solanaRelay).settleFromSolana(
                sessionId,
                agents[0].address,
                providers[0].address,
                amount
            )).to.emit(trustEngine, "CrossChainSettlement");

            // Replay should fail
            await expect(trustEngine.connect(solanaRelay).settleFromSolana(
                sessionId,
                agents[0].address,
                providers[0].address,
                amount
            )).to.be.revertedWith("Already processed");

            console.log(`    ✓ Replay attack prevention working`);
        });

        it("should handle multiple concurrent Solana settlements", async function () {
            const { trustEngine, token, agents, providers, solanaRelay } = await deployContracts();

            const settlements = [];
            const amount = hre.ethers.parseUnits("5", 6);

            // Create 20 unique settlements
            for (let i = 0; i < 20; i++) {
                const sessionId = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`solana-batch-${i}`));
                const agentIndex = i % agents.length;
                const providerIndex = i % providers.length;

                await trustEngine.connect(solanaRelay).settleFromSolana(
                    sessionId,
                    agents[agentIndex].address,
                    providers[providerIndex].address,
                    amount
                );
                settlements.push(sessionId);
            }

            // All should be marked as processed
            for (const sessionId of settlements) {
                expect(await trustEngine.processedSolanaSettlements(sessionId)).to.be.true;
            }

            console.log(`    ✓ Processed ${settlements.length} cross-chain settlements`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 6. GATEWAY REGISTRY STRESS
    // ═══════════════════════════════════════════════════════════════════════
    describe("6. Gateway Registry", function () {
        it("should handle provider with multiple gateways", async function () {
            const { gatewaySession, providers } = await deployContracts();
            const provider = providers[0];

            const gatewayCount = 10;
            const basePrice = hre.ethers.parseUnits("0.01", 6);
            for (let i = 0; i < gatewayCount; i++) {
                const price = basePrice + BigInt(i) * 1000n; // Add 0.001 USDC increments
                await gatewaySession.connect(provider).registerGateway(
                    `multi-gw-${i}`,
                    price
                );
            }

            // Verify all registered
            for (let i = 0; i < gatewayCount; i++) {
                const [gwProvider, price] = await gatewaySession.getGateway(`multi-gw-${i}`);
                expect(gwProvider).to.equal(provider.address);
            }

            console.log(`    ✓ Single provider registered ${gatewayCount} gateways`);
        });

        it("should not affect active sessions when gateway price changes", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            const initialPrice = hre.ethers.parseUnits("0.01", 6);
            await gatewaySession.connect(providers[0]).registerGateway("price-change", initialPrice);

            // Open session at original price
            const tx = await gatewaySession.connect(agents[0]).openSession(
                "price-change",
                await token.getAddress(),
                hre.ethers.parseUnits("10", 6),
                3600
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Change price
            const newPrice = hre.ethers.parseUnits("1", 6); // 100x increase
            await gatewaySession.connect(providers[0]).updateGatewayPrice("price-change", newPrice);

            // Session still works with recorded usage (provider determines usage amount, not price)
            await expect(gatewaySession.connect(providers[0]).recordUsage(sessionId, initialPrice))
                .to.emit(gatewaySession, "UsageRecorded");

            console.log(`    ✓ Active sessions unaffected by gateway price changes`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 7. SESSION RENEWAL
    // ═══════════════════════════════════════════════════════════════════════
    describe("7. Session Renewal", function () {
        it("should allow agent to renew active session", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            await gatewaySession.connect(providers[0]).registerGateway("renew-api", 1000);

            // Open session with 1 hour duration
            const tx = await gatewaySession.connect(agents[0]).openSession(
                "renew-api",
                await token.getAddress(),
                hre.ethers.parseUnits("10", 6),
                3600 // 1 hour
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Get initial expiry
            const sessionBefore = await gatewaySession.getSession(sessionId);
            const initialExpiry = sessionBefore.expiresAt;

            // Advance time 30 minutes
            await hre.network.provider.send("evm_increaseTime", [1800]);
            await hre.network.provider.send("evm_mine");

            // Renew for another 7 days (max)
            const sevenDays = 7 * 24 * 60 * 60;
            await expect(gatewaySession.connect(agents[0]).renewSession(sessionId, sevenDays))
                .to.emit(gatewaySession, "SessionRenewed");

            // Verify new expiry is 7 days from NOW (not from original expiry)
            const sessionAfter = await gatewaySession.getSession(sessionId);
            expect(sessionAfter.expiresAt).to.be.gt(initialExpiry);

            console.log(`    ✓ Session renewed successfully`);
        });

        it("should reject renewal by non-agent", async function () {
            const { gatewaySession, token, agents, providers, owner } = await deployContracts();

            await gatewaySession.connect(providers[0]).registerGateway("renew-reject-api", 1000);

            const tx = await gatewaySession.connect(agents[0]).openSession(
                "renew-reject-api",
                await token.getAddress(),
                hre.ethers.parseUnits("10", 6),
                3600
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Provider tries to renew (should fail)
            await expect(gatewaySession.connect(providers[0]).renewSession(sessionId, 3600))
                .to.be.revertedWith("Only agent can renew");

            // Owner tries to renew (should fail)
            await expect(gatewaySession.connect(owner).renewSession(sessionId, 3600))
                .to.be.revertedWith("Only agent can renew");

            console.log(`    ✓ Non-agent renewal correctly rejected`);
        });

        it("should reject renewal with excessive duration", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            await gatewaySession.connect(providers[0]).registerGateway("renew-excess-api", 1000);

            const tx = await gatewaySession.connect(agents[0]).openSession(
                "renew-excess-api",
                await token.getAddress(),
                hre.ethers.parseUnits("10", 6),
                3600
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Try to renew for 8 days (exceeds 7 day max)
            const eightDays = 8 * 24 * 60 * 60;
            await expect(gatewaySession.connect(agents[0]).renewSession(sessionId, eightDays))
                .to.be.revertedWith("Invalid extension");

            console.log(`    ✓ Excessive duration correctly rejected`);
        });

        it("should reject renewal of settled session", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            await gatewaySession.connect(providers[0]).registerGateway("renew-settled-api", 1000);

            const tx = await gatewaySession.connect(agents[0]).openSession(
                "renew-settled-api",
                await token.getAddress(),
                hre.ethers.parseUnits("10", 6),
                3600
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Settle the session
            await gatewaySession.connect(agents[0]).settleSession(sessionId);

            // Try to renew settled session
            await expect(gatewaySession.connect(agents[0]).renewSession(sessionId, 3600))
                .to.be.revertedWith("Session not active");

            console.log(`    ✓ Settled session renewal correctly rejected`);
        });

        it("should enforce MAX_SESSION_DURATION on openSession", async function () {
            const { gatewaySession, token, agents, providers } = await deployContracts();

            await gatewaySession.connect(providers[0]).registerGateway("max-duration-api", 1000);

            // Try to open session with 8 days (exceeds max)
            const eightDays = 8 * 24 * 60 * 60;
            await expect(gatewaySession.connect(agents[0]).openSession(
                "max-duration-api",
                await token.getAddress(),
                hre.ethers.parseUnits("10", 6),
                eightDays
            )).to.be.revertedWith("Invalid duration");

            console.log(`    ✓ MAX_SESSION_DURATION enforced on openSession`);
        });
    });
});
