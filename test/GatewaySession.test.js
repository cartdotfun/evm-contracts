const { expect } = require("chai");
const hre = require("hardhat");

describe("GatewaySession", function () {
    async function deployContracts() {
        const [owner, agent, provider, other] = await hre.ethers.getSigners();

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

        // Set GatewaySession as authorized in TrustEngine
        await trustEngine.setGatewaySession(await gatewaySession.getAddress());

        // Mint tokens to agent and approve TrustEngine
        const DEPOSIT_AMOUNT = hre.ethers.parseUnits("100", 6); // 100 USDC
        await token.mint(agent.address, DEPOSIT_AMOUNT);
        await token.connect(agent).approve(await trustEngine.getAddress(), DEPOSIT_AMOUNT);

        // Agent deposits to TrustEngine
        await trustEngine.connect(agent).deposit(await token.getAddress(), DEPOSIT_AMOUNT);

        return {
            trustEngine,
            gatewaySession,
            token,
            owner,
            agent,
            provider,
            other,
            DEPOSIT_AMOUNT
        };
    }

    describe("Gateway Registration", function () {
        it("should register a gateway", async function () {
            const { gatewaySession, provider } = await deployContracts();

            const pricePerRequest = hre.ethers.parseUnits("0.01", 6); // $0.01
            await expect(gatewaySession.connect(provider).registerGateway("my-api", pricePerRequest))
                .to.emit(gatewaySession, "GatewayRegistered")
                .withArgs("my-api", provider.address, pricePerRequest);

            const [gatewayProvider, gatewayPrice] = await gatewaySession.getGateway("my-api");
            expect(gatewayProvider).to.equal(provider.address);
            expect(gatewayPrice).to.equal(pricePerRequest);
        });

        it("should reject duplicate gateway registration", async function () {
            const { gatewaySession, provider, other } = await deployContracts();

            await gatewaySession.connect(provider).registerGateway("my-api", 1000);
            await expect(gatewaySession.connect(other).registerGateway("my-api", 2000))
                .to.be.revertedWith("Gateway already exists");
        });

        it("should allow gateway owner to update pricing", async function () {
            const { gatewaySession, provider } = await deployContracts();

            await gatewaySession.connect(provider).registerGateway("my-api", 1000);
            await expect(gatewaySession.connect(provider).updateGatewayPrice("my-api", 2000))
                .to.emit(gatewaySession, "GatewayUpdated");
        });
    });

    describe("Session Lifecycle", function () {
        async function setupWithGateway() {
            const fixture = await deployContracts();
            const pricePerRequest = hre.ethers.parseUnits("0.01", 6);
            await fixture.gatewaySession.connect(fixture.provider).registerGateway("test-api", pricePerRequest);
            return { ...fixture, pricePerRequest };
        }

        it("should open a session", async function () {
            const { gatewaySession, trustEngine, token, agent, provider, DEPOSIT_AMOUNT } = await setupWithGateway();

            const sessionDeposit = hre.ethers.parseUnits("10", 6); // 10 USDC
            const duration = 3600; // 1 hour

            const tx = await gatewaySession.connect(agent).openSession(
                "test-api",
                await token.getAddress(),
                sessionDeposit,
                duration
            );

            const receipt = await tx.wait();
            const event = receipt?.logs.find(
                (log) => log.fragment?.name === "SessionOpened"
            );
            const sessionId = event?.args?.sessionId;

            expect(sessionId).to.not.be.undefined;

            // Verify session state
            const session = await gatewaySession.getSession(sessionId);

            expect(session.agent).to.equal(agent.address);
            expect(session.provider).to.equal(provider.address);
            expect(session.depositAmount).to.equal(sessionDeposit);
            expect(session.usedAmount).to.equal(0);
            expect(session.state).to.equal(1); // ACTIVE

            // Verify TrustEngine locked the funds
            const sessionInfo = await trustEngine.getSessionInfo(sessionId);
            expect(sessionInfo.lockedAmount).to.equal(sessionDeposit);

            // Agent balance should be reduced
            expect(await trustEngine.balances(agent.address, await token.getAddress()))
                .to.equal(DEPOSIT_AMOUNT - sessionDeposit);
        });

        it("should record usage", async function () {
            const { gatewaySession, token, agent, provider, pricePerRequest } = await setupWithGateway();

            const sessionDeposit = hre.ethers.parseUnits("10", 6);
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), sessionDeposit, 3600
            );
            const receipt = await tx.wait();
            const sessionId = receipt?.logs.find((l) => l.fragment?.name === "SessionOpened")?.args?.sessionId;

            // Provider records usage
            await expect(gatewaySession.connect(provider).recordUsage(sessionId, pricePerRequest))
                .to.emit(gatewaySession, "UsageRecorded")
                .withArgs(sessionId, pricePerRequest, pricePerRequest);

            // Verify usage accumulated
            expect(await gatewaySession.getRemainingCredits(sessionId))
                .to.equal(sessionDeposit - pricePerRequest);
        });

        it("should settle session and distribute funds", async function () {
            const { gatewaySession, trustEngine, token, agent, provider } = await setupWithGateway();

            const sessionDeposit = hre.ethers.parseUnits("10", 6);
            const usageAmount = hre.ethers.parseUnits("3", 6); // Use $3 of the $10

            // Open session
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), sessionDeposit, 3600
            );
            const sessionId = (await tx.wait())?.logs.find(
                (l) => l.fragment?.name === "SessionOpened"
            )?.args?.sessionId;

            // Record usage
            await gatewaySession.connect(provider).recordUsage(sessionId, usageAmount);

            // Get balances before settlement
            const agentBalanceBefore = await trustEngine.balances(agent.address, await token.getAddress());
            const providerBalanceBefore = await trustEngine.balances(provider.address, await token.getAddress());

            // Settle session
            await expect(gatewaySession.connect(agent).settleSession(sessionId))
                .to.emit(gatewaySession, "SessionSettled")
                .withArgs(sessionId, usageAmount, sessionDeposit - usageAmount);

            // Verify fund distribution
            expect(await trustEngine.balances(agent.address, await token.getAddress()))
                .to.equal(agentBalanceBefore + (sessionDeposit - usageAmount)); // Refund unused
            expect(await trustEngine.balances(provider.address, await token.getAddress()))
                .to.equal(providerBalanceBefore + usageAmount); // Payment for usage
        });

        it("should allow agent to cancel session with no usage", async function () {
            const { gatewaySession, trustEngine, token, agent, DEPOSIT_AMOUNT } = await setupWithGateway();

            const sessionDeposit = hre.ethers.parseUnits("10", 6);

            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), sessionDeposit, 3600
            );
            const sessionId = (await tx.wait())?.logs.find(
                (l) => l.fragment?.name === "SessionOpened"
            )?.args?.sessionId;

            // Cancel session
            await expect(gatewaySession.connect(agent).cancelSession(sessionId))
                .to.emit(gatewaySession, "SessionCancelled")
                .withArgs(sessionId, sessionDeposit);

            // Agent should get full refund
            expect(await trustEngine.balances(agent.address, await token.getAddress()))
                .to.equal(DEPOSIT_AMOUNT);
        });

        it("should reject usage recording by non-provider", async function () {
            const { gatewaySession, token, agent, other } = await setupWithGateway();

            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), hre.ethers.parseUnits("10", 6), 3600
            );
            const sessionId = (await tx.wait())?.logs.find(
                (l) => l.fragment?.name === "SessionOpened"
            )?.args?.sessionId;

            await expect(gatewaySession.connect(other).recordUsage(sessionId, 1000))
                .to.be.revertedWith("Only provider can record usage");
        });

        it("should reject usage exceeding deposit", async function () {
            const { gatewaySession, token, agent, provider } = await setupWithGateway();

            const sessionDeposit = hre.ethers.parseUnits("10", 6);
            const tx = await gatewaySession.connect(agent).openSession(
                "test-api", await token.getAddress(), sessionDeposit, 3600
            );
            const sessionId = (await tx.wait())?.logs.find(
                (l) => l.fragment?.name === "SessionOpened"
            )?.args?.sessionId;

            // Try to record usage exceeding deposit
            const excessiveUsage = hre.ethers.parseUnits("15", 6);
            await expect(gatewaySession.connect(provider).recordUsage(sessionId, excessiveUsage))
                .to.be.revertedWith("Usage exceeds deposit");
        });
    });
});
