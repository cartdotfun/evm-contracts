const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

/**
 * Edge Case Tests for Cart Protocol
 * 
 * Tests boundary conditions, attack vectors, and unusual scenarios
 * that stress tests don't cover.
 */
describe("Edge Case Tests", function () {
    let trustEngine, gatewaySession, token;
    let owner, agent, provider, other, feeRecipient;

    const USDC_DECIMALS = 6;
    const parseUSDC = (amount) => ethers.parseUnits(amount.toString(), USDC_DECIMALS);

    async function deployContracts() {
        [owner, agent, provider, other, feeRecipient] = await ethers.getSigners();

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

        // Configure TrustEngine
        await trustEngine.setGatewaySession(await gatewaySession.getAddress());
        await trustEngine.setProtocolFee(25); // 0.25%
        await trustEngine.setProtocolFeeRecipient(feeRecipient.address);

        // Mint and approve tokens for agent
        await token.mint(agent.address, parseUSDC(10000));
        await token.connect(agent).approve(await trustEngine.getAddress(), parseUSDC(10000));
        await trustEngine.connect(agent).deposit(await token.getAddress(), parseUSDC(1000));

        return { trustEngine, gatewaySession, token, owner, agent, provider, other, feeRecipient };
    }

    beforeEach(async function () {
        await deployContracts();
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Gateway Registration Edge Cases
    // ═══════════════════════════════════════════════════════════════════════

    describe("Gateway Registration Edge Cases", function () {
        it("should reject empty slug", async function () {
            await expect(gatewaySession.connect(provider).registerGateway("", parseUSDC(0.01)))
                .to.be.revertedWith("Slug cannot be empty");
        });

        it("should reject slug exceeding 32 bytes", async function () {
            const longSlug = "a".repeat(33);
            await expect(gatewaySession.connect(provider).registerGateway(longSlug, parseUSDC(0.01)))
                .to.be.revertedWith("Slug too long");
        });

        it("should accept maximum length slug (32 bytes)", async function () {
            const maxSlug = "a".repeat(32);
            await expect(gatewaySession.connect(provider).registerGateway(maxSlug, parseUSDC(0.01)))
                .to.emit(gatewaySession, "GatewayRegistered");
        });

        it("should reject zero price", async function () {
            await expect(gatewaySession.connect(provider).registerGateway("my-api", 0))
                .to.be.revertedWith("Price must be > 0");
        });

        it("should reject price update to zero", async function () {
            await gatewaySession.connect(provider).registerGateway("my-api", parseUSDC(0.01));
            await expect(gatewaySession.connect(provider).updateGatewayPrice("my-api", 0))
                .to.be.revertedWith("Price must be > 0");
        });

        it("should reject price update by non-owner", async function () {
            await gatewaySession.connect(provider).registerGateway("my-api", parseUSDC(0.01));
            await expect(gatewaySession.connect(other).updateGatewayPrice("my-api", parseUSDC(0.02)))
                .to.be.revertedWith("Not gateway owner");
        });

        it("should prevent gateway deactivation with active sessions", async function () {
            await gatewaySession.connect(provider).registerGateway("my-api", parseUSDC(0.01));

            // Open a session
            await gatewaySession.connect(agent).openSession(
                "my-api", await token.getAddress(), parseUSDC(10), 3600
            );

            // Try to deactivate - should fail
            await expect(gatewaySession.connect(provider).deactivateGateway("my-api"))
                .to.be.revertedWith("Cannot deactivate with active sessions");
        });

        it("should allow gateway deactivation after sessions are settled", async function () {
            await gatewaySession.connect(provider).registerGateway("my-api", parseUSDC(0.01));

            const tx = await gatewaySession.connect(agent).openSession(
                "my-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Settle the session
            await gatewaySession.connect(agent).settleSession(sessionId);

            // Now deactivation should work
            await expect(gatewaySession.connect(provider).deactivateGateway("my-api"))
                .to.emit(gatewaySession, "GatewayDeactivated");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Session Lifecycle Edge Cases
    // ═══════════════════════════════════════════════════════════════════════

    describe("Session Lifecycle Edge Cases", function () {
        beforeEach(async function () {
            await gatewaySession.connect(provider).registerGateway("test-api", parseUSDC(0.01));
        });

        it("should reject session with zero deposit", async function () {
            await expect(gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), 0, 3600
            )).to.be.revertedWith("Deposit must be > 0");
        });

        it("should reject session with zero duration", async function () {
            await expect(gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 0
            )).to.be.revertedWith("Invalid duration");
        });

        it("should reject session exceeding MAX_SESSION_DURATION (7 days)", async function () {
            const eightDays = 8 * 24 * 60 * 60;
            await expect(gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), eightDays
            )).to.be.revertedWith("Invalid duration");
        });

        it("should accept max duration session (7 days)", async function () {
            const sevenDays = 7 * 24 * 60 * 60;
            await expect(gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), sevenDays
            )).to.emit(gatewaySession, "SessionOpened");
        });

        it("should reject session with non-existent gateway", async function () {
            await expect(gatewaySession.connect(agent).openSession(
                "non-existent", await token.getAddress(), parseUSDC(10), 3600
            )).to.be.revertedWith("Gateway not found");
        });

        it("should reject session with zero token address", async function () {
            await expect(gatewaySession.connect(agent).openSession(
                "test-api", ethers.ZeroAddress, parseUSDC(10), 3600
            )).to.be.revertedWith("Invalid token address");
        });

        it("should reject session when agent has insufficient balance", async function () {
            await expect(gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(2000), 3600 // More than deposited
            )).to.be.revertedWith("Insufficient TrustEngine balance");
        });

        it("should reject usage recording after session expiry", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 60 // 1 minute
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Fast forward past expiry
            await time.increase(120);

            await expect(gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(1)))
                .to.be.revertedWith("Session expired");
        });

        it("should allow third party to settle after expiry", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 60
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Fast forward past expiry
            await time.increase(120);

            // Third party can settle after expiry
            await expect(gatewaySession.connect(other).settleSession(sessionId))
                .to.emit(gatewaySession, "SessionSettled");
        });

        it("should reject third party settlement before expiry", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await expect(gatewaySession.connect(other).settleSession(sessionId))
                .to.be.revertedWith("Not authorized to settle");
        });

        it("should reject cancellation with non-zero usage", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Record some usage
            await gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(1));

            // Try to cancel - should fail
            await expect(gatewaySession.connect(agent).cancelSession(sessionId))
                .to.be.revertedWith("Cannot cancel session with usage");
        });

        it("should reject cancellation by non-agent", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await expect(gatewaySession.connect(provider).cancelSession(sessionId))
                .to.be.revertedWith("Only agent can cancel");
        });

        it("should reject renewal by non-agent", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await expect(gatewaySession.connect(provider).renewSession(sessionId, 3600))
                .to.be.revertedWith("Only agent can renew");
        });

        it("should reject renewal with zero extension", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await expect(gatewaySession.connect(agent).renewSession(sessionId, 0))
                .to.be.revertedWith("Invalid extension");
        });

        it("should reject renewal exceeding max duration", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            const eightDays = 8 * 24 * 60 * 60;
            await expect(gatewaySession.connect(agent).renewSession(sessionId, eightDays))
                .to.be.revertedWith("Invalid extension");
        });

        it("should reject operations on settled session", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await gatewaySession.connect(agent).settleSession(sessionId);

            await expect(gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(1)))
                .to.be.revertedWith("Session not active");

            await expect(gatewaySession.connect(agent).settleSession(sessionId))
                .to.be.revertedWith("Session not active");

            await expect(gatewaySession.connect(agent).cancelSession(sessionId))
                .to.be.revertedWith("Session not active");

            await expect(gatewaySession.connect(agent).renewSession(sessionId, 3600))
                .to.be.revertedWith("Session not active");
        });

        it("should reject operations on cancelled session", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await gatewaySession.connect(agent).cancelSession(sessionId);

            await expect(gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(1)))
                .to.be.revertedWith("Session not active");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // TrustEngine Edge Cases
    // ═══════════════════════════════════════════════════════════════════════

    describe("TrustEngine Edge Cases", function () {
        it("should reject withdrawal exceeding balance", async function () {
            const agentBalance = await trustEngine.balances(agent.address, await token.getAddress());
            await expect(trustEngine.connect(agent).withdraw(await token.getAddress(), agentBalance + 1n))
                .to.be.revertedWithCustomError(trustEngine, "InsufficientBalance");
        });

        it("should handle zero withdrawal (no-op)", async function () {
            const balanceBefore = await trustEngine.balances(agent.address, await token.getAddress());
            await trustEngine.connect(agent).withdraw(await token.getAddress(), 0);
            const balanceAfter = await trustEngine.balances(agent.address, await token.getAddress());
            // Balance unchanged
            expect(balanceAfter).to.equal(balanceBefore);
        });

        it("should handle exact balance withdrawal", async function () {
            const balance = await trustEngine.balances(agent.address, await token.getAddress());
            await expect(trustEngine.connect(agent).withdraw(await token.getAddress(), balance))
                .to.emit(trustEngine, "Withdrawn");

            expect(await trustEngine.balances(agent.address, await token.getAddress())).to.equal(0);
        });

        it("should reject protocol fee > 10%", async function () {
            await expect(trustEngine.setProtocolFee(1001)) // 10.01%
                .to.be.revertedWithCustomError(trustEngine, "FeeTooHigh");
        });

        it("should accept max protocol fee (10%)", async function () {
            await expect(trustEngine.setProtocolFee(1000)) // 10%
                .to.emit(trustEngine, "ProtocolFeeUpdated");
        });

        it("should reject zero address for fee recipient", async function () {
            await expect(trustEngine.setProtocolFeeRecipient(ethers.ZeroAddress))
                .to.be.revertedWithCustomError(trustEngine, "InvalidAddress");
        });

        it("should reject Solana settlement replay", async function () {
            const sessionId = ethers.keccak256(ethers.toUtf8Bytes("sol_session"));

            await trustEngine.setSolanaRelay(owner.address);
            await trustEngine.setSolanaSessionToken(await token.getAddress());

            // First settlement
            await trustEngine.settleFromSolana(sessionId, agent.address, provider.address, parseUSDC(10));

            // Replay attempt - should fail
            await expect(trustEngine.settleFromSolana(sessionId, agent.address, provider.address, parseUSDC(10)))
                .to.be.revertedWithCustomError(trustEngine, "AlreadyProcessed");
        });

        it("should reject Solana settlement from non-relay", async function () {
            const sessionId = ethers.keccak256(ethers.toUtf8Bytes("sol_session"));

            await trustEngine.setSolanaRelay(owner.address);
            await trustEngine.setSolanaSessionToken(await token.getAddress());

            await expect(trustEngine.connect(other).settleFromSolana(sessionId, agent.address, provider.address, parseUSDC(10)))
                .to.be.revertedWithCustomError(trustEngine, "Unauthorized");
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Fee Calculation Edge Cases
    // ═══════════════════════════════════════════════════════════════════════

    describe("Fee Calculation Edge Cases", function () {
        beforeEach(async function () {
            await gatewaySession.connect(provider).registerGateway("test-api", parseUSDC(0.01));
        });

        it("should correctly calculate fee on tiny amounts (dust)", async function () {
            // 1 = 1 unit (smallest possible)
            // With 0.25% fee (25 bps), 1 * 25 / 10000 = 0 (rounds to zero)
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), 1n, 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await gatewaySession.connect(provider).recordUsage(sessionId, 1n);

            const feeBalanceBefore = await trustEngine.balances(feeRecipient.address, await token.getAddress());
            await gatewaySession.connect(agent).settleSession(sessionId);
            const feeBalanceAfter = await trustEngine.balances(feeRecipient.address, await token.getAddress());

            // Fee should be 0 for 1 unit with 25 bps
            expect(feeBalanceAfter - feeBalanceBefore).to.equal(0);
        });

        it("should correctly calculate fee on large amounts", async function () {
            // Deposit more for large test
            await token.mint(agent.address, parseUSDC(1000000));
            await token.connect(agent).approve(await trustEngine.getAddress(), parseUSDC(1000000));
            await trustEngine.connect(agent).deposit(await token.getAddress(), parseUSDC(1000000));

            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(100000), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(100000));

            const feeBalanceBefore = await trustEngine.balances(feeRecipient.address, await token.getAddress());
            await gatewaySession.connect(agent).settleSession(sessionId);
            const feeBalanceAfter = await trustEngine.balances(feeRecipient.address, await token.getAddress());

            // Fee should be exactly 0.25% = $250 = 250,000,000 units
            expect(feeBalanceAfter - feeBalanceBefore).to.equal(parseUSDC(250));
        });

        it("should handle zero fee correctly", async function () {
            await trustEngine.setProtocolFee(0);

            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            await gatewaySession.connect(provider).recordUsage(sessionId, parseUSDC(100));

            const providerBalanceBefore = await trustEngine.balances(provider.address, await token.getAddress());
            await gatewaySession.connect(agent).settleSession(sessionId);
            const providerBalanceAfter = await trustEngine.balances(provider.address, await token.getAddress());

            // Provider should receive full amount
            expect(providerBalanceAfter - providerBalanceBefore).to.equal(parseUSDC(100));
        });

        it("should handle settlement with zero usage (full refund)", async function () {
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            const agentBalanceBefore = await trustEngine.balances(agent.address, await token.getAddress());
            await gatewaySession.connect(agent).settleSession(sessionId);
            const agentBalanceAfter = await trustEngine.balances(agent.address, await token.getAddress());

            // Agent should get full refund
            expect(agentBalanceAfter - agentBalanceBefore).to.equal(parseUSDC(100));
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Multi-Session Interaction Edge Cases
    // ═══════════════════════════════════════════════════════════════════════

    describe("Multi-Session Edge Cases", function () {
        beforeEach(async function () {
            await gatewaySession.connect(provider).registerGateway("test-api", parseUSDC(0.01));
        });

        it("should allow agent to have multiple concurrent sessions", async function () {
            const session1 = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const session2 = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            const session3 = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );

            // All should succeed
            expect(session1).to.not.be.undefined;
            expect(session2).to.not.be.undefined;
            expect(session3).to.not.be.undefined;
        });

        it("should correctly track active session count per provider", async function () {
            // Register second gateway for same provider
            await gatewaySession.connect(provider).registerGateway("test-api-2", parseUSDC(0.02));

            expect(await gatewaySession.activeSessionsByProvider(provider.address)).to.equal(0);

            const tx1 = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(100), 3600
            );
            expect(await gatewaySession.activeSessionsByProvider(provider.address)).to.equal(1);

            const tx2 = await gatewaySession.connect(agent).openSession(
                "test-api-2", await token.getAddress(), parseUSDC(100), 3600
            );
            expect(await gatewaySession.activeSessionsByProvider(provider.address)).to.equal(2);

            // Settle first session
            const sessionId1 = (await tx1.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;
            await gatewaySession.connect(agent).settleSession(sessionId1);
            expect(await gatewaySession.activeSessionsByProvider(provider.address)).to.equal(1);

            // Cancel second session
            const sessionId2 = (await tx2.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;
            await gatewaySession.connect(agent).cancelSession(sessionId2);
            expect(await gatewaySession.activeSessionsByProvider(provider.address)).to.equal(0);
        });

        it("should generate unique session IDs for same agent/gateway", async function () {
            const tx1 = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );
            const tx2 = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), parseUSDC(10), 3600
            );

            const sessionId1 = (await tx1.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;
            const sessionId2 = (await tx2.wait())?.logs.find(l => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            expect(sessionId1).to.not.equal(sessionId2);
        });
    });
});
