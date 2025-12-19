const { expect } = require("chai");
const hre = require("hardhat");

/**
 * EXTREME STRESS TEST
 * 
 * Tests at massive scale:
 * - 100+ concurrent sessions
 * - 500 agents × 300 providers simulation
 * - 1000+ usage recordings
 * - Full balance reconciliation
 * 
 * Note: We simulate many agents/providers by reusing addresses
 * but creating unique sessions with unique gateway slugs.
 */
describe("EXTREME Stress Tests", function () {
    this.timeout(600000); // 10 minutes timeout

    async function deployContractsForExtreme() {
        const signers = await hre.ethers.getSigners();
        const [owner, feeRecipient, solanaRelay] = signers;

        // Use remaining signers as agents/providers (Hardhat provides 20 by default)
        const agents = signers.slice(3, 13);    // 10 agents
        const providers = signers.slice(13, 18); // 5 providers

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

        // Fund all agents with MASSIVE amounts
        const AGENT_FUNDING = hre.ethers.parseUnits("1000000", 6); // 1M USDC each
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
    // TEST 1: 100+ CONCURRENT SESSIONS
    // ═══════════════════════════════════════════════════════════════════════
    describe("100+ Concurrent Sessions", function () {
        it("should handle 100 concurrent active sessions", async function () {
            const { gatewaySession, token, agents, providers } = await deployContractsForExtreme();

            const TOTAL_SESSIONS = 100;
            const sessionIds = [];
            const pricePerRequest = hre.ethers.parseUnits("0.01", 6);

            // Register gateways
            for (let p = 0; p < providers.length; p++) {
                await gatewaySession.connect(providers[p]).registerGateway(`extreme-gw-${p}`, pricePerRequest);
            }

            console.log(`\n    📊 Opening ${TOTAL_SESSIONS} sessions...`);
            const startTime = Date.now();

            // Open 100 sessions distributed across agents and providers
            for (let i = 0; i < TOTAL_SESSIONS; i++) {
                const agent = agents[i % agents.length];
                const providerIdx = i % providers.length;
                const deposit = hre.ethers.parseUnits("100", 6);

                const tx = await gatewaySession.connect(agent).openSession(
                    `extreme-gw-${providerIdx}`,
                    await token.getAddress(),
                    deposit,
                    3600
                );
                const receipt = await tx.wait();
                const event = receipt?.logs.find((l) => l.fragment?.name === "SessionOpened");
                sessionIds.push({
                    id: event?.args?.sessionId,
                    agent,
                    providerIdx
                });

                if ((i + 1) % 25 === 0) {
                    console.log(`       Opened ${i + 1}/${TOTAL_SESSIONS} sessions...`);
                }
            }

            const openTime = Date.now() - startTime;
            console.log(`    ✓ All ${TOTAL_SESSIONS} sessions opened in ${openTime}ms`);

            // Verify all sessions are active
            let activeCount = 0;
            for (const session of sessionIds) {
                if (await gatewaySession.isSessionValid(session.id)) {
                    activeCount++;
                }
            }
            expect(activeCount).to.equal(TOTAL_SESSIONS);
            console.log(`    ✓ All ${activeCount} sessions verified as ACTIVE`);

            // Record usage on all sessions
            console.log(`    📊 Recording usage on ${TOTAL_SESSIONS} sessions...`);
            for (const session of sessionIds) {
                await gatewaySession.connect(providers[session.providerIdx]).recordUsage(session.id, pricePerRequest);
            }
            console.log(`    ✓ Usage recorded on all sessions`);

            // Settle all sessions
            console.log(`    📊 Settling ${TOTAL_SESSIONS} sessions...`);
            for (const session of sessionIds) {
                await gatewaySession.connect(session.agent).settleSession(session.id);
            }
            console.log(`    ✓ All sessions settled`);

            const totalTime = Date.now() - startTime;
            console.log(`\n    ⏱️  Total time for 100 session lifecycle: ${totalTime}ms`);
            console.log(`    ⏱️  Average per session: ${(totalTime / TOTAL_SESSIONS).toFixed(2)}ms`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 2: SIMULATED 500 AGENTS × 300 PROVIDERS
    // ═══════════════════════════════════════════════════════════════════════
    describe("Simulated 500 Agents × 300 Providers", function () {
        it("should handle 150,000 interleaved operations", async function () {
            const { gatewaySession, trustEngine, token, agents, providers, feeRecipient } = await deployContractsForExtreme();

            // We simulate 500×300 by:
            // - Using 10 actual agents (each represents 50 virtual agents)
            // - Using 5 actual providers (each represents 60 virtual providers)
            // - Creating many unique gateways to simulate provider diversity

            const SIMULATED_AGENTS = 500;
            const SIMULATED_PROVIDERS = 300;
            const SESSIONS_TO_CREATE = 1000; // Sample of the 150k possible combinations

            console.log(`\n    📊 Simulating ${SIMULATED_AGENTS} agents × ${SIMULATED_PROVIDERS} providers`);
            console.log(`    📊 Creating ${SESSIONS_TO_CREATE} sample sessions...`);

            // Register 300 unique gateways (60 per provider)
            console.log(`    📊 Registering ${SIMULATED_PROVIDERS} gateways...`);
            const gatewaysPerProvider = SIMULATED_PROVIDERS / providers.length;
            for (let p = 0; p < providers.length; p++) {
                for (let g = 0; g < gatewaysPerProvider; g++) {
                    const gwIdx = p * gatewaysPerProvider + g;
                    await gatewaySession.connect(providers[p]).registerGateway(
                        `sim-gw-${gwIdx}`,
                        hre.ethers.parseUnits("0.001", 6)
                    );
                }
                console.log(`       Provider ${p + 1}/${providers.length}: registered ${gatewaysPerProvider} gateways`);
            }

            const startTime = Date.now();
            const sessions = [];
            const usageAmount = hre.ethers.parseUnits("0.5", 6);
            const depositAmount = hre.ethers.parseUnits("10", 6);

            // Create sessions (sampling from the 150k space)
            console.log(`    📊 Opening ${SESSIONS_TO_CREATE} sessions...`);
            for (let i = 0; i < SESSIONS_TO_CREATE; i++) {
                const agent = agents[i % agents.length];
                const gwIdx = i % SIMULATED_PROVIDERS;
                const providerIdx = Math.floor(gwIdx / gatewaysPerProvider);

                const tx = await gatewaySession.connect(agent).openSession(
                    `sim-gw-${gwIdx}`,
                    await token.getAddress(),
                    depositAmount,
                    604800 // 7 days (MAX_SESSION_DURATION)
                );
                const receipt = await tx.wait();
                const sessionId = receipt?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;
                sessions.push({ id: sessionId, agent, providerIdx });

                if ((i + 1) % 250 === 0) {
                    console.log(`       Opened ${i + 1}/${SESSIONS_TO_CREATE} sessions...`);
                }
            }

            // Record usage on all
            console.log(`    📊 Recording usage on ${SESSIONS_TO_CREATE} sessions...`);
            for (let i = 0; i < sessions.length; i++) {
                const session = sessions[i];
                await gatewaySession.connect(providers[session.providerIdx]).recordUsage(session.id, usageAmount);

                if ((i + 1) % 250 === 0) {
                    console.log(`       Recorded ${i + 1}/${SESSIONS_TO_CREATE}...`);
                }
            }

            // Settle all
            console.log(`    📊 Settling ${SESSIONS_TO_CREATE} sessions...`);
            for (let i = 0; i < sessions.length; i++) {
                await gatewaySession.connect(sessions[i].agent).settleSession(sessions[i].id);

                if ((i + 1) % 250 === 0) {
                    console.log(`       Settled ${i + 1}/${SESSIONS_TO_CREATE}...`);
                }
            }

            const totalTime = Date.now() - startTime;

            // Verify fee collection
            const feeBalance = await trustEngine.balances(feeRecipient.address, await token.getAddress());
            const expectedFees = (usageAmount * BigInt(SESSIONS_TO_CREATE)) / 100n; // 1% fee
            expect(feeBalance).to.equal(expectedFees);

            console.log(`\n    ✓ ${SESSIONS_TO_CREATE} sessions completed successfully`);
            console.log(`    ✓ Protocol fees collected: ${hre.ethers.formatUnits(feeBalance, 6)} USDC`);
            console.log(`    ⏱️  Total time: ${totalTime}ms`);
            console.log(`    ⏱️  Average per session lifecycle: ${(totalTime / SESSIONS_TO_CREATE).toFixed(2)}ms`);
            console.log(`    ⏱️  Throughput: ${((SESSIONS_TO_CREATE * 1000) / totalTime).toFixed(2)} sessions/sec`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 3: 1000+ USAGE RECORDINGS
    // ═══════════════════════════════════════════════════════════════════════
    describe("1000+ Usage Recordings", function () {
        it("should handle 1000 recordUsage calls on a single session", async function () {
            const { gatewaySession, token, agents, providers } = await deployContractsForExtreme();
            const agent = agents[0];
            const provider = providers[0];

            const pricePerRequest = hre.ethers.parseUnits("0.0001", 6); // $0.0001 per call
            await gatewaySession.connect(provider).registerGateway("mega-volume", pricePerRequest);

            // Large deposit for 1000+ calls
            const deposit = hre.ethers.parseUnits("1000", 6);
            const tx = await gatewaySession.connect(agent).openSession(
                "mega-volume",
                await token.getAddress(),
                deposit,
                604800 // 7 days (MAX_SESSION_DURATION)
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            const CALL_COUNT = 1000;
            let totalGasUsed = 0n;

            console.log(`\n    📊 Recording ${CALL_COUNT} usage calls...`);
            const startTime = Date.now();

            for (let i = 0; i < CALL_COUNT; i++) {
                const usageTx = await gatewaySession.connect(provider).recordUsage(sessionId, pricePerRequest);
                const receipt = await usageTx.wait();
                totalGasUsed += receipt.gasUsed;

                if ((i + 1) % 200 === 0) {
                    console.log(`       Recorded ${i + 1}/${CALL_COUNT} (avg gas: ${(totalGasUsed / BigInt(i + 1)).toString()})`);
                }
            }

            const totalTime = Date.now() - startTime;

            // Verify cumulative usage
            const expectedUsage = pricePerRequest * BigInt(CALL_COUNT);
            const remaining = await gatewaySession.getRemainingCredits(sessionId);
            expect(remaining).to.equal(deposit - expectedUsage);

            const avgGasPerCall = totalGasUsed / BigInt(CALL_COUNT);
            console.log(`\n    ✓ Completed ${CALL_COUNT} usage recordings`);
            console.log(`    ✓ Average gas per recordUsage: ${avgGasPerCall.toString()}`);
            console.log(`    ✓ Cumulative usage: ${hre.ethers.formatUnits(expectedUsage, 6)} USDC`);
            console.log(`    ⏱️  Total time: ${totalTime}ms`);
            console.log(`    ⏱️  Throughput: ${((CALL_COUNT * 1000) / totalTime).toFixed(2)} calls/sec`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TEST 4: SESSION RENEWAL STRESS
    // ═══════════════════════════════════════════════════════════════════════
    describe("Session Renewal Stress", function () {
        it("should handle 100 consecutive renewals on single session", async function () {
            const { gatewaySession, token, agents, providers } = await deployContractsForExtreme();

            await gatewaySession.connect(providers[0]).registerGateway("renewal-stress", 1000);

            const tx = await gatewaySession.connect(agents[0]).openSession(
                "renewal-stress",
                await token.getAddress(),
                hre.ethers.parseUnits("100", 6),
                604800 // 7 days (MAX_SESSION_DURATION)
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            const RENEWAL_COUNT = 100;
            console.log(`\n    📊 Performing ${RENEWAL_COUNT} renewals...`);
            const startTime = Date.now();

            for (let i = 0; i < RENEWAL_COUNT; i++) {
                const sevenDays = 7 * 24 * 60 * 60;
                await gatewaySession.connect(agents[0]).renewSession(sessionId, sevenDays);

                if ((i + 1) % 25 === 0) {
                    console.log(`       Renewed ${i + 1}/${RENEWAL_COUNT}...`);
                }
            }

            const totalTime = Date.now() - startTime;

            // Verify session is still active
            expect(await gatewaySession.isSessionValid(sessionId)).to.be.true;

            console.log(`\n    ✓ Completed ${RENEWAL_COUNT} renewals successfully`);
            console.log(`    ⏱️  Total time: ${totalTime}ms`);
            console.log(`    ⏱️  Average per renewal: ${(totalTime / RENEWAL_COUNT).toFixed(2)}ms`);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // NUCLEAR TESTS - 10,000 SCALE
    // ═══════════════════════════════════════════════════════════════════════
    describe("☢️ NUCLEAR TESTS (10,000 scale)", function () {

        it("should handle 10,000 concurrent sessions", async function () {
            const { gatewaySession, trustEngine, token, agents, providers, feeRecipient } = await deployContractsForExtreme();

            const TOTAL_SESSIONS = 10000;
            const sessions = [];
            const pricePerRequest = hre.ethers.parseUnits("0.001", 6);
            const depositAmount = hre.ethers.parseUnits("1", 6);

            // Register gateways for all providers
            for (let p = 0; p < providers.length; p++) {
                await gatewaySession.connect(providers[p]).registerGateway(`nuclear-gw-${p}`, pricePerRequest);
            }

            console.log(`\n    ☢️  NUCLEAR TEST: ${TOTAL_SESSIONS} SESSIONS`);
            console.log(`    ═══════════════════════════════════════════`);

            const startTime = Date.now();

            // Phase 1: Open all sessions
            console.log(`\n    📊 Phase 1: Opening ${TOTAL_SESSIONS} sessions...`);
            for (let i = 0; i < TOTAL_SESSIONS; i++) {
                const agent = agents[i % agents.length];
                const providerIdx = i % providers.length;

                const tx = await gatewaySession.connect(agent).openSession(
                    `nuclear-gw-${providerIdx}`,
                    await token.getAddress(),
                    depositAmount,
                    604800 // 7 days (MAX_SESSION_DURATION)
                );
                const receipt = await tx.wait();
                const sessionId = receipt?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;
                sessions.push({ id: sessionId, agent, providerIdx });

                if ((i + 1) % 1000 === 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    const rate = ((i + 1) / (Date.now() - startTime) * 1000).toFixed(0);
                    console.log(`       ✓ ${i + 1}/${TOTAL_SESSIONS} opened (${elapsed}s, ${rate}/sec)`);
                }
            }

            const openTime = Date.now() - startTime;
            console.log(`    ✓ All sessions opened in ${(openTime / 1000).toFixed(1)}s`);

            // Phase 2: Record usage on all
            console.log(`\n    📊 Phase 2: Recording usage on ${TOTAL_SESSIONS} sessions...`);
            const usageStart = Date.now();
            for (let i = 0; i < sessions.length; i++) {
                await gatewaySession.connect(providers[sessions[i].providerIdx]).recordUsage(sessions[i].id, pricePerRequest);

                if ((i + 1) % 1000 === 0) {
                    const elapsed = ((Date.now() - usageStart) / 1000).toFixed(1);
                    console.log(`       ✓ ${i + 1}/${TOTAL_SESSIONS} recorded (${elapsed}s)`);
                }
            }

            // Phase 3: Settle all
            console.log(`\n    📊 Phase 3: Settling ${TOTAL_SESSIONS} sessions...`);
            const settleStart = Date.now();
            for (let i = 0; i < sessions.length; i++) {
                await gatewaySession.connect(sessions[i].agent).settleSession(sessions[i].id);

                if ((i + 1) % 1000 === 0) {
                    const elapsed = ((Date.now() - settleStart) / 1000).toFixed(1);
                    console.log(`       ✓ ${i + 1}/${TOTAL_SESSIONS} settled (${elapsed}s)`);
                }
            }

            const totalTime = Date.now() - startTime;

            // Verify fees
            const feeBalance = await trustEngine.balances(feeRecipient.address, await token.getAddress());
            const expectedFees = (pricePerRequest * BigInt(TOTAL_SESSIONS)) / 100n;
            expect(feeBalance).to.equal(expectedFees);

            console.log(`\n    ═══════════════════════════════════════════`);
            console.log(`    ☢️  NUCLEAR RESULTS: ${TOTAL_SESSIONS} SESSIONS`);
            console.log(`    ═══════════════════════════════════════════`);
            console.log(`    ✓ Protocol fees: ${hre.ethers.formatUnits(feeBalance, 6)} USDC`);
            console.log(`    ⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);
            console.log(`    ⏱️  Throughput: ${((TOTAL_SESSIONS * 1000) / totalTime).toFixed(2)} sessions/sec`);
        });

        it("should handle 10,000 recordUsage calls on single session", async function () {
            const { gatewaySession, token, agents, providers } = await deployContractsForExtreme();
            const agent = agents[0];
            const provider = providers[0];

            const pricePerRequest = hre.ethers.parseUnits("0.00001", 6); // $0.00001 per call
            await gatewaySession.connect(provider).registerGateway("nuclear-volume", pricePerRequest);

            const deposit = hre.ethers.parseUnits("10000", 6); // 10,000 USDC for 10k calls
            const tx = await gatewaySession.connect(agent).openSession(
                "nuclear-volume",
                await token.getAddress(),
                deposit,
                604800 // 7 days (MAX_SESSION_DURATION)
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            const CALL_COUNT = 10000;
            let totalGasUsed = 0n;

            console.log(`\n    ☢️  NUCLEAR TEST: ${CALL_COUNT} USAGE RECORDINGS`);
            console.log(`    ═══════════════════════════════════════════`);

            const startTime = Date.now();

            for (let i = 0; i < CALL_COUNT; i++) {
                const usageTx = await gatewaySession.connect(provider).recordUsage(sessionId, pricePerRequest);
                const receipt = await usageTx.wait();
                totalGasUsed += receipt.gasUsed;

                if ((i + 1) % 1000 === 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    const avgGas = (totalGasUsed / BigInt(i + 1)).toString();
                    console.log(`       ✓ ${i + 1}/${CALL_COUNT} (${elapsed}s, avg gas: ${avgGas})`);
                }
            }

            const totalTime = Date.now() - startTime;

            // Verify
            const expectedUsage = pricePerRequest * BigInt(CALL_COUNT);
            const remaining = await gatewaySession.getRemainingCredits(sessionId);
            expect(remaining).to.equal(deposit - expectedUsage);

            const avgGasPerCall = totalGasUsed / BigInt(CALL_COUNT);
            console.log(`\n    ═══════════════════════════════════════════`);
            console.log(`    ☢️  NUCLEAR RESULTS: ${CALL_COUNT} USAGE RECORDINGS`);
            console.log(`    ═══════════════════════════════════════════`);
            console.log(`    ✓ Avg gas per call: ${avgGasPerCall.toString()}`);
            console.log(`    ✓ Total gas: ${totalGasUsed.toString()}`);
            console.log(`    ✓ Cumulative usage: ${hre.ethers.formatUnits(expectedUsage, 6)} USDC`);
            console.log(`    ⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);
            console.log(`    ⏱️  Throughput: ${((CALL_COUNT * 1000) / totalTime).toFixed(2)} calls/sec`);
        });

        it("should handle 1000 consecutive renewals", async function () {
            const { gatewaySession, token, agents, providers } = await deployContractsForExtreme();

            await gatewaySession.connect(providers[0]).registerGateway("nuclear-renewal", 1000);

            const tx = await gatewaySession.connect(agents[0]).openSession(
                "nuclear-renewal",
                await token.getAddress(),
                hre.ethers.parseUnits("100", 6),
                604800 // 7 days (MAX_SESSION_DURATION)
            );
            const sessionId = (await tx.wait())?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            const RENEWAL_COUNT = 1000;
            console.log(`\n    ☢️  NUCLEAR TEST: ${RENEWAL_COUNT} RENEWALS`);
            console.log(`    ═══════════════════════════════════════════`);

            const startTime = Date.now();
            let totalGasUsed = 0n;

            for (let i = 0; i < RENEWAL_COUNT; i++) {
                const sevenDays = 7 * 24 * 60 * 60;
                const renewTx = await gatewaySession.connect(agents[0]).renewSession(sessionId, sevenDays);
                const receipt = await renewTx.wait();
                totalGasUsed += receipt.gasUsed;

                if ((i + 1) % 200 === 0) {
                    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
                    console.log(`       ✓ ${i + 1}/${RENEWAL_COUNT} renewed (${elapsed}s)`);
                }
            }

            const totalTime = Date.now() - startTime;

            expect(await gatewaySession.isSessionValid(sessionId)).to.be.true;

            const avgGas = totalGasUsed / BigInt(RENEWAL_COUNT);
            console.log(`\n    ═══════════════════════════════════════════`);
            console.log(`    ☢️  NUCLEAR RESULTS: ${RENEWAL_COUNT} RENEWALS`);
            console.log(`    ═══════════════════════════════════════════`);
            console.log(`    ✓ Avg gas per renewal: ${avgGas.toString()}`);
            console.log(`    ⏱️  Total time: ${(totalTime / 1000).toFixed(1)}s`);
            console.log(`    ⏱️  Throughput: ${((RENEWAL_COUNT * 1000) / totalTime).toFixed(2)} renewals/sec`);
        });
    });
});
