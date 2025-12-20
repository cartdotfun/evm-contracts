const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * GatewaySession Security Analysis
 * 
 * Tests attack vectors specific to session-based payments:
 * - Session ID manipulation
 * - Provider impersonation  
 * - Usage inflation attacks
 * - Front-running attacks
 * - Time manipulation
 */
describe("GatewaySession Security Analysis", function () {
    let trustEngine, gatewaySession, token;
    let owner, attacker, victim, provider, otherProvider;

    const parseUSDC = (amount) => ethers.parseUnits(amount.toString(), 6);

    beforeEach(async function () {
        [owner, attacker, victim, provider, otherProvider] = await ethers.getSigners();

        // Deploy MockERC20
        const MockToken = await ethers.getContractFactory("MockERC20");
        token = await MockToken.deploy("Mock USDC", "USDC");
        await token.waitForDeployment();

        // Deploy TrustEngine
        const TrustEngine = await ethers.getContractFactory("TrustEngine");
        trustEngine = await TrustEngine.deploy(owner.address);
        await trustEngine.waitForDeployment();

        // Deploy GatewaySession
        const GatewaySession = await ethers.getContractFactory("GatewaySession");
        gatewaySession = await GatewaySession.deploy(
            await trustEngine.getAddress(),
            owner.address
        );
        await gatewaySession.waitForDeployment();

        // Configure
        await trustEngine.setGatewaySession(await gatewaySession.getAddress());
        await trustEngine.setProtocolFee(25);
        await trustEngine.setProtocolFeeRecipient(owner.address);

        // Fund victim
        await token.mint(victim.address, parseUSDC(10000));
        await token.connect(victim).approve(await trustEngine.getAddress(), parseUSDC(10000));
        await trustEngine.connect(victim).deposit(await token.getAddress(), parseUSDC(1000));

        // Fund attacker
        await token.mint(attacker.address, parseUSDC(10000));
        await token.connect(attacker).approve(await trustEngine.getAddress(), parseUSDC(10000));
        await trustEngine.connect(attacker).deposit(await token.getAddress(), parseUSDC(1000));
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 1. Gateway Registry Attacks
    // ═══════════════════════════════════════════════════════════════════════
    describe("1. Gateway Registry Attacks", function () {
        it("should prevent gateway slug hijacking after registration", async function () {
            // Provider registers gateway
            await gatewaySession.connect(provider).registerGateway("popular-api", parseUSDC(0.01));

            // Attacker tries to register same slug
            await expect(
                gatewaySession.connect(attacker).registerGateway("popular-api", parseUSDC(0.001))
            ).to.be.revertedWith("Gateway already exists");
        });

        it("should prevent unauthorized gateway deactivation", async function () {
            await gatewaySession.connect(provider).registerGateway("victim-api", parseUSDC(0.01));

            // Attacker tries to deactivate victim's gateway
            await expect(
                gatewaySession.connect(attacker).deactivateGateway("victim-api")
            ).to.be.revertedWith("Not gateway owner");
        });

        it("should prevent unauthorized price manipulation", async function () {
            await gatewaySession.connect(provider).registerGateway("stable-api", parseUSDC(0.01));

            // Attacker tries to change price to drain funds faster
            await expect(
                gatewaySession.connect(attacker).updateGatewayPrice("stable-api", parseUSDC(1000))
            ).to.be.revertedWith("Not gateway owner");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. Session Manipulation Attacks
    // ═══════════════════════════════════════════════════════════════════════
    describe("2. Session Manipulation Attacks", function () {
        beforeEach(async function () {
            await gatewaySession.connect(provider).registerGateway("test-api", parseUSDC(0.01));
        });

        it("should prevent attacker from recording usage on victim's session", async function () {
            // Victim opens session
            const tx = await gatewaySession.connect(victim).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Attacker tries to record usage (only provider should be able to)
            await expect(
                gatewaySession.connect(attacker).recordUsage(sessionId, parseUSDC(100))
            ).to.be.revertedWith("Only provider can record usage");
        });

        it("should prevent provider from recording usage on other provider's session", async function () {
            // Register another gateway
            await gatewaySession.connect(otherProvider).registerGateway("other-api", parseUSDC(0.01));

            // Victim opens session with provider
            const tx = await gatewaySession.connect(victim).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Other provider tries to record usage
            await expect(
                gatewaySession.connect(otherProvider).recordUsage(sessionId, parseUSDC(50))
            ).to.be.revertedWith("Only provider can record usage");
        });

        it("should prevent provider from inflating usage beyond deposit", async function () {
            const tx = await gatewaySession.connect(victim).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Provider tries to record more than deposited
            await expect(
                gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(150))
            ).to.be.revertedWith("Usage exceeds deposit");
        });

        it("should prevent usage recording after settlement", async function () {
            const tx = await gatewaySession.connect(victim).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Record some usage then settle
            await gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(50));
            await gatewaySession.connect(victim).settleSession(sessionId);

            // Provider tries to record more after settlement
            await expect(
                gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(10))
            ).to.be.revertedWith("Session not active");
        });

        it("should prevent double settlement attack", async function () {
            const tx = await gatewaySession.connect(victim).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await gatewaySession.connect(victim).settleSession(sessionId);

            // Try to settle again
            await expect(
                gatewaySession.connect(provider).settleSession(sessionId)
            ).to.be.revertedWith("Session not active");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. Time-Based Attacks
    // ═══════════════════════════════════════════════════════════════════════
    describe("3. Time-Based Attacks", function () {
        beforeEach(async function () {
            await gatewaySession.connect(provider).registerGateway("time-api", parseUSDC(0.01));
        });

        it("should prevent usage recording after session expiry", async function () {
            // Open session with 1 minute duration
            const tx = await gatewaySession.connect(victim).openSession(
                "time-api", await token.getAddress(), parseUSDC(100), 60
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Fast forward past expiry
            await time.increase(120);

            // Provider tries to record usage after expiry
            await expect(
                gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(50))
            ).to.be.revertedWith("Session expired");
        });

        it("should allow settlement of expired session by anyone", async function () {
            const tx = await gatewaySession.connect(victim).openSession(
                "time-api", await token.getAddress(), parseUSDC(100), 60
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Record usage before expiry
            await gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(30));

            // Fast forward past expiry
            await time.increase(120);

            // Random third party can settle to claim bounty / cleanup
            await expect(gatewaySession.connect(attacker).settleSession(sessionId))
                .to.emit(gatewaySession, "SessionSettled");
        });

        it("should prevent premature settlement by third parties", async function () {
            const tx = await gatewaySession.connect(victim).openSession(
                "time-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Third party tries to settle before expiry
            await expect(
                gatewaySession.connect(attacker).settleSession(sessionId)
            ).to.be.revertedWith("Not authorized to settle");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. Economic Attacks
    // ═══════════════════════════════════════════════════════════════════════
    describe("4. Economic Attacks", function () {
        beforeEach(async function () {
            await gatewaySession.connect(provider).registerGateway("econ-api", parseUSDC(0.01));
        });

        it("should prevent session opening without sufficient TrustEngine balance", async function () {
            // Attacker with zero balance tries to open session
            const [, , , , , newUser] = await ethers.getSigners();

            await expect(
                gatewaySession.connect(newUser).openSession(
                    "econ-api", await token.getAddress(), parseUSDC(100), 3600
                )
            ).to.be.revertedWith("Insufficient TrustEngine balance");
        });

        it("should prevent draining via multiple small sessions", async function () {
            // Attacker opens max sessions to lock all their funds
            const sessionsToOpen = 10;
            const depositPerSession = parseUSDC(100); // 100 each = 1000 total (exactly their balance)

            for (let i = 0; i < sessionsToOpen; i++) {
                await gatewaySession.connect(attacker).openSession(
                    "econ-api", await token.getAddress(), depositPerSession, 3600
                );
            }

            // Attacker balance should now be 0
            const balance = await trustEngine.balances(attacker.address, await token.getAddress());
            expect(balance).to.equal(0);

            // Can't open more sessions
            await expect(
                gatewaySession.connect(attacker).openSession(
                    "econ-api", await token.getAddress(), parseUSDC(1), 3600
                )
            ).to.be.revertedWith("Insufficient TrustEngine balance");
        });

        it("should correctly handle dust amounts in fee calculation", async function () {
            // Open session with tiny amount where fee rounds to 0
            const tx = await gatewaySession.connect(victim).openSession(
                "econ-api", await token.getAddress(), 1n, 3600 // 1 unit
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await gatewaySession.connect(provider).recordUsage(sessionId, 1n);

            const victimBalanceBefore = await trustEngine.balances(victim.address, await token.getAddress());
            await gatewaySession.connect(victim).settleSession(sessionId);
            const victimBalanceAfter = await trustEngine.balances(victim.address, await token.getAddress());

            // No refund expected (full usage)
            expect(victimBalanceAfter).to.equal(victimBalanceBefore);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 5. Session ID Predictability
    // ═══════════════════════════════════════════════════════════════════════
    describe("5. Session ID Security", function () {
        beforeEach(async function () {
            await gatewaySession.connect(provider).registerGateway("id-api", parseUSDC(0.01));
        });

        it("should generate unique session IDs even for same parameters", async function () {
            const sessionIds = [];

            for (let i = 0; i < 5; i++) {
                const tx = await gatewaySession.connect(victim).openSession(
                    "id-api", await token.getAddress(), parseUSDC(10), 3600
                );
                const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;
                sessionIds.push(sessionId);
            }

            // All IDs should be unique
            const uniqueIds = new Set(sessionIds);
            expect(uniqueIds.size).to.equal(sessionIds.length);
        });

        it("should not allow operations on non-existent session IDs", async function () {
            const fakeSessionId = ethers.keccak256(ethers.toUtf8Bytes("fake-session"));

            await expect(
                gatewaySession.connect(provider).recordUsage(fakeSessionId, parseUSDC(10))
            ).to.be.revertedWith("Session not active");

            await expect(
                gatewaySession.connect(victim).settleSession(fakeSessionId)
            ).to.be.revertedWith("Session not active");

            await expect(
                gatewaySession.connect(victim).cancelSession(fakeSessionId)
            ).to.be.revertedWith("Session not active");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 6. Fund Isolation
    // ═══════════════════════════════════════════════════════════════════════
    describe("6. Fund Isolation", function () {
        beforeEach(async function () {
            await gatewaySession.connect(provider).registerGateway("isolation-api", parseUSDC(0.01));
        });

        it("should isolate funds between different sessions", async function () {
            // Victim opens session
            const tx1 = await gatewaySession.connect(victim).openSession(
                "isolation-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const session1 = (await tx1.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Attacker opens separate session
            const tx2 = await gatewaySession.connect(attacker).openSession(
                "isolation-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const session2 = (await tx2.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Provider records usage on attacker's session
            await gatewaySession.connect(provider).recordUsage(session2, parseUSDC(100));

            // Victim's session should be unaffected
            const remaining = await gatewaySession.getRemainingCredits(session1);
            expect(remaining).to.equal(parseUSDC(100));
        });

        it("should prevent cross-session fund manipulation via TrustEngine", async function () {
            const tx = await gatewaySession.connect(victim).openSession(
                "isolation-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Attacker tries to unlock victim's session directly on TrustEngine
            await expect(
                trustEngine.connect(attacker).unlockSession(sessionId, parseUSDC(100))
            ).to.be.revertedWithCustomError(trustEngine, "Unauthorized");
        });
    });
});
